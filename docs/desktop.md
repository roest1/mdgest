# The desktop app

One window over the same product: a Rust shell (tauri 2) hosts the existing
web UI and supervises the existing Python engine as a **sidecar binary**. No
Python, no bun, no network on the client's machine — the installer carries
everything.

```
src-tauri/            rust: the window, and the engine's supervisor
  src/main.rs           commands: engine_info, save_text_file, open_external
  src/engine.rs         spawn/adopt the sidecar; port + token handshake; kill on exit
  binaries/             mdgest-engine-<triple>  (built by scripts/build_engine.py, gitignored)
web/src/lib/desktop.ts  the only frontend file that knows the desktop exists
engine/mdgest/sidecar.py  the engine's half of the supervision contract
scripts/build_engine.py   PyInstaller onefile -> src-tauri/binaries
```

## The supervision contract

The Rust shell spawns `mdgest-engine sidecar` and:

- passes a fresh random token in `MDGEST_TOKEN` — every `/api` request must
  present it (`X-Mdgest-Token` header, or `?t=` for `<img src>` URLs), so no
  other local process can drive an engine that will read arbitrary paths;
- passes the workspace in `MDGEST_WORKSPACE` — `<app data>/workspace` unless
  the user already set one;
- reads `MDGEST_ENGINE_READY <port>` from the engine's stdout (the engine
  binds `127.0.0.1:0`; connections queue from the moment the line prints);
- **holds the engine's stdin open**. EOF on that pipe is the engine's signal
  to exit — it covers every way the shell can die, SIGKILL and panics
  included, so no orphaned server outlives a dead window. A clean exit also
  kills the child outright (`RunEvent::Exit`).

The frontend's first act in a window is `invoke("engine_info")`, which
resolves to `{ base, token }` once the handshake completes; `configureApi`
then rebases every request and image URL. In the browser none of this exists
and `/api` stays same-origin.

## Ingest: paths, not bytes

A native OS drag never reaches the webview as an HTML5 event (tauri's
`dragDropEnabled`, the default we ship). Instead App.tsx listens to the native
drag-drop events and receives **absolute paths**, which go to
`POST /api/add-paths` — the engine walks folders itself, keeping their
hierarchy, without a 200 MB course round-tripping through webview memory. The
browser build keeps POSTing bytes to `/api/upload`. Same for picking: the
webview's `webkitdirectory` input and `<a download>` don't work under
WebKitGTK, so the desktop uses native open/save dialogs
(`tauri-plugin-dialog`).

Desktop drops land in the explorer's **selected folder** (the whole window is
the drop target); dropping onto a specific folder row is a browser-only
nicety for now.

## Running it

```bash
make desktop-dev      # packages the engine, then tauri dev against vite
make desktop-build    # installable bundles for this OS
```

Iterating on the UI without rebuilding the sidecar every time — run the
engine by hand and let the shell adopt it:

```bash
make api                                    # terminal 1, engine on :8770
MDGEST_ENGINE_URL=http://127.0.0.1:8770 cd web && bun run tauri dev   # terminal 2
```

(`MDGEST_ENGINE_BIN=/path/to/binary` swaps just the sidecar binary;
`MDGEST_WORKSPACE=…` points the app at any workspace, same as the CLI.)

## Platform status

| | built | looked at | notes |
|---|---|---|---|
| Linux | ✓ local + CI | ✓ Fedora 44, WebKitGTK 2.52 | AppImage, deb, rpm |
| macOS | CI only | ✗ needs hardware | dmg; **unsigned = blocked by Gatekeeper** ($99/yr Apple Developer to fix) |
| Windows | CI only | ✗ needs hardware | nsis/msi; **unsigned = SmartScreen warning** (~$200–400/yr OV cert) |

Known Windows caveat for later: with native file drops enabled, WebView2
disables *all* HTML5 drag-drop — including the explorer's internal
drag-to-move rows. On Windows that internal drag will need a pointer-event
rewrite (the PDF pane's block drag already uses pointer events and is fine
everywhere).
