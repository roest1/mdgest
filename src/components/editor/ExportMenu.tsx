import { Download, FileArchive, FolderDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileTree } from "src/components/shared/FileTree";
import { Spinner } from "src/components/shared/Spinner";
import { useMenuDismiss } from "src/components/shared/useMenuDismiss";
import { engine } from "src/lib/engine";
import { useEditor } from "src/lib/store";
import type { Entry } from "src/lib/tree";
import { messageOf } from "src/lib/words";
import { cleanSegment } from "src/lib/workspace";

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

/** A download's name: the workspace's, made safe for a file, and the date,
 *  so a second export the same day reads as the same thing again. An
 *  unnamed workspace goes out as mdgest's. Importing reads the name from
 *  `mdgest.json`, not from this, so a renamed zip keeps its workspace's. */
function zipName(workspace: string | null, markdownOnly: boolean): string {
  const kind = markdownOnly ? "-markdown" : "";
  if (workspace) return `${cleanSegment(workspace)}${kind}-${today()}.zip`;
  return `mdgest-${markdownOnly ? "markdown" : "project"}-${today()}.zip`;
}

/** The last export's URL, let go when the next one is made.
 *
 * Not let go on a timer. The browser reads the blob while it writes the
 * file, and how long that takes is the size of the export and the speed of
 * the disk: a wait short enough to be worth having is short enough to cut a
 * large zip off partway, and the person is told "Exported" either way.
 *
 * Holding it until the next export does not make that impossible, only
 * unlikely. Exporting again while a large zip is still being written
 * revokes the URL that write is reading: the same cut-off, needing a
 * second export inside the first's write rather than arriving on its own.
 * One export's bytes stay until the next, and closing the page frees
 * them. */
let last: string | null = null;

/** Hand `bytes` to the browser as a download named `name`. */
function download(bytes: Uint8Array<ArrayBuffer>, name: string): void {
  if (last) URL.revokeObjectURL(last);
  last = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = last;
  a.download = name;
  a.style.display = "none";
  // In the document before it is clicked: a click on an anchor outside one
  // does nothing in Firefox.
  document.body.append(a);
  a.click();
  a.remove();
}

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; said: string }
  | { kind: "failed"; said: string };

/** The workspace's documents and which are done, read each time the menu
 *  opens. The editor's own marks win over what was read: a document marked
 *  done a moment ago may still be on its way to `edits.json`. Null until
 *  the engine answers, and left null if it refuses -- the menu still
 *  exports without the listing. */
function useListing(open: boolean): { entries: Entry[]; done: number } | null {
  const [read, setRead] = useState<{
    docs: string[];
    done: Set<string>;
  } | null>(null);
  const marks = useEditor((s) => s.done);
  useEffect(() => {
    if (!open) return;
    let live = true;
    Promise.all([engine.docs(), engine.doneDocs()]).then(
      ([docs, done]) => live && setRead({ docs, done: new Set(done) }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [open]);
  return useMemo(() => {
    if (!read) return null;
    const entries: Entry[] = read.docs.map((path) => ({
      path,
      kind: "pdf",
      done: marks[path] ?? read.done.has(path),
    }));
    return { entries, done: entries.filter((e) => e.done).length };
  }, [read, marks]);
}

/** The way out of the browser: the workspace as a project to continue, or
 *  its finished markdown alone. Browser storage is evictable, so an export
 *  is the one save a person can be sure of -- the menu says so, and lists
 *  the documents with their done marks, since done is what decides which
 *  ones a markdown export writes. */
export function ExportMenu({ name }: { name: string | null }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const root = useRef<HTMLDivElement>(null);
  const folders = typeof window.showDirectoryPicker === "function";
  const listing = useListing(open);
  const doneOf = listing
    ? `${listing.done} of ${listing.entries.length}`
    : null;

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
        const dir = await window.showDirectoryPicker!({
          id: "mdgest-export",
          mode: "readwrite",
        });
        setStatus({ kind: "busy" });
        const n = await engine.exportToFolder(dir, markdownOnly);
        setStatus({ kind: "done", said: `Exported ${n} files to ${dir.name}` });
      } else {
        setStatus({ kind: "busy" });
        const bytes = await engine.exportZip(markdownOnly);
        download(bytes, zipName(name, markdownOnly));
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
      {status.kind === "done" && (
        <span className="text-xs text-emerald-300">{status.said}</span>
      )}
      {status.kind === "failed" && (
        <span
          className="max-w-96 truncate text-xs text-red-300"
          title={status.said}
        >
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
        {busy ? (
          <Spinner className="h-5 w-5" />
        ) : (
          <Download className="h-5 w-5" />
        )}
        export
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-80 rounded-lg border border-edge bg-raised py-1 text-sm shadow-xl shadow-black/40"
        >
          <p className="px-3 pt-1 pb-1.5 text-xs leading-snug text-faint">
            This browser can clear what it stores. An export is the copy you
            keep.
          </p>
          {listing && listing.entries.length > 0 && (
            <>
              <div className="my-1 h-px bg-edge" />
              <p className="px-3 pt-1 text-xs text-muted">
                {doneOf} marked done
                <span className="text-faint">
                  {" "}
                  · mark a document done to write its markdown
                </span>
              </p>
              <FileTree entries={listing.entries} className="max-h-48" />
            </>
          )}
          <div className="my-1 h-px bg-edge" />
          <Item
            icon={
              <FileArchive className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            }
            title="Project as .zip"
            detail="Every PDF and every edit, done or not: drop it on mdgest again to continue"
            onClick={() => void run(false, false)}
          />
          {folders && (
            <Item
              icon={
                <FolderDown className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
              }
              title="Project to a folder…"
              detail="The same, written into a folder you pick"
              onClick={() => void run(false, true)}
            />
          )}
          <div className="my-1 h-px bg-edge" />
          <Item
            icon={
              <FileArchive className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            }
            title="Markdown as .zip"
            detail={`Only the ${doneOf ?? "documents"} marked done, with their figures`}
            onClick={() => void run(true, false)}
          />
          {folders && (
            <Item
              icon={
                <FolderDown className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
              }
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
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={menuItem}
    >
      {icon}
      <span className="min-w-0">
        <span className="block">{title}</span>
        <span className="block text-xs text-faint">{detail}</span>
      </span>
    </button>
  );
}
