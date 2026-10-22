/** The workspace, in the browser's own file system.
 *
 * Only ever imported from the worker: `createSyncAccessHandle()` is the one
 * synchronous file API a browser has, and it is not exposed on the main
 * thread. Resolving a handle is still async everywhere -- `getDirectoryHandle`
 * and `getFileHandle` return promises -- so the shape that keeps the engine
 * synchronous is to resolve a document's handles once when it opens and do the
 * I/O against them after, not to call `readFile` per block.
 *
 * Storage here is evictable and `edits.json` does not regenerate, so the page
 * asks for persistence when a workspace is committed -- `persist()` is not
 * exposed in a worker -- and an export is the only real durability. Why OPFS
 * is the README's tech stack; what the export format is, `exchange.ts`.
 */

import {
  CACHE,
  MANIFEST,
  MARKDOWN,
  SOURCES,
  TEMP,
  WORKSPACE_ID,
  WORKSPACES,
  assetsDir,
  byCodeUnit,
  cacheDir,
  isDocId,
  markdownPath,
  sourcePath,
  type Manifest,
} from "./workspace";

/** TypeScript's DOM lib omits the synchronous handle, and is right to: it does
 *  not exist on the main thread. Declaring it here rather than adding the
 *  `WebWorker` lib, which would collide with `DOM` across the whole program --
 *  and the narrow declaration is the more honest one anyway, since it says
 *  exactly which two calls this module needs a worker for.
 *
 *  `move` is missing for another reason: no spec has it yet, only every
 *  engine (Chrome 102, Firefox 111, Safari 15.2, all under the floor) and
 *  the platform tests, which hold it to replacing a file already at the
 *  destination. That replace is what `replaceFile` is built on -- and it
 *  is Safari 17.0 that made a move replace what is already there (its
 *  release notes: "starting to overwrite target by default"). Below that,
 *  the move of a text file over its previous version refuses, and
 *  `replaceFile` takes its fallback: every write still lands, but in
 *  place, with the window a closed tab can tear.
 *
 *  Spec: https://fs.spec.whatwg.org/#api-filesystemsyncaccesshandle
 *  Tests: wpt/fs/script-tests/FileSystemFileHandle-move.js */
declare global {
  interface FileSystemSyncAccessHandle {
    read(buffer: ArrayBufferView, options?: { at?: number }): number;
    write(buffer: ArrayBufferView, options?: { at?: number }): number;
    getSize(): number;
    truncate(size: number): void;
    flush(): void;
    close(): void;
  }
  interface FileSystemFileHandle {
    createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
    move(destination: FileSystemDirectoryHandle, name: string): Promise<void>;
  }
}

/** The workspace's folder, as path segments from the OPFS root. Every path
 *  this module takes is relative to it. */
const HOME = [WORKSPACES, WORKSPACE_ID];

async function root(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

/** What the browser says is left, in bytes.
 *
 * Advisory twice over. `estimate()` pads what it reports, deliberately, so
 * that usage cannot be read as a fingerprint, and the quota itself moves with
 * free disk space -- so this answers "is there obviously not room", never "is
 * there exactly room". Zeroes where the API is missing, which callers take as
 * no reason to refuse.
 */
export async function space(): Promise<{
  usage: number;
  quota: number;
  free: number;
}> {
  const { usage = 0, quota = 0 } = (await navigator.storage.estimate?.()) ?? {};
  return { usage, quota, free: Math.max(0, quota - usage) };
}

/** Whether `cause` is the browser saying the entry is not there -- the one
 *  failure `dirAt` and `fileAt` answer with `null`. Everything else (a file
 *  where a folder was asked for, a lock another tab holds, a disk the
 *  browser could not read) is rethrown: reported as "not there", a transient
 *  error would read as a workspace with no manifest, and a discard would
 *  follow. `remove` draws the same line. */
function isNotFound(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "NotFoundError";
}

/** The browser's failure, said for whoever is standing at the drop zone.
 *
 * A full disk and a held file arrive as bare DOMExceptions carrying the
 * browser's own wording ("The requested method cannot be executed because
 * the file handle is locked"), and the drop zone renders a message verbatim.
 * Every OPFS call that can meet either goes through here, so the sentence
 * is the same whichever call met it. The DOMException stays as the cause,
 * where a console shows it. Anything else is returned as it came. */
function describe(cause: unknown, path: string[]): unknown {
  if (!(cause instanceof DOMException)) return cause;
  const what = path.join("/") || "the workspace";
  if (cause.name === "QuotaExceededError") {
    return new Error(
      `No room left in this browser to write ${what}. Free some space and try again.`,
      { cause },
    );
  }
  // Held by a sync access handle: another tab's, or this tab's own
  // engine mid-read. Which one this layer cannot know, so neither is named.
  if (cause.name === "NoModificationAllowedError") {
    return new Error(
      `${what} is in use, here or in another tab of this browser. Try again in a moment.`,
      { cause },
    );
  }
  return cause;
}

/** Walk to a directory in the workspace, optionally creating it. `null` when
 *  it is not there and `create` was not asked for, so callers can branch
 *  instead of catching. */
async function dirAt(
  path: string[],
  create = false,
): Promise<FileSystemDirectoryHandle | null> {
  let dir = await root();
  for (const name of [...HOME, ...path]) {
    try {
      dir = await dir.getDirectoryHandle(name, { create });
    } catch (cause) {
      if (isNotFound(cause)) return null;
      throw cause;
    }
  }
  return dir;
}

/** A path as the folder it is in and the name it has there; no name for
 *  the workspace itself. */
function split(path: string[]): [dir: string[], name: string | undefined] {
  return [path.slice(0, -1), path.at(-1)];
}

/** The file `name` in `dir`, optionally creating it; `null` when it is not
 *  there and `create` was not asked for. */
async function fileIn(
  dir: FileSystemDirectoryHandle,
  name: string,
  create = false,
): Promise<FileSystemFileHandle | null> {
  try {
    return await dir.getFileHandle(name, { create });
  } catch (cause) {
    if (isNotFound(cause)) return null;
    throw cause;
  }
}

async function fileAt(
  path: string[],
  create = false,
): Promise<FileSystemFileHandle | null> {
  const [parent, name] = split(path);
  if (!name) return null;
  const dir = await dirAt(parent, create);
  return dir && fileIn(dir, name, create);
}

/** Replace a file's contents.
 *
 * `truncate(0)` before writing, not after: a sync handle writes at an offset
 * into whatever is already there, so overwriting a long file with a short one
 * would leave the tail of the old one behind and produce JSON that parses.
 *
 * Which is also why a write that fails partway would leave nothing at all.
 * With `keep`, what was there is read first and put back when the write
 * fails. That covers a write that throws, not a tab that is closed between
 * the truncate and the write -- every text file goes through `replaceFile`
 * for that, and `keep` is for its fallback alone. Off by default, for the
 * sources: they are written once, they are far the largest thing here to
 * hold a second copy of, and they are the one file still on the disk a
 * person dropped them from. Without `keep`, a write that fails takes with
 * it what it spoiled: the file it created, or the one it emptied. A source
 * left empty or cut short is one `docs()` lists, and the next look hashes
 * and records as the document itself. A file that was there and was never
 * reached -- the open itself refused -- is left as it was.
 */
export async function writeFile(
  path: string[],
  data: ArrayBuffer | Uint8Array,
  { keep = false }: { keep?: boolean } = {},
): Promise<void> {
  // One walk to the folder, and both looks at the file from there.
  const [parent, name] = split(path);
  const dir = name ? await dirAt(parent, true) : null;
  if (!name || !dir) throw new Error(`cannot create ${path.join("/")}`);
  const existed = (await fileIn(dir, name)) !== null;
  const handle = await fileIn(dir, name, true);
  if (!handle) throw new Error(`cannot create ${path.join("/")}`);
  const progress = { emptied: false };
  try {
    await fill(handle, data, keep, path, progress);
  } catch (cause) {
    if (!keep && (!existed || progress.emptied))
      await remove(path).catch(() => {});
    throw cause;
  }
}

/** `writeFile` once the handle is open. `path` is only for the message a
 *  full disk gets, which names the file a person knows of: for
 *  `replaceFile`, the one being replaced, not its temp. `progress.emptied`
 *  is set the moment the file's old bytes are gone, for the caller to know
 *  what a failure left. */
async function fill(
  handle: FileSystemFileHandle,
  data: ArrayBuffer | Uint8Array,
  keep: boolean,
  path: string[],
  progress = { emptied: false },
): Promise<void> {
  let access: FileSystemSyncAccessHandle | null = null;
  let had: Uint8Array | null = null;
  try {
    // Inside the try: the open is where a file another tab holds fails,
    // and that failure deserves the same sentence as a full disk below.
    access = await handle.createSyncAccessHandle();
    if (keep) {
      const size = access.getSize();
      if (size > 0) {
        // Assigned only once the read is through: a `read` that throws
        // leaves a buffer that is zeroes where it did not reach, and
        // putting that back is the loss this is here to prevent.
        const was = new Uint8Array(size);
        access.read(was, { at: 0 });
        had = was;
      }
    }
    progress.emptied = true;
    access.truncate(0);
    access.write(data instanceof Uint8Array ? data : new Uint8Array(data), {
      at: 0,
    });
    access.flush();
  } catch (cause) {
    // What was there, back where it was. Best effort, on the handle already
    // open: if this fails too the file is lost either way, and the error
    // thrown below is still the one that says what happened. `had` is set
    // only once the read is through, so it implies the truncate followed.
    if (access && had) {
      try {
        access.truncate(0);
        access.write(had, { at: 0 });
        access.flush();
      } catch {
        // Nothing further to try.
      }
    }
    throw describe(cause, path);
  } finally {
    // Not optional and not deferrable: an unclosed sync handle holds an
    // exclusive lock on the file, and the next open of it rejects.
    access?.close();
  }
}

/** Replace a file whole or not at all: write a temp file, then move it over.
 *
 * For every text file. `writeFile` truncates and then writes, so a tab
 * closed between the two leaves the file empty or torn -- and an empty
 * `edits.json` is not a document whose save failed but one whose decisions
 * are gone, an empty `mdgest.json` is a workspace that refuses every action
 * and offers to discard itself, and an empty `analysis.json` is a document
 * `size()` reports as read that cannot be opened. Here the target holds its
 * old bytes until the move puts the new ones in their place, and a write
 * cut short leaves only a file in `.tmp/`, for `clearTemp`. It is also the
 * cheaper write: nothing is read first to be put back.
 *
 * The temp is named for this write, not for its target, so two writers
 * never share one. Where the move refuses -- an engine that will not replace
 * after all, a file someone holds open -- this falls back to `writeFile`
 * with `keep`, rather than fail a save that can still be made. A held file
 * fails that too, and says so.
 */
export async function replaceFile(
  path: string[],
  data: ArrayBuffer | Uint8Array,
): Promise<void> {
  const [parent, name] = split(path);
  const dir = name ? await dirAt(parent, true) : null;
  if (!name || !dir) throw new Error(`cannot create ${path.join("/")}`);
  // The temp only once the target is known to be writable: a temp made for
  // a target that is not would sit in .tmp/ until the next clearTemp.
  const temp = [TEMP, crypto.randomUUID()];
  const handle = await fileAt(temp, true);
  if (!handle) throw new Error(`cannot create ${path.join("/")}`);
  try {
    await fill(handle, data, false, path);
  } catch (cause) {
    await remove(temp).catch(() => {});
    throw cause;
  }
  try {
    await handle.move(dir, name);
  } catch (refused) {
    await remove(temp).catch(() => {});
    try {
      await writeFile(path, data, { keep: true });
    } catch (cause) {
      // Two failures, and the first is the one that says why the second
      // was tried at all: kept as the cause, where a console shows it.
      const said = describe(cause, path);
      if (said instanceof Error && said.cause === undefined)
        said.cause = describe(refused, path);
      throw said;
    }
  }
}

/** Remove what replacing writes left behind. Each is a write a closed tab
 *  cut short, whose target still holds what it held before, so there is
 *  nothing to finish -- only a file to drop. Safe only while no write can be
 *  under way, which is the caller's to arrange: `stage.sweep` holds the
 *  workspace's lock, and every replacing write is made under it. */
export async function clearTemp(): Promise<void> {
  await remove([TEMP], true);
}

/** A file's bytes, or null where there is no file.
 *
 * Through `getFile`, not a sync access handle: the handle is an exclusive
 * lock, and a read that takes one fails whenever another tab is writing the
 * same file, which a listing has no business doing. `getFile` holds no lock
 * and answers with the file as it was when asked, whole or not at all: the
 * snapshot is checked when its bytes are read, and a write that lands in
 * between fails the read rather than hand over half of each. That write
 * cannot land here: every read and every write of the workspace is made
 * under its lock, in `stage.ts`, so the failure is not caught or retried. */
export async function readFile(
  path: string[],
): Promise<Uint8Array<ArrayBuffer> | null> {
  const handle = await fileAt(path);
  if (!handle) return null;
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

/** How long a file is, without reading it.
 *
 * `getFile` answers this without touching the bytes. Worth its own export
 * because the landing's listing wants a length beside every document's
 * name: taking that from the bytes made a returning visit pay a read of every
 * PDF in the workspace to print numbers it could have asked for. `null` where
 * `readFile` would also have given nothing. No lock, as in `readFile`: a
 * listing has to answer while another tab is writing one of the files it
 * lists.
 */
export async function size(path: string[]): Promise<number | null> {
  const handle = await fileAt(path);
  if (!handle) return null;
  return (await handle.getFile()).size;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Text, written whole or not at all: see `replaceFile`. */
export async function writeText(path: string[], text: string): Promise<void> {
  await replaceFile(path, enc.encode(text));
}

export async function readText(path: string[]): Promise<string | null> {
  const bytes = await readFile(path);
  return bytes === null ? null : dec.decode(bytes);
}

export async function remove(path: string[], recursive = false): Promise<void> {
  const [parent, name] = split(path);
  if (!name) return;
  const dir = await dirAt(parent);
  await dir?.removeEntry(name, { recursive }).catch((cause: unknown) => {
    // Already gone is what was asked for. Anything else -- a file another tab
    // holds open -- is a remove that did not happen, and has to say so rather
    // than let a discard report a workspace emptied that is not.
    if (!isNotFound(cause)) throw describe(cause, path);
  });
}

/** Every file under `path`, as paths relative to it, depth first and sorted.
 *
 * Sorted because callers compare this: an OPFS directory iterates in whatever
 * order the implementation likes, and two listings of an unchanged workspace
 * have to read the same. Sibling folders are walked together, since each
 * costs a round trip and their order is settled by the sort anyway.
 */
export async function walk(path: string[]): Promise<string[]> {
  const dir = await dirAt(path);
  if (!dir) return [];
  const visit = async (
    handle: FileSystemDirectoryHandle,
    prefix: string,
  ): Promise<string[]> => {
    const entries: [string, FileSystemHandle][] = [];
    for await (const entry of handle.entries()) entries.push(entry);
    entries.sort(([a], [b]) => byCodeUnit(a, b));
    const below = await Promise.all(
      entries.map(([name, child]) => {
        const rel = prefix ? `${prefix}/${name}` : name;
        return child.kind === "file"
          ? [rel]
          : visit(child as FileSystemDirectoryHandle, rel);
      }),
    );
    return below.flat();
  };
  return visit(dir, "");
}

// ---- documents ------------------------------------------------------------

export async function sha256(
  data: ArrayBuffer | Uint8Array<ArrayBuffer>,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Every document in the workspace, by id.
 *
 * Derived from `sources/` rather than kept as an index: the PDFs are the only
 * thing that cannot be recomputed from something else here, so a listing taken
 * from them cannot go stale against them.
 */
export async function docs(): Promise<string[]> {
  const found = await walk([SOURCES]);
  return (
    found
      // Only what `sourcePath` could have written: an exact `.pdf`, under a
      // valid id. Anything else in `sources/` did not come from this build, and
      // listing it would hand out an id whose path leads somewhere other than
      // the file it was read from -- or, being no id at all, nowhere.
      .filter((p) => p.endsWith(".pdf"))
      .map((p) => p.slice(0, -4))
      .filter(isDocId)
      // Re-sorted after the extension comes off, not before. `walk` orders
      // filenames, and `-` sorts before `.`, so `pumps-2.pdf` lands ahead of
      // `pumps.pdf` -- an order that is correct for the files and visibly wrong
      // for the ids a person reads.
      .sort(byCodeUnit)
  );
}

/** Drop what was computed from a document and keep the document. This is
 *  what a revised source calls for: the analysis and the markdown were made
 *  from bytes that are no longer there, and the block ids they carry now point
 *  at whatever happens to sit at those positions. */
export async function removeDerived(docId: string): Promise<void> {
  await Promise.all([
    remove(cacheDir(docId), true),
    remove(markdownPath(docId)),
    remove(assetsDir(docId), true),
  ]);
}

/** Store a PDF at exactly this id, taken or not. The staging code has already
 *  settled what goes under each id -- a same-id-different-bytes pair is a
 *  conflict a person resolved before commit -- so there is nothing left to
 *  rename around, and renaming here would silently undo that choice. */
export async function writeSource(
  docId: string,
  buf: ArrayBuffer,
): Promise<void> {
  await writeFile(sourcePath(docId), buf);
}

// ---- the manifest ---------------------------------------------------------

/** The manifest's text, or null when there is none. Text rather than a
 *  manifest: the stage compares it exactly to tell whether another tab has
 *  written since it looked, and what an unreadable one means is a decision
 *  about the workspace, which is the stage's to make. */
export async function manifestText(): Promise<string | null> {
  return readText([MANIFEST]);
}

export async function writeManifest(manifest: Manifest): Promise<void> {
  await writeText([MANIFEST], `${JSON.stringify(manifest, null, 1)}\n`);
}

/** Empty the workspace by removing its folder whole: sources, outputs, cache,
 *  manifest, and anything else that found its way in. One workspace lives in
 *  a browser at a time, so continuing from another means this one goes --
 *  which is why the landing confirms before calling it. */
export async function clearWorkspace(): Promise<void> {
  const all = await (
    await root()
  ).getDirectoryHandle(WORKSPACES, { create: true });
  await all
    .removeEntry(WORKSPACE_ID, { recursive: true })
    .catch((cause: unknown) => {
      // As in `remove`: already gone is what was asked for, and anything else
      // is a discard that did not happen.
      if (!isNotFound(cause)) throw describe(cause, []);
    });
  await ensureWorkspace();
}

/** Make the folders a workspace always has, so a fresh origin lists as empty
 *  rather than as broken. */
export async function ensureWorkspace(): Promise<void> {
  await Promise.all(
    [SOURCES, MARKDOWN, CACHE].map((name) => dirAt([name], true)),
  );
}
