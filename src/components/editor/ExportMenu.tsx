import { Download, FileArchive, FolderDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "src/components/shared/Spinner";
import { useMenuDismiss } from "src/components/shared/useMenuDismiss";
import { engine } from "src/lib/engine";
import { messageOf } from "src/lib/words";

/** Chromium's folder picker. Not in TypeScript's DOM library, and not in
 *  Firefox or Safari, which export a zip instead. */
declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: "read" | "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

const menuItem =
  "flex w-full cursor-pointer items-start gap-3 px-3 py-1.5 text-left text-ink hover:bg-edge";

/** Today's date, for a download's name: `2026-10-01`. */
function today(): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** Hand `bytes` to the browser as a download named `name`. */
function download(bytes: Uint8Array<ArrayBuffer>, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // After the click has had a turn to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

type Status = { kind: "idle" } | { kind: "busy" } | { kind: "done"; said: string } | { kind: "failed"; said: string };

/** The way out of the browser: the workspace as a project to continue, or
 *  its finished markdown alone. Browser storage is evictable, so an export
 *  is the one save a person can be sure of -- the menu says so. */
export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const root = useRef<HTMLDivElement>(null);
  const folders = typeof window.showDirectoryPicker === "function";

  useMenuDismiss(open, root, setOpen);

  // What happened stays a few seconds, then the button is a button again.
  useEffect(() => {
    if (status.kind !== "done") return;
    const t = setTimeout(() => setStatus({ kind: "idle" }), 4000);
    return () => clearTimeout(t);
  }, [status]);

  const run = async (markdownOnly: boolean, toFolder: boolean) => {
    setOpen(false);
    try {
      if (toFolder) {
        // Picked before anything else: the browser only shows the picker
        // in answer to the click itself.
        const dir = await window.showDirectoryPicker!({ id: "mdgest-export", mode: "readwrite" });
        setStatus({ kind: "busy" });
        const n = await engine.exportToFolder(dir, markdownOnly);
        setStatus({ kind: "done", said: `Exported ${n} files to ${dir.name}` });
      } else {
        setStatus({ kind: "busy" });
        const bytes = await engine.exportZip(markdownOnly);
        download(bytes, `mdgest-${markdownOnly ? "markdown" : "project"}-${today()}.zip`);
        setStatus({ kind: "done", said: "Exported" });
      }
    } catch (cause) {
      // Closing the picker is a change of mind, not a failure.
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setStatus({ kind: "idle" });
        return;
      }
      setStatus({ kind: "failed", said: messageOf(cause) });
    }
  };

  const busy = status.kind === "busy";
  return (
    <div ref={root} className="relative ml-auto flex items-center gap-2">
      {status.kind === "done" && <span className="text-xs text-emerald-300">{status.said}</span>}
      {status.kind === "failed" && (
        <span className="max-w-96 truncate text-xs text-red-300" title={status.said}>
          {status.said}
        </span>
      )}
      <button
        type="button"
        title="Export: the one save that survives clearing this browser"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        data-tour="export"
        className={`flex cursor-pointer items-center gap-1.5 rounded-md border border-edge bg-raised/40 px-2 py-1
          text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:cursor-default ${
            open ? "bg-raised text-ink" : ""
          }`}
      >
        {busy ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
        export
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-edge bg-raised py-1 text-sm shadow-xl shadow-black/40"
        >
          <p className="px-3 pt-1 pb-1.5 text-xs leading-snug text-faint">
            This browser can clear what it stores. An export is the copy you keep.
          </p>
          <div className="my-1 h-px bg-edge" />
          <Item
            icon={<FileArchive className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
            title="Project as .zip"
            detail="Everything, to continue later: drop it on mdgest again"
            onClick={() => void run(false, false)}
          />
          {folders && (
            <Item
              icon={<FolderDown className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
              title="Project to a folder…"
              detail="The same, written into a folder you pick"
              onClick={() => void run(false, true)}
            />
          )}
          <div className="my-1 h-px bg-edge" />
          <Item
            icon={<FileArchive className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
            title="Markdown as .zip"
            detail="Only the documents marked done, with their figures"
            onClick={() => void run(true, false)}
          />
          {folders && (
            <Item
              icon={<FolderDown className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
              title="Markdown to a folder…"
              detail="The same, written into a folder you pick"
              onClick={() => void run(true, true)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Item({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={menuItem}>
      {icon}
      <span className="min-w-0">
        <span className="block">{title}</span>
        <span className="block text-xs text-faint">{detail}</span>
      </span>
    </button>
  );
}
