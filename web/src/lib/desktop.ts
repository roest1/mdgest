/**
 * The desktop seam. Everything the app does differently under Tauri goes
 * through here, so the browser build has exactly one file that knows the
 * desktop exists.
 *
 * In the window: the engine is a supervised sidecar on an ephemeral port
 * (engine_info hands over its origin and per-launch token), drops arrive as
 * native paths instead of File objects, and save/pick go through native
 * dialogs because the webview has neither downloads nor webkitdirectory.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";

export const isDesktop = isTauri();

export function engineInfo(): Promise<{ base: string; token: string }> {
  return invoke("engine_info");
}

/** Native save dialog + write; resolves false when the person cancels. */
export async function saveTextFile(suggestedName: string, contents: string): Promise<boolean> {
  const path = await save({
    defaultPath: suggestedName,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!path) return false;
  await invoke("save_text_file", { path, contents });
  return true;
}

/** Where to write an export: a directory, or a .zip file to create. */
export async function pickExportTarget(asZip: boolean, suggested: string): Promise<string | null> {
  if (!asZip) return pickFolder();
  return save({ defaultPath: `${suggested}.zip`, filters: [{ name: "Zip", extensions: ["zip"] }] });
}

/** Links in rendered markdown leave through the system browser. */
export function openExternal(url: string): Promise<void> {
  return invoke("open_external", { url });
}

export function pickPdfs(): Promise<string[] | null> {
  return open({
    multiple: true,
    filters: [{ name: "PDF or zip", extensions: ["pdf", "zip"] }],
  }) as Promise<string[] | null>;
}

export function pickFolder(): Promise<string | null> {
  return open({ directory: true }) as Promise<string | null>;
}

/**
 * Native file drops for the whole window. With dragDropEnabled (the default,
 * and what we ship) the webview never sees HTML5 drop events — the OS drag
 * lands here instead, carrying absolute paths.
 */
export function onFileDrop(handlers: {
  over: () => void;
  leave: () => void;
  drop: (paths: string[]) => void;
}): Promise<() => void> {
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "enter" || event.payload.type === "over") handlers.over();
    else if (event.payload.type === "drop") handlers.drop(event.payload.paths);
    else handlers.leave();
  });
}
