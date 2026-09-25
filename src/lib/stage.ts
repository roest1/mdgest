/** What has been dropped and not yet written.
 *
 * The landing holds uploads here, in the worker's memory, and writes none of
 * them to OPFS until a person presses the button under the listing. So the
 * listing is the confirmation: every row says what committing will do to it,
 * and a row that would need a decision -- two different files for one id --
 * keeps the button off until one is kept or renamed. The one prompt is the
 * landing's, at commit, for rows that would write over a listed source. The
 * one write that happens outside that rule is `seed` recording hashes of
 * documents already in OPFS, which changes nothing anybody dropped.
 *
 * One workspace at a time. The slot holds either an upload with a manifest
 * or the workspace already in OPFS from an earlier visit, seeded on the first
 * look. Loose PDFs join whichever it is; a second workspace is refused until
 * the first is discarded. That is the whole model, and it is what lets
 * resuming, adding to, and replacing a workspace be one flow rather than
 * three.
 *
 * Every entry point that mutates is serialized through `exclusive`: drops
 * overlap, and the check for "is a workspace already staged" has awaits
 * between it and the assignment. Every write to OPFS also goes through
 * `guarded`, which makes the same promise to other tabs.
 */

import { MAX_DROP, MAX_ENTRIES, MAX_FILE, MAX_MANIFEST, RESERVE } from "./limits";
import * as opfs from "./opfs";
import type { Candidate, Origin, StageRow, StageView, Status } from "./protocol";
import { unzip } from "./unzip";
import { isJunk, isPdf, isZip, relativeTo, under, workspaceRoots } from "./upload";
import { human, messageOf, plural } from "./words";
import {
  MANIFEST,
  SOURCES,
  byCodePoint,
  cleanId,
  copyManifest,
  docIdFor,
  emptyManifest,
  isDocId,
  parseManifest,
  renamedId,
  sourcePath,
  stem,
  WORKSPACE_ID,
  type Manifest,
} from "./workspace";

interface Staged extends Candidate {
  /** Null for the browser's own documents, which are already in OPFS. */
  blob: Blob | null;
}

interface Workspace {
  name: string | null;
  origin: "upload" | "browser";
  manifest: Manifest;
}

let workspace: Workspace | null = null;
/** Why the workspace in this browser could not be opened, when it could not.
 *  It is a workspace all the same -- the one copy of whatever was not
 *  exported -- so nothing is staged beside it and nothing written over it
 *  until a person discards it. */
let unreadable: string | null = null;
/** By id, in arrival order. More than one entry under an id is a conflict;
 *  the same bytes arriving twice under one id collapse to one. */
const candidates = new Map<string, Staged[]>();
/** What `keep` set aside, by id, so taking the kept copy out brings the
 *  choice back rather than leaving a hole. */
const shadowed = new Map<string, Staged[]>();

let lock: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn);
  lock = run.catch(() => {});
  return run;
}

// ---- other tabs -----------------------------------------------------------

/** What OPFS held: the ids under `sources/` and the manifest's exact text. */
interface Snapshot {
  docs: string[];
  manifest: string | null;
}

/** OPFS as this stage last looked at or wrote it. Null until the first look,
 *  which is how `seed` knows it has not run. */
let seen: Snapshot | null = null;

async function look(): Promise<Snapshot> {
  const [docs, manifest] = await Promise.all([opfs.docs(), opfs.manifestText()]);
  return { docs, manifest };
}

function same(a: Snapshot, b: Snapshot | null): boolean {
  return (
    b !== null &&
    a.manifest === b.manifest &&
    a.docs.length === b.docs.length &&
    a.docs.every((id, i) => id === b.docs[i])
  );
}

const WORKSPACE_LOCK = `mdgest-workspace:${WORKSPACE_ID}`;

/** Run `fn` holding the workspace against every other tab of this origin.
 *
 * `exclusive` orders this worker's calls, but a second tab has a worker, and
 * a stage, of its own. Web Locks are the one lock tabs share. They are what
 * sets Safari's floor at 15.4, past the 15.2 the synchronous handle asks for
 * -- see docs/deployment.md. Not reentrant: nothing called inside `fn` may
 * take it. */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  return navigator.locks.request(WORKSPACE_LOCK, fn);
}

/** Write to OPFS, but only if it still holds what this stage was built from.
 *
 * A stage is one look at the workspace, and another tab can write between
 * that look and a commit. A stage that saw an empty browser would then clear
 * the workspace the other tab had just made, and one that saw an older
 * manifest would write it back over the newer one -- both silently. So the
 * look is repeated under the lock before anything is written, and taken again
 * after, because what was written is now what this stage has seen. */
async function guarded<T>(write: () => Promise<T>): Promise<T> {
  return locked(async () => {
    if (!same(await look(), seen)) {
      throw new Error(
        "The workspace in this browser has changed since this page listed it, " +
          "probably in another tab. Reload to see it as it is now.",
      );
    }
    try {
      return await write();
    } finally {
      // Left as it was if the look fails, which can only make the next write refuse.
      seen = await look().catch(() => seen);
    }
  });
}

/** Nothing staged and nothing seen, so the next look seeds again from OPFS. */
function forget(): void {
  workspace = null;
  unreadable = null;
  candidates.clear();
  shadowed.clear();
  seen = null;
}

// ---- the view -------------------------------------------------------------

function listedIds(): string[] {
  return workspace ? Object.keys(workspace.manifest.documents) : [];
}

function listedHash(docId: string): string | undefined {
  return workspace?.manifest.documents[docId]?.sha256;
}

function statusOf(docId: string, own: Staged[], owner: Map<string, string>): Status {
  if (own.length === 0) return "missing";
  if (own.length > 1) return "conflict";
  const [c] = own;
  if (workspace && docId in workspace.manifest.documents) {
    const listed = listedHash(docId);
    // An entry an export left unhashed has nothing to compare against. Its
    // own source, arriving with it, is what it lists; any other copy under
    // its id may not be, and is marked for a look.
    if (listed === undefined) return c.from === "workspace" ? "unchanged" : "revised";
    return listed === c.sha256 ? "unchanged" : "revised";
  }
  const first = owner.get(c.sha256);
  return first !== undefined && first !== docId ? "duplicate" : "new";
}

function view(): StageView {
  // Listed ids first, then arrivals in order: the manifest's documents own
  // their bytes, so a loose copy of one of them is the duplicate, never the
  // other way round.
  const ids = [...new Set([...listedIds(), ...candidates.keys()])];
  const owner = new Map<string, string>();
  const rows: StageRow[] = ids.map((docId) => {
    const own = candidates.get(docId) ?? [];
    const status = statusOf(docId, own, owner);
    if (own.length === 1 && status !== "duplicate" && !owner.has(own[0].sha256)) {
      owner.set(own[0].sha256, docId);
    }
    return {
      docId,
      status,
      candidates: own.map((c) => ({ sha256: c.sha256, name: c.name, bytes: c.bytes, from: c.from })),
    };
  });
  rows.sort((a, b) => byCodePoint(a.docId, b.docId));
  return {
    workspace: workspace && {
      name: workspace.name,
      origin: workspace.origin,
      listed: listedIds().length,
    },
    unreadable,
    rows,
  };
}

// ---- staging --------------------------------------------------------------

interface Item {
  path: string;
  blob: Blob;
  /** The same bytes, already in memory: a zip's entry as fflate inflated
   *  it. Hashed from directly, which spares reading the blob back out -- a
   *  copy of every entry, for an archive that is already two of them. */
  bytes?: Uint8Array<ArrayBuffer>;
}

/** Put `staged` under `docId`. Answers the copy already there when these
 *  bytes are, in which case nothing changes: they are one copy. */
function insert(docId: string, staged: Staged): Staged | null {
  const own = candidates.get(docId) ?? [];
  const there = own.find((c) => c.sha256 === staged.sha256);
  if (there) return there;
  // The same bytes as a copy `keep` set aside come back out of the set-aside
  // pile rather than in beside it: they are one copy, and dropping it again
  // reopens the choice it lost.
  const aside = shadowed.get(docId)?.filter((c) => c.sha256 !== staged.sha256);
  if (aside?.length) shadowed.set(docId, aside);
  else shadowed.delete(docId);
  own.push(staged);
  candidates.set(docId, own);
  return null;
}

/** The files of a drop that were already here, by where their bytes already
 *  were: in the browser's workspace, or staged by an earlier drop. */
interface Repeats {
  uploaded: string[];
  staged: string[];
}

/** One line for each kind of repeat, naming a few and counting the rest, so
 *  a folder dropped twice is one sentence rather than a page of them. */
function sayRepeats(repeats: Repeats, rejected: string[]): void {
  for (const [names, where] of [
    [repeats.uploaded, "already uploaded"],
    [repeats.staged, "already staged"],
  ] as const) {
    if (names.length === 0) continue;
    const shown = names.slice(0, 3).join(", ");
    const more = names.length > 3 ? ` and ${names.length - 3} more` : "";
    rejected.push(`${shown}${more} ${names.length === 1 ? "is" : "are"} ${where}.`);
  }
}

async function hashed(docId: string, item: Item, from: Origin): Promise<[string, Staged]> {
  const buf = item.bytes ?? (await item.blob.arrayBuffer());
  const sha256 = await opfs.sha256(buf);
  return [docId, { sha256, name: item.path, bytes: buf.byteLength, from, blob: item.blob }];
}

/** An uploaded workspace's manifest, refused before it is read when it is
 *  larger than any manifest is -- see `MAX_MANIFEST`. */
async function uploadedManifest(item: Item): Promise<Manifest> {
  if (item.blob.size > MAX_MANIFEST) {
    throw new Error(
      `its ${MANIFEST} is ${human(item.blob.size)}, over the ${human(MAX_MANIFEST)} a manifest can be.`,
    );
  }
  return parseManifest(await item.blob.text());
}

/** How many documents are hashed at once.
 *
 * Web Crypto has no incremental digest -- `crypto.subtle.digest` takes the
 * whole buffer, there is no update/finish pair -- so `hashed` holds an entire
 * document in memory for as long as it takes to digest it. Running the batch
 * through `Promise.all` therefore made the peak every document in the drop at
 * once, on top of the blobs that stay staged until commit and, for a zip, the
 * archive and its inflated entries. A fixed width bounds that to a handful.
 *
 * It costs close to nothing: this is a read feeding a native digest, so a few
 * in flight already keep it busy, and the work is the same either way. Widen
 * it only against a measurement -- the reason for a small number here is peak
 * memory on someone else's machine, which no local run will show.
 */
const HASH_WIDTH = 4;

/** Run `tasks`, at most `width` at a time, and answer in the order given.
 *
 * Results land by index rather than by completion, because arrival order is
 * what decides which of two identical files is "the duplicate" -- see the
 * `owner` map in `view`. A pool that answered as tasks finished would hand
 * that decision to whichever document happened to hash faster.
 *
 * Rejection behaves as `Promise.all` does: the first one wins, and whatever
 * is still in flight runs to completion with its result dropped.
 */
async function pooled<T>(tasks: (() => Promise<T>)[], width: number): Promise<T[]> {
  const out = new Array<T>(tasks.length);
  let next = 0;
  const drain = async () => {
    for (let i = next++; i < tasks.length; i = next++) out[i] = await tasks[i]();
  };
  await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, drain));
  return out;
}

/** One batch of items that arrived together, which is the unit a workspace
 *  is looked for in: a dropped folder, or one zip's entries. */
async function stageGroup(
  items: Item[],
  zipName: string | null,
  rejected: string[],
  repeats: Repeats,
): Promise<void> {
  const roots = workspaceRoots(items.map((i) => i.path));
  // Each item belongs to the nearest workspace it sits in, or to none.
  const rootOf = (path: string) =>
    roots.find((root) => root !== "" && under(path, root)) ?? (roots.includes("") ? "" : null);
  // A file that cannot be read -- a dropped one since moved, a folder no
  // longer readable -- takes out only itself, said in `rejected` the way a
  // size or a bad archive is. Never the whole drop.
  const pending: (() => Promise<[string, Staged] | null>)[] = [];
  const hash = (docId: string, item: Item, from: Origin) => () =>
    hashed(docId, item, from).catch((cause: unknown) => {
      rejected.push(`${item.path} could not be read, so it was not staged: ${messageOf(cause)}`);
      return null;
    });
  let arriving: Workspace | null = null;

  for (const root of roots) {
    const name = root || (zipName ? stem(zipName) : "workspace");
    if (workspace) {
      const current =
        workspace.origin === "browser"
          ? "the workspace still in this browser"
          : `${workspace.name}`;
      rejected.push(`One workspace at a time: ${name} was not staged. Discard ${current} first.`);
      continue;
    }
    if (arriving) {
      rejected.push(
        `One workspace at a time: ${name} was not staged, since ${arriving.name} came in the same drop.`,
      );
      continue;
    }
    const inside = items.filter((i) => rootOf(i.path) === root);
    const manifestItem = inside.find((i) => relativeTo(i.path, root) === MANIFEST)!;
    const manifest = await uploadedManifest(manifestItem).catch((cause: unknown) => {
      rejected.push(`${name} was not staged: ${messageOf(cause)}`);
      return null;
    });
    if (!manifest) continue;
    arriving = { name, origin: "upload", manifest };
    const sources = root ? `${root}/${SOURCES}` : SOURCES;
    for (const item of inside) {
      if (!under(item.path, sources) || !isPdf(item.path)) continue;
      // An exported source already sits at its id, and cleaning is the
      // identity on a clean path. Not slugged: a slug of a hand-renamed
      // file would invent an id the manifest has never heard of.
      const docId = cleanId(relativeTo(item.path, sources).slice(0, -".pdf".length));
      // The one thing cleaning cannot turn into an id is a name of
      // nothing but dots: `sources/.pdf` cleans away to "".
      if (!isDocId(docId)) {
        rejected.push(`${item.path} was not staged: it has no name to be a document under.`);
        continue;
      }
      pending.push(hash(docId, item, "workspace"));
    }
  }

  for (const item of items) {
    if (rootOf(item.path) !== null || !isPdf(item.path)) continue;
    pending.push(hash(docIdFor(item.path), item, "loose"));
  }

  // Hashed a few at a time, inserted in arrival order: order is what decides
  // which of two identical files is "the duplicate".
  const results = await pooled(pending, HASH_WIDTH);
  // The slot is taken only now, with every source read or accounted for. Put
  // in it before, and left there by a failure partway, a workspace would hold
  // the slot with nothing staged and refuse the same folder dropped again.
  if (arriving) workspace = arriving;
  for (const result of results) {
    if (!result) continue;
    const there = insert(...result);
    if (there) (there.from === "browser" ? repeats.uploaded : repeats.staged).push(result[1].name);
  }
}

export function stage(files: File[]): Promise<{ view: StageView; rejected: string[] }> {
  return exclusive(async () => {
    await seed();
    if (unreadable) throw new Error(`${unreadable} Discard it before adding anything.`);
    const rejected: string[] = [];
    const repeats: Repeats = { uploaded: [], staged: [] };
    const plain: Item[] = [];
    // Count and size are checked before anything is read, and a drop that is
    // partly over either stages the rest: the listing is what a person reads,
    // and it says more if it holds everything that could be taken beside the
    // sentence about what could not.
    let count = 0;
    let dropped = 0;
    for (const file of files) {
      if (isJunk(file.name)) continue;
      if (++count > MAX_ENTRIES) {
        rejected.push(
          `More than ${MAX_ENTRIES.toLocaleString("en-US")} files in one drop: ${file.name} and anything after it were not staged.`,
        );
        break;
      }
      if (file.size > MAX_FILE) {
        rejected.push(
          `${file.name} is ${human(file.size)}, over the ${human(MAX_FILE)} one file can be, so it was not staged.`,
        );
        continue;
      }
      dropped += file.size;
      if (dropped > MAX_DROP) {
        rejected.push(
          `More than ${human(MAX_DROP)} in one drop: ${file.name} and anything after it were not staged.`,
        );
        break;
      }
      if (!isZip(file.name)) {
        plain.push({ path: file.name, blob: file });
        continue;
      }
      // A zip is a batch of its own: its entry paths say nothing about where
      // the archive sat in the drop, so it is looked at for a workspace on
      // its own terms. fflate hands back views into one buffer, which the
      // Blob constructor copies -- and for a view it copies that view's range
      // and nothing else -- so the blobs pin neither the archive nor fflate's
      // output, and an explicit copy here would only be a second one.
      let entries;
      try {
        entries = unzip(await file.arrayBuffer());
      } catch (cause) {
        // An archive that is too large, or not one at all, takes only itself
        // out of the drop. The rest of what was dropped still stages.
        rejected.push(`${file.name} was not staged: ${messageOf(cause)}`);
        continue;
      }
      await stageGroup(
        entries.map((e) => ({ path: e.path, blob: new Blob([e.bytes]), bytes: e.bytes })),
        file.name,
        rejected,
        repeats,
      );
    }
    if (plain.length) await stageGroup(plain, null, rejected, repeats);
    sayRepeats(repeats, rejected);
    return { view: view(), rejected };
  });
}

export function unstage(docId: string, sha256: string): Promise<StageView> {
  return exclusive(async () => {
    const own = candidates.get(docId) ?? [];
    const target = own.find((c) => c.sha256 === sha256);
    if (!target) return view();
    if (target.from === "browser") {
      throw new Error("A document already in the browser is removed in the editor, not here.");
    }
    const rest = own.filter((c) => c !== target);
    // The last copy out brings back what `keep` set aside, so the choice is
    // reopened rather than the row left empty. Until then it stays aside:
    // taking out a copy dropped since the choice is not a reason to lose it.
    const back = rest.length === 0 ? (shadowed.get(docId) ?? []) : [];
    if (rest.length === 0) shadowed.delete(docId);
    const remaining = [...rest, ...back];
    if (remaining.length) candidates.set(docId, remaining);
    else candidates.delete(docId);
    return view();
  });
}

export function keep(docId: string, sha256: string): Promise<StageView> {
  return exclusive(async () => {
    const own = candidates.get(docId) ?? [];
    const kept = own.find((c) => c.sha256 === sha256);
    if (!kept) return view();
    shadowed.set(docId, [...(shadowed.get(docId) ?? []), ...own.filter((c) => c !== kept)]);
    candidates.set(docId, [kept]);
    return view();
  });
}

/** Move one staged copy to the id `name` makes, rather than choose between it
 *  and the others under its id. Refused onto any id already in use -- staged,
 *  set aside, or listed by the workspace -- because a rename is a way out of
 *  a conflict and must not be a way into another one. */
export function renameCandidate(docId: string, sha256: string, name: string): Promise<StageView> {
  return exclusive(async () => {
    const own = candidates.get(docId) ?? [];
    const target = own.find((c) => c.sha256 === sha256);
    if (!target) return view();
    if (target.from === "browser") {
      throw new Error("A document already in the browser is renamed in the editor, not here.");
    }
    if (!name.trim()) throw new Error("Give it a name.");
    const next = renamedId(docId, name);
    if (next === docId) throw new Error(`${docId} is the name it already has.`);
    if (candidates.has(next) || shadowed.has(next) || listedIds().includes(next)) {
      throw new Error(`${next} is already taken. Try another name.`);
    }
    const rest = own.filter((c) => c !== target);
    // As in `unstage`: the last copy out brings back what `keep` set aside.
    const back = rest.length === 0 ? (shadowed.get(docId) ?? []) : [];
    if (rest.length === 0) shadowed.delete(docId);
    const remaining = [...rest, ...back];
    if (remaining.length) candidates.set(docId, remaining);
    else candidates.delete(docId);
    candidates.set(next, [target]);
    return view();
  });
}

export function discardWorkspace(): Promise<StageView> {
  return exclusive(async () => {
    // The browser's own workspace is emptied, readable or not; an upload was
    // only ever staged, and forgetting it is enough.
    if (unreadable || workspace?.origin === "browser") await guarded(() => opfs.clearWorkspace());
    unreadable = null;
    if (!workspace) return view();
    const loose = (copies: Staged[] | undefined) => (copies ?? []).filter((c) => c.from === "loose");
    for (const docId of new Set([...candidates.keys(), ...shadowed.keys()])) {
      const kept = loose(candidates.get(docId));
      const aside = loose(shadowed.get(docId));
      // A loose copy set aside for the workspace's own comes back when that
      // copy goes: the choice it lost was against something no longer staged.
      const staying = kept.length ? kept : aside;
      if (staying.length) candidates.set(docId, staying);
      else candidates.delete(docId);
      if (kept.length && aside.length) shadowed.set(docId, aside);
      else shadowed.delete(docId);
    }
    workspace = null;
    return view();
  });
}

export function stageView(): Promise<StageView> {
  return exclusive(async () => {
    await seed();
    return view();
  });
}

/** Fill the workspace slot from OPFS, once, if something is there. Hashes
 *  come from the manifest where it has them and from the bytes where it does
 *  not, so a workspace written before manifests existed still lists.
 *
 *  Only that second case reads a PDF. A listed document has its hash already,
 *  and the one other thing a row shows is a length, which OPFS will say
 *  outright -- so a returning visit to a workspace with a manifest asks the
 *  file system a question per document rather than reading the corpus. It is
 *  worth the branch: this runs on the landing's first paint, and the whole
 *  page waits on it. */
async function seed(): Promise<void> {
  if (seen) return;
  // Under the lock, so a commit in another tab is never looked at halfway.
  const now = await locked(look);
  let stored: Manifest | null = null;
  if (now.manifest !== null) {
    try {
      stored = parseManifest(now.manifest);
    } catch (cause) {
      unreadable = `The workspace in this browser could not be opened: ${messageOf(cause)}`;
      seen = now;
      return;
    }
  }
  // A manifest with no sources is a workspace too: its documents are
  // missing, and its decisions wait for them. Only a browser with neither
  // holds nothing -- which is what lets a commit clear it.
  if (now.manifest === null && now.docs.length === 0) {
    seen = now;
    return;
  }

  // Read into locals and handed to the stage at the end, all at once. A read
  // that throws partway leaves the stage as unseeded as it found it, and the
  // next look tries again. Marked seen with its slot still empty, the stage
  // would pass for an empty browser, and a commit would clear the workspace
  // it had failed to read.
  //
  // Probed a few at a time, in the listing's order: each probe is a handful
  // of round trips to the file system, and a corpus of them one after the
  // other is what the first paint would otherwise wait on. `pooled` rather
  // than `Promise.all` for the same reason `hashed` is -- the branch that
  // reads a document holds all of it.
  const manifest = stored ?? emptyManifest();
  let filled = false;
  const probe = async (docId: string): Promise<[string, Staged] | null> => {
    const path = sourcePath(docId);
    let sha256 = manifest.documents[docId]?.sha256;
    let bytes: number;
    if (sha256 === undefined) {
      const buf = await opfs.readFile(path);
      if (!buf) return null;
      sha256 = await opfs.sha256(buf);
      bytes = buf.byteLength;
      filled = true;
    } else {
      const size = await opfs.size(path);
      if (size === null) return null;
      bytes = size;
    }
    return [docId, { sha256, name: `${docId}.pdf`, bytes, from: "browser", blob: null }];
  };
  const found = await pooled(
    now.docs.map((docId) => () => probe(docId)),
    HASH_WIDTH,
  );
  seen = now;
  workspace = { name: null, origin: "browser", manifest };
  for (const entry of found) {
    if (!entry) continue;
    const [docId, staged] = entry;
    manifest.documents[docId] = { ...manifest.documents[docId], sha256: staged.sha256 };
    insert(docId, staged);
  }

  // Written back, so the read above is the last one this workspace needs. The
  // fills are in memory otherwise, and only `commit` persists them -- which
  // means someone who looks at a workspace without changing it rehashes the
  // whole corpus on every visit, and looking without changing is the common
  // visit. A failure here is not one: it costs the next visit the read this
  // one just paid, and the listing in front of the person is already right.
  if (filled) await guarded(() => opfs.writeManifest(manifest)).catch(() => {});
}

/** A staged file's bytes, read again to be written.
 *
 * A dropped `File` is the browser's handle on a file still on someone's disk,
 * and it can have moved or changed since it was hashed. A browser may refuse
 * to read it or may read what is there now, so both are caught, the second by
 * hashing again: the manifest records the hash taken at the drop, and that
 * has to be the hash of what is written. A zip's entries are Blobs made here,
 * in memory, and cannot change. */
async function readAgain(staged: Staged, blob: Blob): Promise<ArrayBuffer> {
  const gone = new Error(
    `${staged.name} was moved or changed after it was dropped. Take it out and drop it again.`,
  );
  const buf = await blob.arrayBuffer().catch(() => {
    throw gone;
  });
  if (blob instanceof File && (await opfs.sha256(buf)) !== staged.sha256) throw gone;
  return buf;
}

// ---- commit ---------------------------------------------------------------

export function commit(): Promise<{ docs: string[] }> {
  return exclusive(async () => {
    if (unreadable) throw new Error(unreadable);
    const { rows } = view();
    const conflicts = rows.filter((r) => r.status === "conflict").length;
    if (conflicts) throw new Error(`${plural(conflicts, "conflict")} to resolve first.`);
    if (rows.length === 0) throw new Error("Nothing staged.");
    // A missing row has no copy to write, and its entry is kept as it is.
    const chosen = rows.flatMap((row) =>
      row.candidates.length === 1 ? [{ row, staged: candidates.get(row.docId)![0] }] : [],
    );

    // Room is asked for once, before anything is written, rather than found
    // missing by the write that fails. A commit that stops partway loses
    // nothing -- see below -- but it leaves the workspace half-written, and
    // someone told first can take documents out instead.
    //
    // `RESERVE` times what is written, because the sources are only what
    // arrives: markdown, its figures and the analysis cache all come out of
    // them afterwards. A zero free means the browser would not say, which is
    // not a reason to refuse -- `writeFile` still reports a real full disk in
    // words if it comes to that.
    let writing = 0;
    for (const { staged } of chosen) if (staged.blob) writing += staged.bytes;
    const { free } = await opfs.space();
    if (free > 0 && writing * RESERVE > free) {
      throw new Error(
        `Not enough room in this browser: ${human(writing)} to write, about ${human(free)} free, ` +
          `and the editor needs room again for what it derives from it. Free some space, or ` +
          `take some documents out of the listing first.`,
      );
    }

    // Built as copies, and the stage left as it is until everything is down:
    // a commit that fails partway can be pressed again, and replays all of it.
    const base = workspace?.manifest ?? emptyManifest();
    const pending = copyManifest(base);
    const final = copyManifest(base);
    for (const { row, staged } of chosen) {
      const entry = base.documents[row.docId];
      final.documents[row.docId] = { ...entry, sha256: staged.sha256 };
      // `undefined` is left out by JSON, so on disk this entry has no hash.
      pending.documents[row.docId] = { ...entry, sha256: staged.blob ? undefined : staged.sha256 };
    }

    await guarded(async () => {
      // A fresh workspace or an uploaded one takes the place of what the
      // browser held. A stage without the browser's workspace in it saw no
      // manifest and no sources, and `guarded` has just confirmed that is
      // still so -- so this clears at most what a vanished workspace derived.
      // The browser's own is added to in place.
      if (workspace?.origin !== "browser") await opfs.clearWorkspace();

      // The manifest is written twice, around the sources. The first write
      // carries every decision and leaves out the hash of each source about
      // to be written, and a document with no hash is one whose bytes are
      // hashed on the next look. So a commit that stops partway -- a full
      // disk, a dropped file since moved -- leaves a manifest that is wrong
      // about nothing: every decision is in it, and every hash in it matches
      // its bytes. The second write adds the hashes once the bytes are down.
      await opfs.writeManifest(pending);
      for (const { row, staged } of chosen) {
        if (!staged.blob) continue;
        // What was derived from the old bytes is wrong for the new ones.
        // Removed first: stopping between the two then leaves old bytes short
        // of their derivations, which come back, rather than new bytes beside
        // derivations of the old.
        if (row.status === "revised") await opfs.removeDerived(row.docId);
        await opfs.writeSource(row.docId, await readAgain(staged, staged.blob));
      }
      await opfs.writeManifest(final);
    });

    forget(); // the next look seeds from what was just written
    return { docs: await opfs.docs() };
  });
}

/** The workspace's documents as OPFS holds them now, for the editor.
 *
 * Read under the lock, so a commit in another tab is never listed halfway,
 * and read fresh rather than from the stage: after a commit the stage is
 * empty, and what the editor lists is the workspace, not an upload. */
export function docs(): Promise<string[]> {
  return locked(opfs.docs);
}

/** One committed document's bytes, for the editor to render. Under the lock
 *  for the same reason as `docs`: a commit in another tab writes sources one
 *  at a time, and this should see one either before it or after. */
export function source(docId: string): Promise<Uint8Array<ArrayBuffer>> {
  return locked(async () => {
    const bytes = await opfs.readFile(sourcePath(docId));
    if (!bytes) throw new Error(`${docId} is not in this workspace.`);
    return bytes;
  });
}
