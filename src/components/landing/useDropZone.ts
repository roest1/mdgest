import { useCallback, useEffect, useRef, useState } from "react";
import { isJunk, isManifest, isPdf, isZip } from "src/lib/upload";
import { messageOf } from "src/lib/words";

/** What a drop keeps, by the policy in src/lib/upload.ts. Everything else in
 * a drop is dropped. The `<input accept>` string names the same types so the
 * native picker cannot start offering one the drop handler silently rejects.
 *
 * The manifest is the one non-PDF let through, and only as part of a folder
 * or a drop: it is what makes a folder an exported workspace rather than PDFs
 * to add, and filtering it out here would mean a dropped workspace could
 * never be recognized as one. It is not in the picker's accept string, since
 * a manifest picked on its own is nothing to continue from. */
const wanted = (path: string) =>
  !isJunk(path) && (isPdf(path) || isZip(path) || isManifest(path));
export const ACCEPT_ATTR = ["pdf", "zip"]
  .flatMap((e) => [`.${e}`, `application/${e}`])
  .join(",");

/** How long a success tick or an error message stays up before clearing. */
const FLASH_MS = 2500;

/** Everything past the filter shares one code path; only the "nothing to
 * upload" wording differs by gesture.
 *
 * Two tables, not one, because "wrong types" and "nothing at all" are
 * different facts. `empty.file` is null: a plain file picker fires change with
 * no files only when it was dismissed, and a cancel is not worth a red banner.
 * A directory picker fires the same way for a genuinely empty folder. */
type Source = "drop" | "file" | "dir";
const NO_MATCH: Record<Source, string> = {
  drop: "No PDFs or zips in that drop.",
  file: "No PDFs or zips in that selection.",
  dir: "No PDFs or zips in that folder.",
};
const EMPTY: Record<Source, string | null> = {
  drop: "That drop carried no files.",
  file: null,
  dir: "That folder is empty.",
};

/** What a drop could not read, said briefly: a few paths and a count. */
function unreadable(paths: string[]): string {
  const shown = paths.slice(0, 3).join(", ");
  const more = paths.length > 3 ? ` and ${paths.length - 3} more` : "";
  return `Could not read ${shown}${more}.`;
}

interface DropZoneState {
  /** A drag is hovering the zone. */
  isDragging: boolean;
  /** Files are in flight. */
  isLoading: boolean;
  /** Set for FLASH_MS after a settled upload; exclusive with `success`. */
  error: string | null;
  /** Set for FLASH_MS after a settled upload; exclusive with `error`. */
  success: boolean;
}

interface FileInputProps {
  ref: React.RefObject<HTMLInputElement | null>;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

interface DropZoneApi extends DropZoneState {
  /** Spread onto the drop target. Drop only — picking is the two openers
   * below, so the target itself handles no clicks. */
  dropProps: {
    onDragEnter: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  /** Spread onto the two hidden <input type="file">s. */
  fileInputProps: FileInputProps;
  dirInputProps: FileInputProps;
  /** Two openers because the browser gives us two dialogs: a plain file input
   * can descend into folders but not select one, and `webkitdirectory` selects
   * only a folder and never loose files. No attribute offers both, which is
   * why there are two hidden inputs rather than one. */
  openFilePicker: () => void;
  openFolderPicker: () => void;
}

/** Each readEntries call returns at most ~100 entries, and only an empty
 * batch means the directory is done — so drain the reader in a loop. */
async function readAll(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch: FileSystemEntry[] = await new Promise((res, rej) =>
      reader.readEntries(res, rej),
    );
    if (!batch.length) return all;
    all.push(...batch);
  }
}

/** What walking a dropped tree found: the files worth sending, and the paths
 * that could not be read at all. */
interface Walked {
  files: File[];
  skipped: string[];
}

/** Walk a dropped directory tree, renaming each file to its path within the
 * drop. The engine reads that path back into the workspace tree, so a file
 * dropped as `manuals/hydraulics/scan.pdf` gets that id and not `scan`.
 *
 * Siblings are read concurrently: each entry costs a round trip through the
 * callback-based filesystem API, so awaiting them serially makes a 300-file
 * folder take the *sum* of 300 latencies. Returning each subtree's files
 * rather than pushing into a shared accumulator is what keeps that safe;
 * `flatMap` restores directory order.
 *
 * Nothing in here rejects. An unreadable file or folder is skipped and named
 * in `skipped` -- one bad entry in a 300-file folder should not sink the
 * whole drop, and nor should it vanish without a word. A file is only named
 * if it was one the drop would have taken. */
async function walk(entry: FileSystemEntry, prefix: string): Promise<Walked> {
  const path = prefix + entry.name;
  if (entry.isFile) {
    return new Promise<Walked>((res) =>
      (entry as FileSystemFileEntry).file(
        (f) =>
          res({
            files: wanted(path) ? [new File([f], path, { type: f.type })] : [],
            skipped: [],
          }),
        () => res({ files: [], skipped: wanted(path) ? [path] : [] }),
      ),
    );
  }
  if (entry.isDirectory) {
    let entries: FileSystemEntry[];
    try {
      entries = await readAll(
        (entry as FileSystemDirectoryEntry).createReader(),
      );
    } catch {
      return { files: [], skipped: [`${path}/`] };
    }
    const nested = await Promise.all(
      entries.map((ent) => walk(ent, `${path}/`)),
    );
    return {
      files: nested.flatMap((n) => n.files),
      skipped: nested.flatMap((n) => n.skipped),
    };
  }
  return { files: [], skipped: [] };
}

/** The plumbing behind <DropZone />: drag highlight, directory walking,
 * the two hidden file inputs, and the in-flight / settled states.
 *
 * `onFiles` receives only .pdf, .zip and `mdgest.json`, never an empty list.
 * It is called with names already rewritten to their relative path inside a
 * dropped or picked folder ("chapter-2/scan.pdf"), which is how folder
 * structure reaches the engine: a File carries a name and nothing else about
 * where it came from.
 */
export function useDropZone({
  onFiles,
}: {
  onFiles: (files: File[]) => Promise<void>;
}): DropZoneApi {
  const [isDragging, setDragging] = useState(false);
  const [isLoading, setLoading] = useState(false);
  // The last upload's outcome while it is still showing: an error, or a
  // success, which is a settle with nothing to say. One state, because the
  // two are never shown together and always cleared together.
  const [settled, setSettled] = useState<{ error: string | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);

  // Drops overlap: a second one can land while the first is still uploading.
  // Only the last to finish settles, so an early `finally` cannot blank the
  // spinner out from under the drop that is still going.
  const inflight = useRef(0);
  const pendingErr = useRef<string | null>(null);

  // Enter and leave arrive in pairs for every child the pointer crosses, so
  // counting them is what says whether it is still over the zone.
  const depth = useRef(0);

  // One timer for both flashes: a second drop restarts the clock rather than
  // letting the first drop's timeout blank the second one's result early.
  const flash = useRef<ReturnType<typeof setTimeout>>(undefined);
  const settle = useCallback((error: string | null) => {
    setSettled({ error });
    clearTimeout(flash.current);
    flash.current = setTimeout(() => setSettled(null), FLASH_MS);
  }, []);
  useEffect(() => () => clearTimeout(flash.current), []);

  /** `carried` is what the gesture handed over *before* our filtering, which
   * only the caller knows: walk() drops non-PDFs as it recurses, so a folder of
   * 300 JPEGs and a drag carrying nothing both arrive here as an empty `files`.
   * Defaulted for the picker paths, where no filtering happens first.
   * `skipped` is what the walk could not read. */
  const handle = useCallback(
    async (
      files: File[],
      src: Source,
      carried = files.length > 0,
      skipped: string[] = [],
    ) => {
      const ok = files.filter((f) => wanted(f.name));
      const unread = skipped.length ? unreadable(skipped) : null;
      // An error from any drop wins the shared settle — a failure is worth
      // more of the one message slot than a sibling's success — and two are
      // both kept, since each is about different files.
      const say = (message: string) => {
        pendingErr.current = pendingErr.current
          ? `${pendingErr.current} ${message}`
          : message;
      };
      if (!ok.length) {
        // Never settle a no-op as success: settle(null) renders the green
        // "Added." tick, claiming an upload for a request never sent.
        const msg = unread ?? (carried ? NO_MATCH[src] : EMPTY[src]);
        if (!msg) return;
        // Held for a drop still in flight rather than shown now, where that
        // drop's settle would paint over it the moment it lands.
        if (inflight.current > 0) say(msg);
        else settle(msg);
        return;
      }
      inflight.current += 1;
      setLoading(true);
      setSettled(null);
      if (unread) say(unread);
      try {
        await onFiles(ok);
      } catch (e) {
        say(messageOf(e));
      } finally {
        if (--inflight.current === 0) {
          setLoading(false);
          settle(pendingErr.current);
          pendingErr.current = null;
        }
      }
    },
    [onFiles, settle],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setDragging(false);
      // Read the DataTransfer before the first await — it is neutered once the
      // handler returns. Each item is taken as an entry where the browser
      // offers one, which is what lets a folder be walked, and as a plain file
      // where it does not: a drop can mix the two, and taking only the entries
      // would lose the rest. `files` is the fallback for a browser that gives
      // no items, and how a drag carrying files we rejected is told from one
      // carrying none (a text/uri-list drag, which has no file items).
      const entries: FileSystemEntry[] = [];
      const plain: File[] = [];
      for (const item of Array.from(e.dataTransfer.items ?? [])) {
        if (item.kind !== "file") continue;
        const entry = item.webkitGetAsEntry?.();
        const file = entry ? null : item.getAsFile();
        if (entry) entries.push(entry);
        else if (file) plain.push(file);
      }
      const dropped = Array.from(e.dataTransfer.files);
      const fromItems = entries.length + plain.length > 0;
      const walked = await Promise.all(entries.map((ent) => walk(ent, "")));
      await handle(
        fromItems ? [...walked.flatMap((w) => w.files), ...plain] : dropped,
        "drop",
        fromItems || dropped.length > 0,
        walked.flatMap((w) => w.skipped),
      );
    },
    [handle],
  );

  const onPicked = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // Both inputs share this handler; only the gesture's name differs.
      const src: Source = e.target === dirRef.current ? "dir" : "file";
      const picked = Array.from(e.target.files ?? []);
      // A folder pick carries its structure on webkitRelativePath; a plain
      // file pick has none, so name is the whole path.
      const named = picked.map((f) => {
        const rel = (f as File & { webkitRelativePath?: string })
          .webkitRelativePath;
        return rel ? new File([f], rel, { type: f.type }) : f;
      });
      // Reset synchronously so re-picking the same file fires change again.
      e.target.value = "";
      void handle(named, src);
    },
    [handle],
  );

  return {
    isDragging,
    isLoading,
    error: settled?.error ?? null,
    success: settled !== null && settled.error === null,
    dropProps: {
      onDragEnter: (e) => {
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      },
      onDragOver: (e) => {
        e.preventDefault();
        e.stopPropagation();
      },
      // Counted rather than asked of `relatedTarget`, whether the pointer went
      // into a child: that works everywhere but Safari, which leaves it null
      // on dragleave, so every child crossed blanked the highlight and it
      // strobed.
      onDragLeave: (e) => {
        e.preventDefault();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      },
      onDrop: (e) => void onDrop(e),
    },
    fileInputProps: { ref: fileRef, onChange: onPicked },
    dirInputProps: { ref: dirRef, onChange: onPicked },
    openFilePicker: () => fileRef.current?.click(),
    openFolderPicker: () => dirRef.current?.click(),
  };
}
