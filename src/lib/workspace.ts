/** Where things live in a workspace, and what a name is allowed to be.
 *
 * Every workspace has a folder of its own under `workspaces/` at the OPFS
 * root, and everything below is relative to that folder. The layout is the
 * engine's and does not change:
 *
 *   workspaces/<id>/
 *     mdgest.json                         the manifest
 *     sources/<folder…>/<doc>.pdf         what was uploaded
 *     markdown/<folder…>/<doc>.md         what came out
 *     markdown/<folder…>/<doc>.assets/    its figures
 *     .mdgest/<folder…>/<doc>.pdf/        analysis, edits, renders
 *     .tmp/<uuid>                         a replacing write, not yet moved
 *
 * A document's id is its path under `sources/` without the extension, and
 * `edits.json` is keyed to that. Every path a document has ends in a suffix
 * and no folder may, so a folder and a document never claim one name -- see
 * `cleanFolder`.
 */

/** The OPFS folder that holds one folder per workspace. */
export const WORKSPACES = "workspaces";

/** The one workspace this build keeps. A browser holds one at a time -- see
 *  `stage.ts` -- but it lives under an id all the same, so holding several
 *  is a change to who picks the id rather than to where anything is. */
export const WORKSPACE_ID = "default";

export const SOURCES = "sources";
export const MARKDOWN = "markdown";
/** Working cache. dot-directory here, because here it *is* a cache
 *  the export format is a visible `mdgest.json` and shares none of this. */
export const CACHE = ".mdgest";
/** Where `replaceFile` writes before it moves. At the workspace's top and
 *  not under `.mdgest/`, where a folder named `tmp` would be a document's. */
export const TEMP = ".tmp";

/** The longest a segment may be, in UTF-8 bytes. A workspace ends up as files
 *  and folders on someone's disk once it is exported, nearly every file
 *  system caps a name at 255 bytes, and the longest suffix a document's last
 *  segment is given is `.assets`. */
const MAX_SEGMENT_BYTES = 255 - ".assets".length;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** `text` cut to at most `max` UTF-8 bytes, never inside a character --
 *  a grapheme, not a code point: a base is not kept without its mark, nor
 *  a family emoji without its members. */
function cutToBytes(text: string, max: number): string {
  let bytes = 0;
  let cut = "";
  for (const { segment } of graphemes.segment(text)) {
    for (const ch of segment) {
      const code = ch.codePointAt(0)!;
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    }
    if (bytes > max) break;
    cut += segment;
  }
  return cut;
}

/** One name in a path, made safe to be a file or folder anywhere.
 *
 * Letters, marks and digits of any script are kept -- `报告` is a name, not
 * noise -- along with `.`, `_`, space and `-`; everything else becomes `-`.
 * NFC first, because macOS hands names over decomposed, and `é` as one code
 * point and as two would otherwise be two ids for one file.
 */
export function cleanSegment(name: string): string {
  const safe = cutToBytes(
    name
      .normalize("NFC")
      .trim()
      .replace(/[^\p{L}\p{M}\p{N}._ -]+/gu, "-") // replace all characters outside this set with '-'
      .replace(/-{2,}/g, "-"), // collapse multiple '-' into one
    MAX_SEGMENT_BYTES,
  ).replace(/^[ .]+|[ .]+$/g, ""); // trim leading and trailing dots and spaces -- after the cut, which can leave either at the end
  return safe || "untitled"; // fallback to 'untitled' if ''
}

/** A folder's name: a segment that does not end the way a document's paths do.
 *
 * The layout gives every document a suffix -- `sources/pumps.pdf`,
 * `markdown/pumps.md`, `markdown/pumps.assets/`, `.mdgest/pumps.pdf/` -- so a
 * folder called `pumps.pdf` or `pumps.assets` would share a name with one of
 * a document's paths, or sit inside its figures and go when they are removed.
 * Its last dot becomes `-` instead: `pumps-pdf/` reads the same and claims
 * nothing.
 */
function cleanFolder(name: string): string {
  const safe = cleanSegment(name);
  if (!/\.(pdf|md|assets)$/i.test(safe)) return safe;
  return safe.replace(/\.(\w+)$/, "-$1").replace(/-{2,}/g, "-");
}

/** The names in a path, with every traversal trick removed rather than rejected.
 *
 * `..` is dropped here rather than throwing, because this runs on names a
 * person dragged in from their own disk and a zip's own entries -- both of
 * which routinely contain junk nobody typed on purpose.
 */
function names(path: string): string[] {
  return path
    .replace(/\\/g, "/") // normalize paths
    .split("/")
    .filter((p) => p !== "" && p !== "." && p !== ".."); // remove extra slashes and ignore current and parent dirs (block traversal)
}

/** A path as one spelling: forward-slashed, no empty, `.` or `..` names, no
 *  slash at either end. The one normalizer for paths that arrive from outside
 *  -- a zip's entries, a drop's relative paths -- so junk detection and root
 *  finding see what `cleanId` would. "" when nothing is left. */
export function normalizePath(path: string): string {
  return names(path).join("/");
}

/** A folder path, every name in it cleaned as a folder's. */
export function cleanPath(path: string): string {
  return names(path).map(cleanFolder).join("/");
}

/** A document id: its folders cleaned as folders and its last name as the
 *  document's own, or "" when nothing is left. */
export function cleanId(path: string): string {
  const parts = names(path);
  const last = parts.pop();
  return last === undefined
    ? ""
    : [...parts.map(cleanFolder), cleanSegment(last)].join("/");
}

/** The stem an uploaded filename becomes: lowercase and hyphenated, in
 *  whatever script it was written in, because an id ends up in a URL and in a
 *  citation token. */
export function slug(name: string): string {
  return (
    name
      .normalize("NFC")
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "doc"
  );
}

/** The last name in a path. */
export function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

/** The stem of a filename, without its extension. */
export function stem(filename: string): string {
  const base = basename(filename);
  const dot = base.lastIndexOf(".");
  // `.hidden` is a name with no extension; `.pdf` alone is an extension
  // with no name, and its stem is empty. The two doors do not agree on
  // what that means, and are not meant to: a rename refuses it, since a
  // person can type again, and a drop takes `slug`'s fallback, since a file
  // has to land somewhere.
  if (dot === 0) return /^\.pdf$/i.test(base) ? "" : base;
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Whether `value` is a document id: a non-empty path `cleanId` leaves as it is.
 *
 * Cleaning is idempotent, so a string it does not change has already been
 * through it: no empty segment, no `.` or `..`, nothing outside the characters
 * a segment may hold, no folder ending in a document's suffix. The empty
 * string cleans to itself too, and is ruled out by hand. `__proto__` is an id
 * like any other -- see `Manifest`.
 */
export function isDocId(value: string): boolean {
  return value !== "" && cleanId(value) === value;
}

/** Ids and file names in one fixed order: the language's own, by UTF-16
 *  code unit.
 *
 * Not `localeCompare`: that order depends on the locale of the machine, and
 * two tabs comparing listings -- or one tab comparing today's listing to
 * yesterday's -- need the same answer everywhere. Which order it is does not
 * matter, only that it is the same one every time, so it is the cheapest
 * one there is. The order a person reads is the tree's, which sorts for
 * them separately. */
export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A document id as path segments, refusing anything that is not an id.
 *
 * Every function below that turns an id into a place in the workspace starts
 * here, so a bad id -- from a URL, a manifest, a caller's mistake -- stops
 * before it becomes a path. A plain split would not stop it: `""` has no
 * segments, which makes `cacheDir` the whole `.mdgest/` and `removeDerived`
 * a delete of every document's edits.
 */
function docSegments(docId: string): string[] {
  if (!isDocId(docId))
    throw new Error(`${JSON.stringify(docId)} is not a document id.`);
  return docId.split("/");
}

/** A document's file or folder under `base`: its id, `suffix` on the last segment. */
function docPath(base: string, docId: string, suffix: string): string[] {
  const parts = docSegments(docId);
  return [base, ...parts.slice(0, -1), `${parts.at(-1)}${suffix}`];
}

export function sourcePath(docId: string): string[] {
  return docPath(SOURCES, docId, ".pdf");
}

export function markdownPath(docId: string): string[] {
  return docPath(MARKDOWN, docId, ".md");
}

/** Where a document's figures sit, beside its markdown. */
export function assetsDir(docId: string): string[] {
  return docPath(MARKDOWN, docId, ".assets");
}

/** What the markdown writes in front of a figure's name to reach it: the
 *  assets folder, relative to the markdown file beside it. */
export function assetsPrefix(docId: string): string {
  return `${assetsDir(docId).at(-1)}/`;
}

/** What `read.ts` names a figure: `p<page>-i<index>.png`. The one shape
 *  `asset` will read, so a name from a URL cannot be a path. */
export const FIGURE_NAME = /^p\d+-i\d+\.png$/;

/** The name figure `index` of page `page` is written under -- the maker of
 *  the shape `FIGURE_NAME` reads, kept beside it so they cannot drift. */
export function figureName(page: number, index: number): string {
  return `p${page}-i${index}.png`;
}

/** Named for the source it is derived from, suffix and all. Without one, the
 *  cache of `pumps` would be the folder holding the cache of `pumps/intake`,
 *  and removing the first would remove both. */
export function cacheDir(docId: string): string[] {
  return docPath(CACHE, docId, ".pdf");
}

/** The id `filename` should take inside `folder`, before collisions are settled.
 *
 * A filename may carry directories: a dropped or picked folder arrives with
 * each file renamed to its path inside that folder, and a zip entry is a path
 * by nature. Those go under `folder`, not into the slug -- an id *is* its
 * path, and rules are looked up by walking it, nearest folder first, so
 * `manuals/hydraulics/scan-1` answers to hydraulics before manuals. Keeping
 * only the basename would flatten every upload to the top level and leave
 * nothing for a rule to attach to.
 */
export function docIdFor(filename: string, folder = ""): string {
  const parts = names(filename);
  const base = parts.pop() ?? "";
  const clean = cleanPath([folder, ...parts].join("/"));
  // Through cleanSegment for its length cap alone: a slug keeps every other rule already.
  const s = cleanSegment(slug(stem(base)));
  return clean ? `${clean}/${s}` : s;
}

/** The id a typed name makes for the document at `docId`, in the folder it
 *  sits in. Through `docIdFor`, the rules a dropped file's name goes through,
 *  so a rename lands on no id a drop could not. A `.pdf` on the end is
 *  optional, and nothing else is taken for an extension: `v2.1` is a name,
 *  not `v2` with a suffix. "" -- which is no id -- when nothing was typed, so
 *  a cleared field refuses rather than renaming to `pdf`. So is a name
 *  with no letter or digit in it: `.`, `..` and `---` have nothing for a
 *  slug to keep, and the fallback it would reach for is `doc`, an id that
 *  may already be taken. A name, not a path: a separator typed into it is
 *  punctuation, slugged to a dash like any other, so a rename never moves
 *  the document into another folder -- or, with `..`, out of its own.
 *  Shared by the landing, to show the id before it is asked for, and the
 *  stage, which decides. */
export function renamedId(docId: string, name: string): string {
  const folder = docId.split("/").slice(0, -1).join("/");
  const typed = renameStem(name);
  if (!/[\p{L}\p{N}]/u.test(typed)) return "";
  return docIdFor(`${typed}.pdf`, folder);
}

/** What was typed as a new name, less its optional `.pdf`: empty for a name
 *  of nothing, which the stage says differently from a name of only
 *  punctuation. The suffix comes off first, so that a bare `.pdf` is an
 *  empty name and not a hidden file called `.pdf` whose stem slugs to
 *  `pdf`. */
export function renameStem(name: string): string {
  return name
    .replace(/[/\\]/g, "-")
    .trim()
    .replace(/\.pdf$/i, "")
    .trim();
}

/** The visible manifest an exported workspace carries at its root, and the
 *  one file at the root of the OPFS workspace too. Its presence is what makes
 *  a folder or archive a project to continue rather than PDFs to add -- see
 *  the README, "How it works". */
export const MANIFEST = "mdgest.json";

/** What a manifest looks like from the landing's side of it.
 *
 * The landing reads two things: that the file exists, and each document's
 * hash. Everything else -- edits, learned rules, page counts -- is the
 * editor's and travels through as it arrived, which is why both types are
 * open. The per-document hash is the one field this side depends on. */
export type DocEntry = { sha256?: string } & Record<string, unknown>;
export interface Manifest {
  format: number;
  /** What the workspace is called: the editor's header shows it and an
   *  export's file is named after it. Set at commit from the folder or zip it
   *  arrived as, when it had none; absent for one made of loose PDFs until
   *  someone names it. Always as `cleanName` leaves it. */
  name?: string;
  /** Keyed by document id, and made without a prototype -- by `emptyManifest`
   *  and `parseManifest`, the only two places a manifest comes from. An id is
   *  a file name and `__proto__` is a legal one: on a plain object, writing
   *  that key replaces the object's prototype instead of adding an entry, and
   *  reading `constructor` finds what every object inherits. With no
   *  prototype, every id is an ordinary key, for reads, writes and `in`. */
  documents: Record<string, DocEntry>;
  [key: string]: unknown;
}

export const FORMAT = 1;

/** The longest a workspace's name is kept, in graphemes -- what a person
 *  sees as one character, so a cut never lands inside a family emoji or
 *  between a base and its mark. A label for a header and the start of a
 *  file name, not a place to write. */
const MAX_NAME = 80;

/** A workspace's name as it is kept: whitespace collapsed, control and
 *  format characters out, cut to `MAX_NAME`. Null when nothing is left. Not
 *  made safe for a path -- the export does that, with `cleanSegment`, so the
 *  name a person typed is the one they see.
 *
 *  Format characters (`\p{Cf}`) go because they are invisible or reorder
 *  what is around them: a zero-width space is a name that shows as nothing,
 *  and a bidi override reverses the rest of the header line. Two are kept:
 *  the zero-width joiner, which holds a family emoji together, and the
 *  non-joiner, which is spelling in Persian, Urdu and the Indic scripts --
 *  without it a plural is two words. Kept only between visible characters:
 *  at an end, or beside a space, each is as invisible as the rest. */
export function cleanName(name: string): string | null {
  const collapsed = name
    .normalize("NFC")
    .replace(/(?:(?![\u200c\u200d])[\p{Cc}\p{Cf}\s])+/gu, " ")
    .trim();
  const kept = Array.from(graphemes.segment(collapsed), (g) => g.segment)
    .slice(0, MAX_NAME)
    .join("")
    // A whole run at once, judged by what is outside it: a run with a
    // visible character on both sides stays, however long.
    .replace(/(?<![^\s])[\u200c\u200d]+|[\u200c\u200d]+(?![^\s])/gu, "")
    // A joiner that sat between two spaces leaves them touching.
    .replace(/ {2,}/g, " ")
    .trim();
  return kept || null;
}

/** A manifest with nothing in it, for a workspace created from loose PDFs. */
export function emptyManifest(): Manifest {
  return { format: FORMAT, documents: noPrototype() };
}

/** A manifest to change without changing this one. Shallow below
 *  `documents`: an entry is replaced whole, never edited in place, so the two
 *  can share them. */
export function copyManifest(manifest: Manifest): Manifest {
  return {
    ...manifest,
    documents: Object.assign(noPrototype(), manifest.documents),
  };
}

/** A manifest from its text, or an error saying what is wrong with it.
 *
 * The one way a manifest gets in, whether it came with an upload or was
 * written here by an earlier commit, so everything past this can take the
 * shape as given. What is checked is what this side builds on: that the format
 * is this one, that every key is a document id -- keys become paths -- and
 * that a hash is a hash. An entry with no hash is a document whose source
 * will be hashed on the way in. `documents` comes out copied into a map with
 * no prototype, for the reason on `Manifest`.
 *
 * The name is cleaned the way `cleanName` keeps it. Nothing else is checked,
 * and all of it -- edits, rules, any field at all -- is kept and written back
 * as it arrived. That is safe only while nothing here reads it. Whatever comes to read it, the editor first, validates the
 * shape of what it reads where it reads it, as this does for the landing: a
 * manifest that got through here has proven nothing about those fields.
 *
 * Messages begin "its mdgest.json", finishing a sentence the caller starts
 * with where the file came from, which only the caller knows.
 */
export function parseManifest(text: string): Manifest {
  const problem = (what: string) => new Error(`its ${MANIFEST} ${what}.`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw problem("is not valid JSON");
  }
  if (!isRecord(value)) throw problem("is not a JSON object");
  const { format, documents } = value;
  if (format !== FORMAT) {
    throw problem(
      typeof format === "number" && format > FORMAT
        ? "was written by a newer version of mdgest"
        : "is not in a format this version reads",
    );
  }
  if (!isRecord(documents)) throw problem("has no documents map");
  for (const [docId, entry] of Object.entries(documents)) {
    if (!isDocId(docId)) {
      throw problem(
        `lists ${JSON.stringify(docId)}, which is not a document id`,
      );
    }
    if (!isRecord(entry))
      throw problem(`has an entry for ${docId} that is not an object`);
    const { sha256 } = entry;
    if (
      sha256 !== undefined &&
      !(typeof sha256 === "string" && SHA256.test(sha256))
    ) {
      throw problem(`gives ${docId} a sha256 that is not a SHA-256 hex digest`);
    }
  }
  // A name is a label no decision hangs on, so one that is not a string is
  // dropped rather than the workspace refused for it.
  const { name, ...rest } = value;
  const kept = typeof name === "string" ? cleanName(name) : null;
  return {
    ...rest,
    format,
    ...(kept ? { name: kept } : {}),
    documents: Object.assign(noPrototype(), documents),
  };
}

/** What `sha256` in opfs produces: 32 bytes, lowercase hex. */
const SHA256 = /^[0-9a-f]{64}$/;

function noPrototype(): Record<string, DocEntry> {
  return Object.create(null) as Record<string, DocEntry>;
}

/** A parsed JSON value that can carry named fields: the guard every
 *  file-format check here and in edits.ts opens with. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
