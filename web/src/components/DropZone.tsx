import { FileText, Loader2, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { isDesktop, pickFolder, pickPdfs } from "../lib/desktop";
import { useStore } from "../store";

/** Drop PDFs, zips of PDFs, or whole folders.
 *
 * Two very different plumbings, one face. In the browser, HTML5 drag-drop
 * hands over File objects (directories walked via webkitGetAsEntry) and the
 * bytes POST to /api/upload. In the desktop app the OS drag never reaches the
 * webview — App.tsx listens natively and drops arrive as absolute paths, so
 * this component only needs the highlight state and native pickers.
 */
export function DropZone({
  onFiles,
  folder,
  compact = false,
}: {
  onFiles: (files: File[]) => Promise<void>;
  folder: string;
  compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const nativeOver = useStore((s) => s.nativeDragOver);
  const addPaths = useStore((s) => s.addPaths);
  const inputRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  const handle = useCallback(
    async (files: File[]) => {
      const ok = files.filter((f) => /\.(pdf|zip)$/i.test(f.name));
      if (!ok.length) return;
      setBusy(true);
      try {
        await onFiles(ok);
      } finally {
        setBusy(false);
      }
    },
    [onFiles],
  );

  const handlePaths = useCallback(
    async (paths: string[] | string | null) => {
      const list = paths == null ? [] : Array.isArray(paths) ? paths : [paths];
      if (!list.length) return;
      setBusy(true);
      try {
        await addPaths(list);
      } finally {
        setBusy(false);
      }
    },
    [addPaths],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(false);
      const items = Array.from(e.dataTransfer.items ?? []);
      const files: File[] = [];
      // drain the reader: each readEntries call returns at most ~100 entries,
      // and only an empty batch means the directory is done
      const readAll = async (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> => {
        const all: FileSystemEntry[] = [];
        for (;;) {
          const batch: FileSystemEntry[] = await new Promise((res, rej) => reader.readEntries(res, rej));
          if (!batch.length) return all;
          all.push(...batch);
        }
      };
      // walk dropped directories when the browser lets us
      const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
        if (entry.isFile) {
          await new Promise<void>((res) =>
            (entry as FileSystemFileEntry).file((f) => {
              if (/\.(pdf|zip)$/i.test(f.name)) {
                const named = new File([f], prefix + f.name, { type: f.type });
                files.push(named);
              }
              res();
            }),
          );
        } else if (entry.isDirectory) {
          const entries = await readAll((entry as FileSystemDirectoryEntry).createReader());
          for (const ent of entries) await walk(ent, prefix + entry.name + "/");
        }
      };
      const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
      if (entries.length) {
        for (const ent of entries) await walk(ent, "");
      } else {
        files.push(...Array.from(e.dataTransfer.files));
      }
      await handle(files);
    },
    [handle],
  );

  const lit = over || nativeOver;
  return (
    <div
      onDragOver={
        isDesktop
          ? undefined
          : (e) => {
              e.preventDefault();
              e.stopPropagation();
              setOver(true);
            }
      }
      onDragLeave={
        isDesktop
          ? undefined
          : (e) => {
              e.preventDefault();
              setOver(false);
            }
      }
      onDrop={isDesktop ? undefined : onDrop}
      onClick={() => (isDesktop ? pickPdfs().then(handlePaths) : inputRef.current?.click())}
      className={`relative cursor-pointer border-2 border-dashed rounded-xl transition-all duration-200 ${
        compact ? "px-3 py-3" : "px-6 py-8"
      } ${lit ? "border-blue-400/70 bg-blue-900/20" : "border-edge-strong/70 bg-raised/40 hover:border-edge-strong hover:bg-raised/60"}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.zip,application/pdf,application/zip"
        multiple
        className="hidden"
        onChange={(e) => {
          handle(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <input
        ref={dirRef}
        type="file"
        className="hidden"
        // @ts-expect-error non-standard attribute
        webkitdirectory=""
        multiple
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? []).map(
            (f) => new File([f], (f as File & { webkitRelativePath: string }).webkitRelativePath || f.name, { type: f.type }),
          );
          handle(fs);
          e.target.value = "";
        }}
      />
      <div className={`flex ${compact ? "flex-row items-center gap-3" : "flex-col items-center gap-3 text-center"}`}>
        <div
          className={`${compact ? "w-8 h-8" : "w-12 h-12"} rounded-full flex items-center justify-center shrink-0 ${
            lit ? "bg-blue-500/20" : "bg-raised/60"
          }`}
        >
          {busy ? (
            <Loader2 className={`${compact ? "w-4 h-4" : "w-6 h-6"} text-blue-400 animate-spin`} />
          ) : lit ? (
            <FileText className={`${compact ? "w-4 h-4" : "w-6 h-6"} text-blue-400`} />
          ) : (
            <Upload className={`${compact ? "w-4 h-4" : "w-6 h-6"} text-muted`} />
          )}
        </div>
        <div className="min-w-0">
          {busy ? (
            <p className="text-xs text-blue-300">Adding…</p>
          ) : lit ? (
            <p className="text-xs text-blue-300">Drop PDFs, a zip, or a folder</p>
          ) : (
            <>
              <p className="text-xs text-ink/90">
                <span className="text-blue-400 font-medium">Click to upload</span> or drag and drop
              </p>
              <p className="text-xs text-faint mt-0.5 truncate">
                PDF · zip · folder →{" "}
                <span className="font-mono text-muted">{folder || "/"}</span>
                {" · "}
                <button
                  className="underline hover:text-ink"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isDesktop) pickFolder().then(handlePaths);
                    else dirRef.current?.click();
                  }}
                >
                  pick a folder
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
