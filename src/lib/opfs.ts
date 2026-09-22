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
 * and not the File System Access API, and what the export format is:
 * docs/storage.md.
 */

import {
  CACHE,
  MANIFEST,
  MARKDOWN,
  SOURCES,
  assetsDir,
  byCodePoint,
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
 *  Spec: https://fs.spec.whatwg.org/#api-filesystemsyncaccesshandle */
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
  }
}

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
export async function space(): Promise<{ usage: number; quota: number; free: number }> {
  const { usage = 0, quota = 0 } = (await navigator.storage.estimate?.()) ?? {};
  return { usage, quota, free: Math.max(0, quota - usage) };
}

/** Walk to a directory, optionally creating it. `null` when it is not there
 *  and `create` was not asked for, so callers can branch instead of catching. */
async function dirAt(
  path: string[],
  create = false,
): Promise<FileSystemDirectoryHandle | null> {
  let dir = await root();
  for (const name of path) {
    try {
      dir = await dir.getDirectoryHandle(name, { create });
    } catch {
      return null;
    }
  }
  return dir;
}

async function fileAt(path: string[], create = false): Promise<FileSystemFileHandle | null> {
  const name = path.at(-1);
  if (!name) return null;
  const dir = await dirAt(path.slice(0, -1), create);
  if (!dir) return null;
  try {
    return await dir.getFileHandle(name, { create });
  } catch {
    return null;
  }
}

/** Replace a file's contents.
 *
 * `truncate(0)` before writing, not after: a sync handle writes at an offset
 * into whatever is already there, so overwriting a long file with a short one
 * would leave the tail of the old one behind and produce JSON that parses.
 */
export async function writeFile(path: string[], data: ArrayBuffer | Uint8Array): Promise<void> {
  const handle = await fileAt(path, true);
  if (!handle) throw new Error(`cannot create ${path.join("/")}`);
  const access = await handle.createSyncAccessHandle();
  try {
    access.truncate(0);
    access.write(data instanceof Uint8Array ? data : new Uint8Array(data), { at: 0 });
    access.flush();
  } catch (cause) {
    // A full disk arrives as a bare DOMException carrying the browser's own
    // wording, and the drop zone renders a message verbatim to whoever is
    // standing there. Say what failed and what to do about it instead.
    if (cause instanceof DOMException && cause.name === "QuotaExceededError") {
      throw new Error(
        `No room left in this browser to write ${path.join("/")}. Free some space and try again.`,
      );
    }
    throw cause;
  } finally {
    // Not optional and not deferrable: an unclosed sync handle holds an
    // exclusive lock on the file, and the next open of it rejects.
    access.close();
  }
}

export async function readFile(path: string[]): Promise<Uint8Array<ArrayBuffer> | null> {
  const handle = await fileAt(path);
  if (!handle) return null;
  const access = await handle.createSyncAccessHandle();
  try {
    const buf = new Uint8Array(access.getSize());
    access.read(buf, { at: 0 });
    return buf;
  } finally {
    access.close();
  }
}

/** How long a file is, without reading it.
 *
 * The sync handle answers this outright, and `readFile` above only knows the
 * length because it asks the same question before allocating. Worth its own
 * export because the landing's listing wants a length beside every document's
 * name: taking that from the bytes made a returning visit pay a read of every
 * PDF in the workspace to print numbers it could have asked for. `null` where
 * `readFile` would also have given nothing.
 */
export async function size(path: string[]): Promise<number | null> {
  const handle = await fileAt(path);
  if (!handle) return null;
  const access = await handle.createSyncAccessHandle();
  try {
    return access.getSize();
  } finally {
    access.close();
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function writeText(path: string[], text: string): Promise<void> {
  await writeFile(path, enc.encode(text));
}

export async function readText(path: string[]): Promise<string | null> {
  const bytes = await readFile(path);
  return bytes === null ? null : dec.decode(bytes);
}

export async function writeJson(path: string[], value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 1)}\n`);
}

export async function remove(path: string[], recursive = false): Promise<void> {
  const name = path.at(-1);
  if (!name) return;
  const dir = await dirAt(path.slice(0, -1));
  await dir?.removeEntry(name, { recursive }).catch((cause: unknown) => {
    // Already gone is what was asked for. Anything else -- a file another tab
    // holds open -- is a remove that did not happen, and has to say so rather
    // than let a discard report a workspace emptied that is not.
    if (!(cause instanceof DOMException && cause.name === "NotFoundError")) throw cause;
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
  const visit = async (handle: FileSystemDirectoryHandle, prefix: string): Promise<string[]> => {
    const entries: [string, FileSystemHandle][] = [];
    for await (const entry of handle.entries()) entries.push(entry);
    entries.sort(([a], [b]) => byCodePoint(a, b));
    const below = await Promise.all(
      entries.map(([name, child]) => {
        const rel = prefix ? `${prefix}/${name}` : name;
        return child.kind === "file" ? [rel] : visit(child as FileSystemDirectoryHandle, rel);
      }),
    );
    return below.flat();
  };
  return visit(dir, "");
}

// ---- documents ------------------------------------------------------------

export async function sha256(data: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Every document in the workspace, by id.
 *
 * Derived from `sources/` rather than kept as an index: the PDFs are the only
 * thing that cannot be recomputed from something else here, so a listing taken
 * from them cannot go stale against them.
 */
export async function docs(): Promise<string[]> {
  const found = await walk([SOURCES]);
  return found
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
    .sort(byCodePoint);
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
export async function writeSource(docId: string, buf: ArrayBuffer): Promise<void> {
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
  await writeJson([MANIFEST], manifest);
}

/** Empty the workspace: sources, outputs, cache and manifest. One workspace
 *  lives in a browser at a time, so continuing from another means this one
 *  goes -- which is why the landing confirms before calling it. */
export async function clearWorkspace(): Promise<void> {
  await Promise.all([
    ...[SOURCES, MARKDOWN, CACHE].map((name) => remove([name], true)),
    remove([MANIFEST]),
  ]);
  await ensureWorkspace();
}

/** Make the folders a workspace always has, so a fresh origin lists as empty
 *  rather than as broken. */
export async function ensureWorkspace(): Promise<void> {
  await Promise.all([SOURCES, MARKDOWN, CACHE].map((name) => dirAt([name], true)));
}
