/** A workspace listing as a tree, for display.
 *
 * Built from paths rather than from the upload gesture: loose PDFs, a picked
 * folder and an unzipped archive all come back from the engine as ids, and
 * ids are paths. Folding those into a tree here means the UI never has to
 * know how a file arrived.
 */

/** What a leaf is. Folders are the only non-leaf. `pdf` is what gets
 *  uploaded; `md` and `json` are what the engine writes and only show up
 *  once a workspace listing includes its outputs. */
export type FileKind = "pdf" | "md" | "json";

/** A word in a file's trailing slot, for the rows that deviate from what the
 *  listing as a whole is about to do, drawn as a small tag in its `tone`.
 *  Tones are hues rather than meanings so each status can have its own; the
 *  caller decides which one a status reads as. `dim` draws the row as not
 *  quite there, which is what a document with a manifest entry and no file
 *  is. */
export interface Mark {
  text: string;
  tone: "stone" | "blue" | "amber" | "orange" | "red";
  dim?: boolean;
}

export interface Entry {
  /** Slash-separated, no leading slash, no extension for a doc id. */
  path: string;
  kind: FileKind;
  mark?: Mark;
  /** Whether the listing's `onRemove`, if it has one, applies to this row. */
  removable?: boolean;
}

export type TreeNode =
  | { type: "folder"; name: string; path: string; children: TreeNode[]; files: number }
  | { type: "file"; name: string; path: string; kind: FileKind; mark?: Mark; removable?: boolean };

/** One collator for every comparison: the options form of `localeCompare`
 *  builds one per call. */
const byName = new Intl.Collator(undefined, { sensitivity: "base" }).compare;

/** Folders first, then files, each alphabetical and case-insensitive —
 *  the order every file manager settles on. In place: the nodes are this
 *  module's own, built a moment earlier. */
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  for (const n of nodes) if (n.type === "folder") sortNodes(n.children);
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return byName(a.name, b.name);
  });
}

/** Fold flat entries into a tree. Duplicate paths collapse to one node;
 *  a path that is both a folder and a file (`a` and `a/b`) keeps both, since
 *  the engine's id space allows it. */
export function buildTree(entries: Entry[]): TreeNode[] {
  type Folder = Extract<TreeNode, { type: "folder" }>;
  const root: Folder = { type: "folder", name: "", path: "", children: [], files: 0 };
  const folders = new Map<string, Folder>([["", root]]);
  const seen = new Set<string>();

  for (const { path, kind, mark, removable } of entries) {
    if (seen.has(path)) continue;
    seen.add(path);

    const parts = path.split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) continue;

    let dir = root;
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      let next = folders.get(acc);
      if (!next) {
        next = { type: "folder", name: part, path: acc, children: [], files: 0 };
        folders.set(acc, next);
        dir.children.push(next);
      }
      next.files += 1;
      dir = next;
    }
    dir.children.push({ type: "file", name, path, kind, mark, removable });
  }
  root.files = seen.size;
  return sortNodes(root.children);
}
