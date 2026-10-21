/** A zip upload, opened into the same shape a dropped folder arrives in.
 *
 * Runs in the worker: inflating an archive is exactly the kind of work that
 * freezes a tab, and the worker is where the bytes are going anyway.
 */

import { strFromU8, unzipSync } from "fflate";
import { MAX_ENTRIES, MAX_INFLATED } from "./limits";
import { isJunk, isManifest, isPdf } from "./upload";
import { human, messageOf } from "./words";
import { normalizePath } from "./workspace";

export interface ZipEntry {
  /** Path inside the archive, forward-slashed, no leading slash. */
  path: string;
  /** Narrower than fflate's own `Uint8Array`, whose buffer type is
   *  `ArrayBufferLike` and so could in principle be shared. It never is --
   *  fflate allocates its output here in this thread -- and the narrowing is
   *  what lets an entry be handed to `new Blob([...])` without a copy. */
  bytes: Uint8Array<ArrayBuffer>;
}

/** Whether anything reads this entry: a PDF, or a manifest. Nothing else in
 *  an archive is inflated -- not an export's markdown and figures, which are
 *  most of it, and not whatever else was zipped alongside. */
function wanted(path: string): boolean {
  return isPdf(path) || isManifest(path);
}

/** A refusal of the archive's contents, made inside fflate's filter. Thrown
 *  from there it surfaces through `unzipSync` like one of fflate's own, and
 *  `opening` has to tell the two apart: this one is already a sentence. */
class Refused extends Error {}

/** Stored (0) and deflated (8) are what fflate opens; a 7-Zip or WinZip
 *  archive may hold bzip2 (12), LZMA (14) or zstd (93), which it refuses one
 *  entry at a time, in its own words, after the rest were inflated. */
const OPENABLE = new Set([0, 8]);

/** Names of the entries the archive marks as encrypted.
 *
 * fflate reads every central-directory field but this one: the general-
 * purpose flag at offset 8, of which it looks only at bit 11 (UTF-8 names).
 * With bit 0 set, a stored entry comes out of `unzipSync` as its 12-byte
 * encryption header plus ciphertext, as if that were the file, and a deflated
 * one throws a raw inflate error. So the directory is walked once more here,
 * the same way fflate walks it -- the end record, then the zip64 end record
 * if there is one, then each header -- to read the one field it skips. Names
 * are decoded as fflate decodes them, so a name here is a name in its filter.
 * Empty when the bytes are not a zip at all, which `unzipSync` then says. */
function encryptedNames(d: Uint8Array): Set<string> {
  // Zero past either end, so a truncated record reads as no signature
  // rather than as `undefined` folded into a number.
  const u16 = (at: number) =>
    at >= 0 && at + 1 < d.length ? d[at]! | (d[at + 1]! << 8) : 0;
  const u32 = (at: number) => (u16(at) | (u16(at + 2) << 16)) >>> 0;
  const names = new Set<string>();
  let e = d.length - 22;
  for (; e >= 0 && u32(e) !== 0x06054b50; --e) {
    if (d.length - e > 65558) return names;
  }
  if (e < 0) return names;
  // Offset 8, the entries on this disk, which is the count fflate walks by;
  // offset 10 is the total over every disk, and the two are only equal in
  // an archive that is honest about being one disk.
  let count = u16(e + 8);
  let at = u32(e + 16);
  // The zip64 record exactly where fflate 0.8.3 reads it: whenever a
  // locator sits 20 bytes before the end record, whatever the end record
  // itself says. Not on the format's 0xFFFF sentinels, which fflate does
  // not look at -- an archive whose locator and end record disagree has
  // to be walked the way fflate walks it, or an entry it inflates is one
  // this never saw.
  if (e >= 20 && u32(e - 20) === 0x07064b50) {
    const ze = u32(e - 12);
    if (u32(ze) === 0x06064b50) {
      count = u32(ze + 32);
      at = u32(ze + 48);
    }
  }
  // Every one of `count` headers, as fflate reads them: it checks no
  // signature and stops at no bad header, so neither does this -- a header
  // this stopped at would be one fflate read as garbage and walked past,
  // and the entries after it ones it inflates. Only the buffer's end stops
  // the walk, where fflate reads zeros and this reads nothing.
  for (let i = 0; i < count && at < d.length; i++) {
    const flag = u16(at + 8);
    const nameLength = u16(at + 28);
    const extraLength = u16(at + 30);
    const commentLength = u16(at + 32);
    if (flag & 1) {
      const name = d.subarray(at + 46, at + 46 + nameLength);
      names.add(strFromU8(name, !(flag & 2048)));
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

/** `read`, with fflate's own errors -- `invalid zip data`, `unexpected EOF`
 *  -- put in a sentence that fits after "its export.zip". A `Refused` thrown
 *  from inside the filter is already that sentence and passes through. */
function opening<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof Refused) throw error;
    throw new Error(
      `could not be opened as a zip archive (${messageOf(error)}).`,
    );
  }
}

/** A zip's PDFs and manifests, junk removed.
 *
 * Two passes over the central directory, and only the second inflates. The
 * first sees every entry's name and size for free -- fflate's filter runs
 * before any bytes are touched -- which is enough to refuse an archive before
 * the allocation it would cost, and to leave out every entry that would only
 * be inflated to be ignored. Whole-archive rather than streaming because
 * every entry that survives is kept in memory to hash anyway. */
export function unzip(buf: ArrayBuffer): ZipEntry[] {
  const data = new Uint8Array(buf);
  // By path, as everything past here reads them; `raw` keeps the names as the
  // archive spells them, which is what the second pass is asked for by.
  const costs = new Map<string, number>();
  const raw = new Set<string>();
  const encrypted = encryptedNames(data);
  opening(() =>
    unzipSync(data, {
      filter: (f) => {
        // A folder entry: nothing to inflate, whatever it is called.
        if (f.name.endsWith("/")) return false;
        // Spelled the one way `workspace` spells paths. Some Windows tools
        // write `\` between folders, which the format does not allow and
        // every unzipper tolerates; others keep the `./` they were given.
        // Left as they are, `ws\mdgest.json` is neither a manifest nor junk
        // to anything that splits on `/`, and `./sources/a.pdf` is under a
        // dot-folder called `.`.
        const path = normalizePath(f.name);
        if (isJunk(path) || !wanted(path)) return false;
        if (encrypted.has(f.name))
          throw new Refused(`it holds ${path}, which is password-protected.`);
        if (!OPENABLE.has(f.compression)) {
          throw new Refused(
            `it holds ${path}, compressed in a way (method ${f.compression}) ` +
              `this browser cannot open. Drop the folder instead of the zip.`,
          );
        }
        // fflate answers with an object keyed by name, so a second entry under
        // one name would be inflated, counted once below, and then silently
        // replace the first. No zip tool writes one, and an archive that does
        // is not saying which copy it means -- nor does one that spells a path
        // both ways round.
        if (costs.has(path))
          throw new Refused(`it holds ${path} more than once.`);
        // What opening this entry allocates, read from the central directory:
        // free here and unavailable later, which is what lets the refusals
        // below happen before the allocations they refuse. fflate inflates into
        // a buffer of the declared size and copies a stored entry by its
        // compressed size, so it is the larger of the two -- the declared size
        // alone let a stored entry claim one byte and bring the whole archive.
        // Neither is ever exceeded: an entry that understates its size comes
        // out cut short, which is bad bytes, and a .pdf can hold those anyway.
        costs.set(path, Math.max(f.size, f.originalSize));
        raw.add(f.name);
        return false;
      },
    }),
  );

  // The caps live here rather than in the caller, because here is the one
  // place that knows what an archive weighs before it weighs anything.
  // Counted over what will be inflated, so an export is measured by its
  // sources and not by the figures beside them.
  if (costs.size > MAX_ENTRIES) {
    throw new Error(
      `it holds ${costs.size.toLocaleString("en-US")} files, more than the ` +
        `${MAX_ENTRIES.toLocaleString("en-US")} one archive can.`,
    );
  }
  let inflated = 0;
  for (const cost of costs.values()) inflated += cost;
  if (inflated > MAX_INFLATED) {
    throw new Error(
      `an archive of ${human(inflated)} is more than the ${human(MAX_INFLATED)} this browser ` +
        `can open at once. Drop the folder instead of the zip: loose files are read a few at a ` +
        `time rather than all held in memory together.`,
    );
  }

  const files = opening(() =>
    unzipSync(data, { filter: (f) => raw.has(f.name) }),
  );
  return Object.entries(files).map(([name, bytes]) => ({
    path: normalizePath(name),
    bytes: bytes as Uint8Array<ArrayBuffer>,
  }));
}
