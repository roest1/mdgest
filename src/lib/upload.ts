/** What an upload's paths say, before any bytes are read. Pure path logic,
 *  no I/O. */

import { MANIFEST, basename } from "./workspace";

/** The file-type policy, in one place: what an upload may hold. Everything
 *  that walks a drop, opens an archive or stages a batch asks these, so a
 *  type accepted at one door is accepted at every door. */
export const isPdf = (path: string): boolean => /\.pdf$/i.test(path);
export const isZip = (path: string): boolean => /\.zip$/i.test(path);
/** A manifest anywhere in a path: at the root of a drop, or inside the
 *  folder someone dropped or zipped whole. */
export const isManifest = (path: string): boolean =>
  basename(path) === MANIFEST;

/** Entry paths no one put in an upload on purpose. `__MACOSX/` is the mac zip
 *  tool's resource-fork sidecar; `.DS_Store` and `Thumbs.db` are the two
 *  desktops' folder metadata. Anything under a dot-directory goes too, which
 *  is also what keeps a stray `.mdgest/` cache from being read as content. */
export function isJunk(path: string): boolean {
  const parts = path.split("/");
  const base = parts.at(-1) ?? "";
  return (
    parts.some((p) => p === "__MACOSX" || (p.startsWith(".") && p !== base)) ||
    base === ".DS_Store" ||
    base === "Thumbs.db"
  );
}
