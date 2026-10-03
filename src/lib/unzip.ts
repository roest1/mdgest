/** A zip upload, opened into the same shape a dropped folder arrives in.
 *
 * Runs in the worker: inflating an archive is exactly the kind of work that
 * freezes a tab, and the worker is where the bytes are going anyway.
 */

import { unzipSync } from "fflate";
import { MAX_ENTRIES, MAX_INFLATED } from "./limits";
import { isJunk, isManifest, isPdf } from "./upload";
import { human } from "./words";

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

/** An entry's name as a path: forward-slashed, with no leading slash. Some
 *  Windows tools write `\` between folders, which the format does not allow
 *  and every unzipper tolerates; left as it is, `ws\mdgest.json` is neither a
 *  manifest nor junk to anything that splits on `/`. */
function entryPath(name: string): string {
  return name.replace(/\\/g, "/").replace(/^\/+/, "");
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
  unzipSync(data, {
    filter: (f) => {
      const path = entryPath(f.name);
      if (isJunk(path) || !wanted(path)) return false;
      // fflate answers with an object keyed by name, so a second entry under
      // one name would be inflated, counted once below, and then silently
      // replace the first. No zip tool writes one, and an archive that does
      // is not saying which copy it means -- nor does one that spells a path
      // both ways round.
      if (costs.has(path)) throw new Error(`it holds ${path} more than once.`);
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
  });

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

  const files = unzipSync(data, { filter: (f) => raw.has(f.name) });
  return Object.entries(files).map(([name, bytes]) => ({
    path: entryPath(name),
    bytes: bytes as Uint8Array<ArrayBuffer>,
  }));
}
