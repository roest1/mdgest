//! The desktop shell: a window over the existing web UI, supervising the
//! packaged Python engine as a sidecar. See engine.rs for the contract.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod engine;

use engine::{EngineInfo, EngineState};

/// The frontend's first call: resolves once the engine has announced its port.
#[tauri::command]
async fn engine_info(state: tauri::State<'_, EngineState>) -> Result<EngineInfo, String> {
    state.wait_ready().await
}

/// Replaces the browser's `<a download>` — the webview has no download UI.
/// The path comes from the native save dialog, so it is one the user chose.
#[tauri::command]
fn save_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("could not write {path}: {e}"))
}

/// Links in rendered markdown open in the system browser, not in the window.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("only http(s) links open externally".into());
    }
    open::that_detached(&url).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(EngineState::new())
        .invoke_handler(tauri::generate_handler![
            engine_info,
            save_text_file,
            open_external
        ])
        .setup(|app| {
            engine::spawn(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                engine::shutdown(app);
            }
        });
}
