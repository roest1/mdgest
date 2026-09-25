import { ChevronRight, createLucideIcon, Image as ImageIcon } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { OutlineNode, PDFPageProxy } from "src/lib/pdf";
import { PageCanvas } from "./PageCanvas";
import type { Snapshots } from "./snapshots";

/** A page with bulleted rows, for the outline. Lucide has the rows
 *  (`table-of-contents`) and the page (`square-menu`) but not both, so this
 *  is the two put together on its 24px grid; `h.01` is how Lucide draws a
 *  dot, a round cap on a line with next to no length. */
const OutlineIcon = createLucideIcon("outline", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "page" }],
  ["path", { d: "M8 8h.01", key: "dot1" }],
  ["path", { d: "M8 12h.01", key: "dot2" }],
  ["path", { d: "M8 16h.01", key: "dot3" }],
  ["path", { d: "M11 8h5", key: "row1" }],
  ["path", { d: "M11 12h5", key: "row2" }],
  ["path", { d: "M11 16h5", key: "row3" }],
]);

export type SidebarView = "thumbnails" | "outline";

/** How wide a thumbnail is, in CSS px; its height follows the page. Also
 *  what sizes the pane's snapshot store, which exists to serve these. */
export const THUMB_WIDTH = 104;

const tab = (on: boolean) =>
  `relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-colors disabled:cursor-default disabled:opacity-35 ${
    on ? "bg-edge text-accent-lit" : "text-muted hover:text-ink enabled:hover:bg-edge/60"
  }`;

/** The page pane's left side: a strip of the two views, and the one picked.
 *  The outline tab is there either way and disabled when the document has
 *  none, so the strip does not change shape from one document to the next. */
export function PdfSidebar({
  view,
  onView,
  pages,
  sizes,
  snapshots,
  current,
  outline,
  onPage,
  onOutline,
}: {
  view: SidebarView;
  onView: (view: SidebarView) => void;
  pages: PDFPageProxy[];
  /** Each page's size at scale 1, as the pane has already read it. */
  sizes: { w: number; h: number }[];
  /** The pane's kept renders, which the thumbnails draw from when they can. */
  snapshots: Snapshots;
  current: number;
  outline: OutlineNode[];
  onPage: (page: number) => void;
  onOutline: (node: OutlineNode) => void;
}) {
  const shown = outline.length === 0 ? "thumbnails" : view;
  return (
    <div className="flex w-[232px] shrink-0 border-r border-edge bg-chrome/50">
      <div role="tablist" aria-orientation="vertical" className="flex w-12 shrink-0 flex-col items-center gap-3 py-3">
        <button
          type="button"
          role="tab"
          aria-selected={shown === "thumbnails"}
          title="Thumbnails"
          onClick={() => onView("thumbnails")}
          className={tab(shown === "thumbnails")}
        >
          <ImageIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={shown === "outline"}
          title={outline.length ? "Outline" : "This document has no outline"}
          disabled={outline.length === 0}
          onClick={() => onView("outline")}
          className={tab(shown === "outline")}
        >
          <OutlineIcon className="h-4 w-4" />
        </button>
      </div>

      <div role="tabpanel" className="min-w-0 flex-1">
        {shown === "thumbnails" ? (
          <Thumbnails
            pages={pages}
            sizes={sizes}
            snapshots={snapshots}
            current={current}
            onPage={onPage}
          />
        ) : (
          <Outline nodes={outline} onOutline={onOutline} />
        )}
      </div>
    </div>
  );
}

function Thumbnails({
  pages,
  sizes,
  snapshots,
  current,
  onPage,
}: {
  pages: PDFPageProxy[];
  sizes: { w: number; h: number }[];
  snapshots: Snapshots;
  current: number;
  onPage: (page: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState<ReadonlySet<number>>(() => new Set());

  // Which thumbnails are within a screen of the view, and so worth drawing.
  // One observer for the lot, keyed by `data-page`. The set is copied only
  // when membership changes, so a report that changes nothing does not
  // re-render the strip.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) =>
        setNear((was) => {
          let next: Set<number> | null = null;
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting === (next ?? was).has(n)) continue;
            next ??= new Set(was);
            if (e.isIntersecting) next.add(n);
            else next.delete(n);
          }
          return next ?? was;
        }),
      { root, rootMargin: "100% 0px" },
    );
    for (const el of root.querySelectorAll("[data-page]")) io.observe(el);
    return () => io.disconnect();
  }, [pages]);

  // The current page's thumbnail stays in sight as the document scrolls.
  useEffect(() => {
    scroller.current
      ?.querySelector(`[data-page="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <div ref={scroller} className="h-full overflow-y-auto py-3 pr-3">
      <div className="flex flex-col items-center gap-3">
        {pages.map((page, i) => (
          <Thumb
            key={i + 1}
            page={page}
            n={i + 1}
            size={sizes[i]}
            snapshots={snapshots}
            on={i + 1 === current}
            near={near.has(i + 1)}
            onPage={onPage}
          />
        ))}
      </div>
    </div>
  );
}

/** One thumbnail. Memoised: a page or visibility change should re-render
 *  the thumbnails it touches, not the whole strip. */
const Thumb = memo(function Thumb({
  page,
  n,
  size,
  snapshots,
  on,
  near,
  onPage,
}: {
  page: PDFPageProxy;
  n: number;
  size: { w: number; h: number };
  snapshots: Snapshots;
  on: boolean;
  near: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <button
      type="button"
      data-page={n}
      title={`Page ${n}`}
      aria-current={on ? "page" : undefined}
      onClick={() => onPage(n)}
      className="group flex cursor-pointer flex-col items-center gap-1"
    >
      <div
        className={`relative overflow-hidden rounded-sm bg-white ring-2 transition-shadow ${
          on ? "ring-accent-lit" : "ring-transparent group-hover:ring-edge-strong"
        }`}
        style={{ width: THUMB_WIDTH, height: Math.round((THUMB_WIDTH * size.h) / size.w) }}
      >
        <PageCanvas
          page={page}
          scale={THUMB_WIDTH / size.w}
          active={near}
          snapshots={snapshots}
          preview
        />
      </div>
      <span className={`text-xs tabular-nums ${on ? "text-accent-lit" : "text-muted"}`}>{n}</span>
    </button>
  );
});

function Outline({
  nodes,
  onOutline,
}: {
  nodes: OutlineNode[];
  onOutline: (node: OutlineNode) => void;
}) {
  return (
    <div className="h-full overflow-y-auto py-2 pr-2">
      <ul role="tree">
        {nodes.map((node, i) => (
          <OutlineItem key={i} node={node} depth={0} onOutline={onOutline} />
        ))}
      </ul>
    </div>
  );
}

/** One entry and, once opened, its children. Closed to begin with, as a
 *  long manual's outline is mostly subsections. */
function OutlineItem({
  node,
  depth,
  onOutline,
}: {
  node: OutlineNode;
  depth: number;
  onOutline: (node: OutlineNode) => void;
}) {
  const [open, setOpen] = useState(false);
  const branch = node.children.length > 0;
  return (
    <li role="treeitem" aria-expanded={branch ? open : undefined}>
      <div className="flex items-start" style={{ paddingLeft: depth * 14 }}>
        {branch ? (
          <button
            type="button"
            aria-label={open ? "Collapse" : "Expand"}
            onClick={() => setOpen((o) => !o)}
            className="mt-1 shrink-0 cursor-pointer rounded p-0.5 text-muted hover:text-ink"
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="w-[18px] shrink-0" />
        )}
        <button
          type="button"
          disabled={node.dest === null}
          onClick={() => onOutline(node)}
          className={`min-w-0 flex-1 cursor-pointer rounded px-1.5 py-1 text-left text-[13px] leading-snug break-words text-ink hover:bg-edge/60 disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent ${
            node.bold ? "font-semibold" : ""
          } ${node.italic ? "italic" : ""}`}
        >
          {node.title}
        </button>
      </div>
      {branch && open && (
        <ul role="group">
          {node.children.map((child, i) => (
            <OutlineItem key={i} node={child} depth={depth + 1} onOutline={onOutline} />
          ))}
        </ul>
      )}
    </li>
  );
}
