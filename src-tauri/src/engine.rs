//! Supervise the packaged engine (`mdgest-engine sidecar`).
//!
//! The contract (the other half lives in engine/mdgest/sidecar.py):
//! - we generate a per-launch token and hand it over in MDGEST_TOKEN; every
//!   /api request must present it, so no other local process can drive the
//!   engine (it can read arbitrary paths via /api/add-paths);
//! - the engine binds 127.0.0.1:0 and announces `MDGEST_ENGINE_READY <port>`
//!   on stdout; we hold its stdin open, and EOF on that pipe — any way this
//!   process dies, panic and SIGKILL included — is its signal to exit;
//! - on a clean exit we also kill it outright.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize)]
pub struct EngineInfo {
    /// Origin of the engine, e.g. `http://127.0.0.1:53211` — no `/api` suffix.
    pub base: String,
    pub token: String,
}

#[derive(Clone)]
enum Status {
    Starting,
    Ready(EngineInfo),
    Failed(String),
}

pub struct EngineState {
    child: Mutex<Option<Child>>,
    status_tx: tokio::sync::watch::Sender<Status>,
    status_rx: tokio::sync::watch::Receiver<Status>,
}

impl EngineState {
    pub fn new() -> Self {
        let (status_tx, status_rx) = tokio::sync::watch::channel(Status::Starting);
        Self {
            child: Mutex::new(None),
            status_tx,
            status_rx,
        }
    }

    /// What the frontend awaits on boot. Ninety seconds covers a cold onefile
    /// extraction on a slow disk; a failure reports the engine's last words.
    pub async fn wait_ready(&self) -> Result<EngineInfo, String> {
        let mut rx = self.status_rx.clone();
        let status: Status = match tokio::time::timeout(
            Duration::from_secs(90),
            rx.wait_for(|s| !matches!(s, Status::Starting)),
        )
        .await
        {
            Err(_) => return Err("the engine did not start within 90 seconds".into()),
            Ok(Err(_)) => return Err("the engine supervisor went away".into()),
            Ok(Ok(guard)) => guard.clone(),
        };
        match status {
            Status::Ready(info) => Ok(info),
            Status::Failed(msg) => Err(msg),
            Status::Starting => unreachable!(),
        }
    }
}

pub fn spawn(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let state = app.state::<EngineState>();

    // Escape hatch for UI iteration: attach to an engine you run by hand
    // (MDGEST_ENGINE_URL=http://127.0.0.1:8770 [MDGEST_TOKEN=…] make desktop-dev).
    if let Ok(base) = std::env::var("MDGEST_ENGINE_URL") {
        let token = std::env::var("MDGEST_TOKEN").unwrap_or_default();
        let _ = state
            .status_tx
            .send(Status::Ready(EngineInfo { base, token }));
        return Ok(());
    }

    let bin = engine_binary()?;
    let workspace = workspace_dir(app)?;
    let token = new_token();

    let mut cmd = Command::new(&bin);
    cmd.arg("sidecar")
        .env("MDGEST_TOKEN", &token)
        .env("MDGEST_WORKSPACE", &workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start the engine at {}: {e}", bin.display()))?;
    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");
    // The Child holds the write end of the engine's stdin; it must live until
    // shutdown — dropping it would close the pipe and the engine would exit.
    *state.child.lock().unwrap() = Some(child);

    let tx = state.status_tx.clone();
    std::thread::spawn(move || {
        let mut ready = false;
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if !ready {
                if let Some(port) = line.strip_prefix("MDGEST_ENGINE_READY ") {
                    if let Ok(port) = port.trim().parse::<u16>() {
                        ready = true;
                        let _ = tx.send(Status::Ready(EngineInfo {
                            base: format!("http://127.0.0.1:{port}"),
                            token: token.clone(),
                        }));
                        continue;
                    }
                }
            }
            eprintln!("[engine] {line}");
        }
        if !ready {
            let _ = tx.send(Status::Failed(
                "the engine exited before announcing its port — run `mdgest-engine sidecar` by hand to see why"
                    .into(),
            ));
        }
    });
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            let Ok(line) = line else { break };
            eprintln!("[engine] {line}");
        }
    });
    Ok(())
}

pub fn shutdown(app: &AppHandle) {
    if let Some(mut child) = app.state::<EngineState>().child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Where the sidecar lives. Bundled: next to this executable (tauri renames
/// `binaries/mdgest-engine-<triple>` to plain `mdgest-engine` at bundle time,
/// and copies it beside the dev/release binary too). `tauri dev`: the
/// triple-suffixed PyInstaller output in src-tauri/binaries.
fn engine_binary() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("MDGEST_ENGINE_BIN") {
        return Ok(PathBuf::from(p));
    }
    let suffix = std::env::consts::EXE_SUFFIX;
    if cfg!(debug_assertions) {
        let triple = tauri::utils::platform::target_triple().map_err(|e| e.to_string())?;
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("mdgest-engine-{triple}{suffix}"));
        if p.exists() {
            return Ok(p);
        }
        return Err(format!(
            "no engine binary at {} — build it first with `make engine-bin`",
            p.display()
        ));
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe
        .parent()
        .ok_or("the executable has no parent directory")?
        .join(format!("mdgest-engine{suffix}")))
}

/// The workspace the engine works in: $MDGEST_WORKSPACE if the user set one
/// (a client's drive, say), otherwise <app data>/workspace.
fn workspace_dir(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(ws) = std::env::var("MDGEST_WORKSPACE") {
        return Ok(PathBuf::from(ws));
    }
    let dir = app.path().app_data_dir()?.join("workspace");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn new_token() -> String {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).expect("the OS random source failed");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
