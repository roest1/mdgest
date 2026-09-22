import { FileJson, FileText, Folder, FolderOpen, FileCode, X } from "lucide-react";
import { useMemo, useState } from "react";
import { buildTree, type Entry, type FileKind, type Mark, type TreeNode } from "src/lib/tree";

/** One glyph per kind. Lucide has no PDF-specific mark, and FileText reads as
 *  "a document" which is what a PDF is here; FileCode is markdown's, since
 *  markdown is the thing a person edits. */
const FILE_ICON: Record<FileKind, typeof FileText> = {
  pdf: FileText,
  md: FileCode,
  json: FileJson,
};

const FILE_TINT: Record<FileKind, string> = {
  pdf: "text-brand-lit/80",
  md: "text-accent-lit/80",
  json: "text-muted",
};

const MARK_TINT: Record<Mark["tone"], string> = {
  stone: "text-muted bg-muted/18",
  blue: "text-blue-400 bg-blue-400/18",
  amber: "text-amber-400 bg-amber-400/18",
  orange: "text-orange-400 bg-orange-400/18",
  red: "text-red-400 bg-red-400/18",
};

/** Each level indents by one icon width, so a child's glyph sits under its
 *  parent's name, the way a listing lines up in oil or a file manager. */
const INDENT_PX = 18;

/** A read-only listing of files, drawn like a file manager's tree: an icon,
 * a name, and room on the right for metadata once there is some.
 *
 * Folders open and close on click; top-level folders start open, nested ones
 * closed, so a three-hundred-file drop shows its shape and not its contents.
 * The box has a ceiling and scrolls past it rather than growing with the
 * listing.
 *
 * Nothing here edits: no rename, no delete, no drag. It is a listing, and the
 * engine's ids are what it lists. The one exception is `onRemove`, which the
 * landing passes for rows that are only staged -- taking a file out of a
 * drop is not editing a workspace -- and the editor does not.
 */
export function FileTree({
  entries,
  onRemove,
}: {
  entries: Entry[];
  /** Shown on hover for entries marked `removable`. */
  onRemove?: (path: string) => void;
}) {
  // Rebuilt when the listing changes, not when a folder is toggled: at the
  // largest drop this takes, folding and sorting ten thousand rows is work a
  // click should not repeat.
  const tree = useMemo(() => buildTree(entries), [entries]);
  // Overrides only: a folder not in the map takes the default for its depth,
  // so a folder that appears after a later drop starts in the same state a
  // sibling did, rather than however the map happened to be seeded.
  const [open, setOpen] = useState<Map<string, boolean>>(new Map());
  const toggle = (path: string, current: boolean) =>
    setOpen((prev) => new Map(prev).set(path, !current));

  if (tree.length === 0) return null;

  return (
    <div
      className="max-h-64 overflow-y-auto rounded-lg border border-edge bg-chrome/70
        py-1.5 font-mono text-xs"
    >
      <ul role="tree" className="m-0 list-none p-0">
        {/* Keyed by type as well as path: `a` can be a document and a folder
            at once, and the two are siblings. */}
        {tree.map((node) => (
          <Row key={`${node.type}:${node.path}`} node={node} depth={0} open={open} toggle={toggle} onRemove={onRemove} />
        ))}
      </ul>
    </div>
  );
}

function Row({
  node,
  depth,
  open,
  toggle,
  onRemove,
}: {
  node: TreeNode;
  depth: number;
  open: Map<string, boolean>;
  toggle: (path: string, current: boolean) => void;
  onRemove?: (path: string) => void;
}) {
  const indent = { paddingLeft: 10 + depth * INDENT_PX };

  if (node.type === "file") {
    const Icon = FILE_ICON[node.kind];
    const removable = onRemove && node.removable;
    return (
      <li role="treeitem" className="m-0">
        <div
          style={indent}
          className={`group flex items-center gap-1.5 py-[3px] pr-3 text-ink/90
            ${node.mark?.dim ? "opacity-50" : ""}`}
        >
          <Icon className={`h-3.5 w-3.5 shrink-0 ${FILE_TINT[node.kind]}`} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {node.mark && (
            <span
              className={`shrink-0 rounded-[3px] px-[5px] py-[3px] font-sans text-[9px]
                leading-none font-semibold tracking-[0.06em] uppercase ${MARK_TINT[node.mark.tone]}`}
            >
              {node.mark.text}
            </span>
          )}
          {removable && (
            <button
              type="button"
              onClick={() => onRemove(node.path)}
              title="Remove from this upload"
              aria-label={`Remove ${node.name}`}
              className="-my-1 -mr-1 shrink-0 cursor-pointer rounded p-0.5 text-faint opacity-0
                transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          )}
        </div>
      </li>
    );
  }

  const isOpen = open.get(node.path) ?? depth === 0;
  const Icon = isOpen ? FolderOpen : Folder;
  return (
    <li role="treeitem" aria-expanded={isOpen} className="m-0">
      <button
        type="button"
        onClick={() => toggle(node.path, isOpen)}
        style={indent}
        className="flex w-full cursor-pointer items-center gap-1.5 py-[3px] pr-3
          text-left text-ink transition-colors hover:bg-raised/60"
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{node.name}/</span>
        <span className="shrink-0 tabular-nums text-faint">{node.files}</span>
      </button>
      {isOpen && (
        <ul role="group" className="m-0 list-none p-0">
          {node.children.map((child) => (
            <Row
              key={`${child.type}:${child.path}`}
              node={child}
              depth={depth + 1}
              open={open}
              toggle={toggle}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
