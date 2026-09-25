import {
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  FileCode,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Marquee } from "src/components/shared/Marquee";
import {
  buildTree,
  type Entry,
  type FileKind,
  type Mark,
  type TreeNode,
} from "src/lib/tree";

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

/** Every row's height, fixed so the browser can hold a row it has not laid
 *  out at its real size: `text-xs` line height plus 3px above and below. The
 *  icon and the status tag both fit inside it. */
const ROW =
  "h-[22px] [content-visibility:auto] [contain-intrinsic-size:auto_22px]";

/** `open` with every folder above `path` open, or `open` itself when they
 *  already are -- so revealing the document already on screen costs nothing. */
function reveal(
  open: Map<string, boolean>,
  path: string | undefined,
): Map<string, boolean> {
  if (!path) return open;
  const parts = path.split("/").slice(0, -1);
  let next = open;
  for (let i = 1; i <= parts.length; i++) {
    const folder = parts.slice(0, i).join("/");
    if (next.get(folder) === true) continue;
    if (next === open) next = new Map(open);
    next.set(folder, true);
  }
  return next;
}

/** A read-only listing of files, drawn like a file manager's tree: an icon,
 * a name, and room on the right for metadata once there is some.
 *
 * Nothing here edits: no rename, no delete, no drag. It is a listing, and the
 * engine's ids are what it lists. The one exception is `onRemove`, which the
 * landing passes for rows that are only staged -- taking a file out of a
 * drop is not editing a workspace -- and the editor does not. The editor
 * passes `onSelect` instead, which makes each file a button.
 */
export function FileTree({
  entries,
  onRemove,
  onSelect,
  activePath,
  className = "",
}: {
  entries: Entry[];
  /** Shown on hover for entries marked `removable`. */
  onRemove?: (path: string) => void;
  /** Makes file rows clickable; called with the row's path. */
  onSelect?: (path: string) => void;
  /** The file drawn as selected. */
  activePath?: string;
  /** The box around the listing: border, background, and a height or
   *  ceiling for it to scroll within. */
  className?: string;
}) {
  // Rebuilt when the listing changes, not when a folder is toggled: at the
  // largest drop this takes, folding and sorting ten thousand rows is work a
  // click should not repeat.
  const tree = useMemo(() => buildTree(entries), [entries]);
  // Overrides only: a folder not in the map takes the default for its depth,
  // so a folder that appears after a later drop starts in the same state a
  // sibling did, rather than however the map happened to be seeded.
  const [open, setOpen] = useState(() => reveal(new Map(), activePath));
  // Adjusted during render rather than in an effect, so a newly active
  // document is never drawn for a frame inside a closed folder.
  const [revealed, setRevealed] = useState(activePath);
  if (activePath !== revealed) {
    setRevealed(activePath);
    setOpen((prev) => reveal(prev, activePath));
  }
  const toggle = useCallback(
    (path: string, current: boolean) =>
      setOpen((prev) => new Map(prev).set(path, !current)),
    [],
  );

  // The callers' handlers are new functions on most of their renders, and
  // passing them down as they are would make every memoised row re-render
  // anyway. The rows get stable stand-ins that call whichever is current.
  const latest = useRef({ onRemove, onSelect });
  useLayoutEffect(() => {
    latest.current = { onRemove, onSelect };
  });
  const remove = useCallback(
    (path: string) => latest.current.onRemove?.(path),
    [],
  );
  const select = useCallback(
    (path: string) => latest.current.onSelect?.(path),
    [],
  );

  const shared: Shared = {
    open,
    toggle,
    activePath,
    remove: onRemove && remove,
    select: onSelect && select,
  };

  if (tree.length === 0) return null;

  return (
    <div className={`overflow-y-auto py-1.5 font-mono text-xs ${className}`}>
      <ul role="tree" className="m-0 list-none p-0">
        <Rows nodes={tree} depth={0} shared={shared} />
      </ul>
    </div>
  );
}

/** What every row below the root is drawn with. */
interface Shared {
  open: Map<string, boolean>;
  toggle: (path: string, current: boolean) => void;
  activePath?: string;
  remove?: (path: string) => void;
  select?: (path: string) => void;
}

/** One level of the tree. File rows are handed only what they draw, so the
 *  memo on `FileRow` can skip all but the ones whose selection changed. */
function Rows({
  nodes,
  depth,
  shared,
}: {
  nodes: TreeNode[];
  depth: number;
  shared: Shared;
}) {
  const { activePath, remove, select } = shared;
  // Keyed by type as well as path: `a` can be a document and a folder at
  // once, and the two are siblings.
  return nodes.map((node) =>
    node.type === "file" ? (
      <FileRow
        key={`file:${node.path}`}
        node={node}
        depth={depth}
        active={node.path === activePath}
        remove={remove}
        select={select}
      />
    ) : (
      <FolderRow
        key={`folder:${node.path}`}
        node={node}
        depth={depth}
        shared={shared}
      />
    ),
  );
}

function indent(depth: number) {
  return { paddingLeft: 10 + depth * INDENT_PX };
}

const FileRow = memo(function FileRow({
  node,
  depth,
  active,
  remove,
  select,
}: {
  node: Extract<TreeNode, { type: "file" }>;
  depth: number;
  active: boolean;
  remove?: (path: string) => void;
  select?: (path: string) => void;
}) {
  const Icon = FILE_ICON[node.kind];
  const removable = remove && node.removable;
  // A button only where a click does something. The remove button stays its
  // sibling, not its child, since a button cannot hold another.
  const Main = select ? "button" : "span";
  return (
    <li
      role="treeitem"
      aria-selected={select ? active : undefined}
      className="m-0"
    >
      <div
        style={indent(depth)}
        className={`group flex items-center gap-1.5 pr-3 text-ink/90 ${ROW}
          ${node.mark?.dim ? "opacity-50" : ""}
          ${active ? "bg-raised text-ink" : select ? "hover:bg-raised/60" : ""}`}
      >
        <Main
          {...(select && { type: "button", onClick: () => select(node.path) })}
          className={`flex h-full min-w-0 flex-1 items-center gap-1.5 text-left
            ${select ? "cursor-pointer" : ""}`}
        >
          <Icon
            className={`h-3.5 w-3.5 shrink-0 ${FILE_TINT[node.kind]}`}
            aria-hidden
          />
          <Marquee text={node.name} className="min-w-0 flex-1" />
          {node.mark && (
            <span
              className={`shrink-0 rounded-[3px] px-[5px] py-[3px] font-sans text-[9px]
                leading-none font-semibold tracking-[0.06em] uppercase ${MARK_TINT[node.mark.tone]}`}
            >
              {node.mark.text}
            </span>
          )}
        </Main>
        {removable && (
          <button
            type="button"
            onClick={() => remove(node.path)}
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
});

/** Not memoised: folders are few beside their files, and every one of them
 *  reads the open map, which is what a toggle changes. */
function FolderRow({
  node,
  depth,
  shared,
}: {
  node: Extract<TreeNode, { type: "folder" }>;
  depth: number;
  shared: Shared;
}) {
  const isOpen = shared.open.get(node.path) ?? depth === 0;
  const Icon = isOpen ? FolderOpen : Folder;
  return (
    <li role="treeitem" aria-expanded={isOpen} className="m-0">
      <button
        type="button"
        onClick={() => shared.toggle(node.path, isOpen)}
        style={indent(depth)}
        className={`group flex w-full cursor-pointer items-center gap-1.5 pr-3 ${ROW}
          text-left text-ink transition-colors hover:bg-raised/60`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
        <Marquee text={`${node.name}/`} className="min-w-0 flex-1" />
        <span className="shrink-0 tabular-nums text-faint">{node.files}</span>
      </button>
      {isOpen && (
        <ul role="group" className="m-0 list-none p-0">
          <Rows nodes={node.children} depth={depth + 1} shared={shared} />
        </ul>
      )}
    </li>
  );
}
