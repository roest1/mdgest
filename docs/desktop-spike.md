# Desktop spike — the verdict

2026-08-20 · Fedora 44 · WebKitGTK 2.52.5 · branch `spike/tauri`
(The spike plan's two questions, answered with measurements, not vibes.)

## Question A — can the Python engine ship inside a desktop app? **Yes.**

PyInstaller onefile, entry = the whole mdgest CLI, with `--collect-all
pypdfium2_raw` for the ctypes-loaded pdfium and `--collect-submodules uvicorn`
for its string-resolved loop classes. Verified standalone in a scrubbed
environment (`env -i`, no venv): announced its port, gated /api behind the
token (401/401/200), walked a dropped directory tree with hierarchy intact,
produced correct markdown (headings, joined paragraphs, real bullets, page
breaks), rendered pages to valid PNGs, and **exited on stdin EOF** — the
watchdog that makes orphans impossible. The same binary is the full `mdgest`
CLI on machines with no Python.

## Question B — Tauri or Electron? **Tauri.**

- WebKitGTK 2.52 renders the UI faithfully — verified by screenshot, not
  faith: Literata's optical sizing, `.glass` (backdrop-blur over
  `color-mix(in oklab, …)` surfaces), the body's radial gradients, JetBrains
  Mono, the explorer with live data. Tailwind 4 already emits
  `-webkit-backdrop-filter`. **Day-1 defect list: empty** for everything
  inspectable without a mouse.
- Drag-drop: the WebKitGTK Entries-API question is **moot** — the desktop
  uses tauri's native drag-drop events, which hand over absolute paths. The
  engine walks folders itself (`POST /api/add-paths`), so a 200 MB course
  never round-trips through webview memory. This was the plan's "fallback is
  arguably the better design," adopted as the design.

## Measured

| artifact | size | plan predicted |
|---|---|---|
| engine sidecar (onefile) | **33.5 MB** | ~65 MB |
| Rust shell binary | **4.3 MB** | 5–10 MB |
| deb / rpm | **34 MB each** | — |
| AppImage (carries WebKitGTK) | **134 MB** | under the ~150 MB kill line |

Release compile 2m38s; sidecar build ~35s. End-to-end proof from the built
AppImage's own logs: window → IPC handshake → `GET /api/tree?t=…` **200**
(CSP, CORS, and token all hold) → SIGKILL the shell → engine gone, zero
leftover processes.

## What it took (the defect list, each with its one-line fix)

| found | fix |
|---|---|
| tauri CLI won't find `src-tauri/` from `web/` | `"tauri": "cd .. && tauri"` script in web/package.json (keeps .bin on PATH, cross-platform) |
| vite bound `localhost`, which resolved to `::1` only — tauri polls IPv4 `127.0.0.1:5173` and waits forever (caught on the first human run) | `server.host: "127.0.0.1"` in vite.config.ts |
| linuxdeploy's bundled `strip` chokes on Fedora 44's `.relr.dyn` sections | `NO_STRIP=1` (locally and in CI); plus a static `patchelf` on PATH locally |
| PyInstaller needs ≥ 6.16 for Python 3.14 | floor pinned in the `build` extra |
| `readEntries` drained once — folders over ~100 entries silently truncated **in the browser today** | drain loop in DropZone (the plan's day-2 bug, fixed) |
| `<a download>`, `webkitdirectory`, and bare `navigator.clipboard` don't work under WebKitGTK | native save/open dialogs via plugin-dialog; execCommand clipboard fallback |

## Standing decisions

- **Ingest is one interface, two implementations**: browser POSTs bytes
  (`/api/upload`), desktop POSTs paths (`/api/add-paths`). Decided now, not
  discovered in month three.
- **Per-launch token** on every /api request (header or `?t=` for `<img>`),
  because the engine will read any path it's told to.
- Desktop workspace defaults to `<app data>/workspace`; `MDGEST_WORKSPACE`
  still points anywhere (a client's drive).
- Desktop drops land in the explorer's **selected folder** (whole window =
  target); per-folder-row drops stay a browser nicety for now.

## Not verified, on purpose (the honest gaps)

- **macOS / Windows rendering**: CI builds them blind; nobody has looked.
  Needs borrowed hardware.
- **Windows internal drag**: with native file drops on, WebView2 kills all
  HTML5 dnd — the explorer's drag-to-move rows will need pointer events on
  Windows (the PDF pane's block drag already uses them).
- **Document-view visuals on Linux** (overlays, thumbnails, drag feel):
  functionally proven, but the eyeball pass needs a human with a mouse.
- **Signing**: unsigned macOS builds are blocked by Gatekeeper, Windows by
  SmartScreen. Shipping to clients means Apple Developer ($99/yr) + an
  Authenticode OV cert (~$200–400/yr). Known, deferred, unavoidable.
- Engine shutdown is SIGKILL; a mid-write `edits.json` could in principle
  tear. Renders already write temp-then-replace; edits should too, later.

## Kill-criteria review

Sidecar packaging **passed** · drag-drop **passed** (native route) · CSS
defects **none found** · bundle size **under the line** · origin/CSP wiring
**worked as configured**. Nothing fired. The one plan deviation: the code was
not thrown away — the follow-up directive was to build to ~90%, so the spike
branch became the implementation.
