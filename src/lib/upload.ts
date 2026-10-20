/** What an upload's paths say, before any bytes are read.
 *
 * Shared by the drop zone on the main thread and the staging code in the
 * worker, so both agree on which entries are junk and where a workspace's
 * root is. Pure path logic, no I/O, and nothing from fflate -- which is why it
 * is not in unzip.ts, whose import would drag the inflater into the page.
 */

import { MANIFEST, MARKDOWN, SOURCES, basename } from "./workspace";

/** The file-type policy, in one place: what an upload may hold. Everything
 *  that walks a drop, opens an archive or stages a batch asks these, so a
 *  type accepted at one door is accepted at every door. */
export const isPdf = (path: string): boolean => /\.pdf$/i.test(path);
export const isZip = (path: string): boolean => /\.zip$/i.test(path);
/** A manifest anywhere in a path: at the root of a drop, or inside the
 *  folder someone dropped or zipped whole. */
export const isManifest = (path: string): boolean => basename(path) === MANIFEST;

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

/** The folders exported workspaces sit in, if these paths hold any.
 *
 * `""` for a manifest at the root, and a folder's name for one a level down --
 * which is where it lands when a person zips or drops the exported folder
 * itself rather than its contents. Every one is found, not just the first: a
 * drop of two exports has to be told it held two, rather than have the second
 * taken apart as loose PDFs. Deeper is not looked for, since a workspace buried
 * inside some other folder was not what the drop was about -- and nor is the
 * root workspace's own `sources/` or `markdown/`, whose contents are its. */
export function workspaceRoots(paths: string[]): string[] {
  const top = paths.includes(MANIFEST);
  const roots = top ? [""] : [];
  for (const path of paths) {
    const parts = path.split("/");
    if (parts.length !== 2 || parts[1] !== MANIFEST || roots.includes(parts[0])) continue;
    if (top && (parts[0] === SOURCES || parts[0] === MARKDOWN)) continue;
    roots.push(parts[0]);
  }
  return roots;
}

/** Whether `path` is inside `root` (or anywhere, when root is ""). */
export function under(path: string, root: string): boolean {
  return root === "" || path.startsWith(`${root}/`);
}

/** `path` with `root/` taken off the front. */
export function relativeTo(path: string, root: string): string {
  return root === "" ? path : path.slice(root.length + 1);
}
