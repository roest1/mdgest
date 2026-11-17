import type { Element as HastElement } from "hast";
import { SquarePen } from "lucide-react";
import {
  createContext,
  createElement,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type HTMLAttributes,
  type JSX,
} from "react";
import { Spinner } from "src/components/shared/Spinner";
import type { Analysis } from "src/lib/analysis";
import { useAssetUrl } from "src/lib/assets";
import type { Markdown, Placed } from "src/lib/emit";
import { parseAhead, ready, treeOf } from "src/lib/parse";
import { pieces, samePiece, type Piece } from "src/lib/pieces";
import { attachSync, invalidateSync, remeasureSync } from "src/lib/scrollsync";
import { modifiers, offBlocks } from "src/lib/selection";
import { BlockActions } from "./BlockActions";
import { useEditor, type Reading } from "src/lib/store";
import { assetsPrefix } from "src/lib/workspace";
import { barButton } from "./controls";
import { drawTree } from "./drawTree";
import { MarkdownProperties } from "./MarkdownProperties";
import { MoreMenu } from "./MoreMenu";
import { Pane } from "./Pane";
import { useProgressive, type Prepare } from "./progressive";
import { markdownTops, trackSkipped } from "./tops";
import { NONE, useSelected } from "./useSelected";

const NO_PLACED: Record<string, Placed> = {};

/** How the markdown is shown: as it reads, or as its source. */
type View = "rendered" | "raw";

function ViewToggle({
  view,
  onView,
}: {
  view: View;
  onView: (view: View) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Markdown view"
      className="flex rounded-md border border-edge bg-raised/40 p-0.5"
    >
      {(["rendered", "raw"] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          onClick={() => onView(v)}
          className={`cursor-pointer rounded px-2.5 py-0.5 text-xs transition-colors ${
            view === v ? "bg-raised text-ink" : "text-muted hover:text-ink"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

// ---- rendered -------------------------------------------------------------

/** What an element's component is given besides its props: the hast
 *  element it is drawn from, whose position says which line it starts on. */
interface ExtraProps {
  node?: HastElement;
}

/** Components to draw elements with, by tag. */
type Components = {
  [Tag in keyof JSX.IntrinsicElements]?: ComponentType<
    JSX.IntrinsicElements[Tag] & ExtraProps
  >;
};

/** Each figure's size as the pane shows it, by its path in the assets
 *  folder: the size it is printed, in CSS px, which is 3/4 of a point. */
type FigureSizes = Map<string, { width: number; height: number }>;

function figureSizes(analysis: Analysis): FigureSizes {
  const sizes: FigureSizes = new Map();
  for (const page of analysis.pages)
    for (const pic of page.pictures)
      sizes.set(pic.path, {
        width: Math.round((pic.box.w * 4) / 3),
        height: Math.round((pic.box.h * 4) / 3),
      });
  return sizes;
}

/** The <img> for `docId`'s markdown: a figure, by the path the markdown
 *  gives it. A path under the document's own assets folder is one the
 *  workspace holds; anything else the markdown could say is shown as its
 *  alt text alone. Shown at the size it is printed, a point a point -- not
 *  its pixels, which `read.ts` draws at twice that or more -- and held at
 *  that size while its pixels are read, so the pane does not jump as each
 *  one arrives. */
function figureFor(docId: string, sizes: FigureSizes): Components["img"] {
  const prefix = assetsPrefix(docId);
  /** The path as the workspace names it: the markdown writes it
   *  percent-encoded (`emit.ts`), and the parser hands it over so. */
  const decoded = (src: string) => {
    try {
      return decodeURIComponent(src);
    } catch {
      return src;
    }
  };
  return function Figure({
    node: _node,
    src,
    alt,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & ExtraProps) {
    const path = typeof src === "string" ? decoded(src) : "";
    const name = path.startsWith(prefix) ? path.slice(prefix.length) : "";
    const url = useAssetUrl(docId, name);
    const size = sizes.get(name);
    if (!name || url === null)
      return <span className="text-faint">[{alt}]</span>;
    if (url === undefined)
      return (
        <span
          className="figure-wait"
          aria-hidden
          style={
            size && {
              width: size.width,
              aspectRatio: `${size.width} / ${size.height}`,
            }
          }
        />
      );
    return <img {...props} src={url} alt={alt} {...size} />;
  };
}

/** A link the markdown carries -- a PDF's link annotation, written out by
 *  `emit.ts` -- opened in a tab of its own. In this one it would replace
 *  the editor, and with it every open document. */
function Anchor({
  node: _node,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

/** The elements a block can be written as. */
const BLOCKS = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li"] as const;

/** What a page of the markdown has selected: the ids, and the blocks the
 *  numbers on their notes are read off. Handed down through the page's
 *  drawn tree rather than into it, so a selection draws the elements whose
 *  block it changed again and leaves the tree as it was built. */
const Lit = createContext<{
  ids: ReadonlySet<string>;
  blocks: Record<string, Placed>;
}>({ ids: NONE, blocks: {} });

/** The block a list item was written by, to what is nested in it: a
 *  paragraph inside an item starts on the item's line, so it is the item's
 *  block too, and the item alone is lit. */
const Within = createContext<string | undefined>(undefined);

/** The markdown's block elements, each marked with the block that wrote
 *  it: the parser records on every node the source line it starts on, and
 *  the emitter records which block wrote each line. What the scroll sync
 *  finds a block's place in this pane by, and what a click picks. Lit when
 *  its block is selected, with the block's number on a note: on the
 *  element itself, so a selection moves nothing, and the note in a slot of
 *  its own ahead of the children, so they are not remade with it. A piece
 *  is parsed alone, so its line 1 is its own first line. */
function marked(piece: Piece): Components {
  const blockAt = (line: number | undefined) =>
    line === undefined
      ? undefined
      : (piece.lines[line - 1]?.block ?? undefined);
  return Object.fromEntries(
    BLOCKS.map((tag) => [
      tag,
      function Marked({
        node,
        className,
        children,
        ...props
      }: HTMLAttributes<HTMLElement> & ExtraProps) {
        const id = blockAt(node?.position?.start.line);
        const lit = useContext(Lit);
        const within = useContext(Within);
        const at = id !== undefined && id !== within && lit.ids.has(id);
        const element = createElement(
          tag,
          {
            ...props,
            className:
              [className, at ? "selection" : ""].filter(Boolean).join(" ") ||
              undefined,
            "data-block": id,
          },
          at ? (
            <span className="note" aria-hidden>
              {lit.blocks[id]?.n}
            </span>
          ) : null,
          children,
        );
        return tag === "li" && id !== undefined ? (
          <Within.Provider value={id}>{element}</Within.Provider>
        ) : (
          element
        );
      },
    ]),
  );
}

/** One page of the markdown, drawn on its own from its tree -- parsed in a
 *  worker ahead of it, or here if it was not (`parse.ts`): drawn again only
 *  when what it says changes, so an edit costs its page and not the
 *  document. Drawn as react-markdown drew it (`drawTree`), which
 *  `pieces.test.ts` holds it to. */
const RenderedPiece = memo(
  function RenderedPiece({
    docId,
    piece,
    components,
    height,
    selected,
    blocks,
  }: {
    docId: string;
    piece: Piece;
    components: Components;
    /** Its estimated height: what it is taken to be while off screen,
     *  until it has been laid out once. */
    height: number;
    /** The ids selected on its page (`useSelected`). */
    selected: ReadonlySet<string>;
    /** Every block, for the numbers on its selected ones' notes. */
    blocks: Record<string, Placed>;
  }) {
    const drawn = useMemo(
      () =>
        drawTree(treeOf(docId, piece.text), {
          ...marked(piece),
          ...components,
        }),
      [docId, piece, components],
    );
    const lit = useMemo(() => ({ ids: selected, blocks }), [selected, blocks]);
    return (
      <div
        className="piece"
        data-piece={piece.page}
        style={{ containIntrinsicSize: `auto ${height}px` }}
      >
        <Lit.Provider value={lit}>{drawn}</Lit.Provider>
      </div>
    );
  },
  // An edit places every block anew, and a book has a thousand pages
  // drawn: each draws again only if what it says changed, or the number
  // on one of its notes did -- not for every edit to any page.
  (a, b) =>
    a.docId === b.docId &&
    a.components === b.components &&
    a.height === b.height &&
    a.selected === b.selected &&
    sameNotes(a.selected, a.blocks, b.blocks) &&
    samePiece(a.piece, b.piece),
);

/** Whether the selected blocks `ids` are numbered the same in `a` and `b`. */
function sameNotes(
  ids: ReadonlySet<string>,
  a: Record<string, Placed>,
  b: Record<string, Placed>,
): boolean {
  if (a === b) return true;
  for (const id of ids) if (a[id]?.n !== b[id]?.n) return false;
  return true;
}

/** The pages' markdown parsed ahead of the view, in workers (`parse.ts`):
 *  a page is ready to draw once it is parsed. */
function useParsedAhead(docId: string, list: Piece[]): Prepare {
  return useMemo(() => {
    const textOf = new Map(list.map((p) => [p.page, p.text]));
    return {
      ready: (key) => {
        const text = textOf.get(key);
        return text === undefined || ready(docId, text);
      },
      ahead: (order, wake) =>
        parseAhead(
          docId,
          function* () {
            for (const key of order()) {
              const text = textOf.get(key);
              if (text !== undefined) yield text;
            }
          },
          wake,
        ),
    };
  }, [docId, list]);
}

/** Where a page of the markdown will be, while it waits its turn to be
 *  drawn: about its height, so the scrollbar is about right, lined like
 *  text with a shimmer through it, and named by its page -- what is seen
 *  when a jump lands somewhere not drawn yet, for the moment until it is.
 *  The look is `.piece-wait` in index.css. Drawn once: each batch draws a
 *  few pages and renders the list anew, and a book has a thousand of these
 *  waiting in it; rendered again with every batch, they were a tenth of
 *  the fill. */
const Waiting = memo(function Waiting({
  page,
  height,
  row,
  ref,
}: {
  page: number;
  height: number;
  /** The view's line height, in px: what its lines are drawn apart by. */
  row: number;
  ref: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      aria-hidden
      className="piece-wait"
      data-wait={page}
      style={{ height, "--row": `${row}px` } as CSSProperties}
    />
  );
});

/** The two views' line heights, in px: 15px type at 1.65, and the
 *  source's 12.5px at 1.55 (`.markdown` and `.source` in index.css). */
const RENDERED_ROW = 24.75;
const RAW_ROW = 19.375;

/** How tall a page of the rendered markdown is, near enough for its
 *  placeholder: lines of text at the pane's measure, a rule, and the
 *  figures at the size they are shown. Only an estimate -- the scrollbar
 *  settles as the pages are drawn. */
function renderedHeight(piece: Piece, analysis: Analysis): number {
  const LINE = RENDERED_ROW;
  const MEASURE = 80; // characters to a line, at 72ch of the serif
  const COLUMN = 576; // 72ch, the widest a figure is shown
  let h = 0;
  for (const { text } of piece.lines) {
    if (text === "") continue;
    if (text === "---") h += 64;
    else if (!text.startsWith("!["))
      h += Math.ceil(text.length / MEASURE) * LINE + 12;
  }
  for (const pic of analysis.pages[piece.page - 1]?.pictures ?? []) {
    const w = (pic.box.w * 4) / 3;
    h += ((pic.box.h * 4) / 3) * Math.min(1, COLUMN / w) + 32;
  }
  return Math.round(h);
}

/** The pieces, each its own markdown, drawn a batch at a time by
 *  `useProgressive`: what is in view first, the rest after, each batch
 *  inside a frame while a person's input waits and a few frames while none
 *  does, so a book does not hold the page for the half minute its
 *  markdown takes to parse whole -- which it is not, either: a page's
 *  markdown parses alone in a fifth of the time it takes in the whole.
 *  The first batch is parsed here; the rest in workers ahead of being
 *  drawn, each batch drawing what has been parsed. */
function Rendered({
  docId,
  analysis,
  blocks,
  list,
  scroller,
  selected,
}: {
  docId: string;
  analysis: Analysis;
  blocks: Record<string, Placed>;
  list: Piece[];
  scroller: React.RefObject<HTMLDivElement | null>;
  selected: (page: number) => ReadonlySet<string>;
}) {
  const components = useMemo(
    () => ({ a: Anchor, img: figureFor(docId, figureSizes(analysis)) }),
    [docId, analysis],
  );
  const items = useMemo(
    () => list.map((p) => ({ key: p.page, cost: p.text.length })),
    [list],
  );
  const heights = useMemo(
    () => list.map((p) => renderedHeight(p, analysis)),
    [list, analysis],
  );
  const prepare = useParsedAhead(docId, list);
  const { shown, wait, filling } = useProgressive(items, scroller, prepare);
  return (
    <article
      className="markdown mx-auto max-w-[72ch] px-8 pt-6 pb-24"
      aria-busy={filling}
    >
      {list.map((piece, i) =>
        shown.has(piece.page) ? (
          <RenderedPiece
            key={piece.page}
            docId={docId}
            piece={piece}
            components={components}
            height={heights[i]}
            selected={selected(piece.page)}
            blocks={blocks}
          />
        ) : (
          <Waiting
            key={piece.page}
            page={piece.page}
            height={heights[i]}
            row={RENDERED_ROW}
            ref={wait(piece.page)}
          />
        ),
      )}
    </article>
  );
}

// ---- raw ------------------------------------------------------------------

/** What a line of source is, for the gutter's tinting. Coarse on purpose:
 *  the source view is for checking the markdown, not highlighting it. */
type Kind = "heading" | "rule" | "image" | "comment" | "text";

function kindOf(line: string): Kind {
  // A hidden block: the line it would be, commented out -- indented into
  // the item before it when it is inside a list.
  if (line.trimStart().startsWith("<!--")) return "comment";
  if (/^#{1,6}\s/.test(line)) return "heading";
  if (/^(---+|```)\s*$/.test(line)) return "rule";
  if (line.startsWith("![")) return "image";
  return "text";
}

/** One page of the source, its lines numbered on from the pages before.
 *  Two parts, since an edit renumbers more than it rewrites: a line added
 *  or taken out moves where every page after it starts, which this, the
 *  list, takes as one counter on itself, and changes no line of theirs,
 *  which `RawLines` draws -- and draws again only when they change.
 *  Measured on a 792-page book (`bench/`): a delete early in it drew every
 *  page after it again, line by line, for a fifth of its time. */
const RawPiece = memo(
  function RawPiece({
    piece,
    height,
    selected,
  }: {
    piece: Piece;
    height: number;
    /** The ids selected on its page (`useSelected`). */
    selected: ReadonlySet<string>;
  }) {
    return (
      <ol
        className="source piece"
        data-piece={piece.page}
        style={{
          counterReset: `line ${piece.from}`,
          containIntrinsicSize: `auto ${height}px`,
        }}
      >
        <RawLines piece={piece} selected={selected} />
      </ol>
    );
  },
  (a, b) =>
    a.piece.from === b.piece.from &&
    a.height === b.height &&
    a.selected === b.selected &&
    samePiece(a.piece, b.piece),
);

/** A page's lines, for `RawPiece`: each marked with the block that wrote
 *  it, and lit when that block is selected. */
const RawLines = memo(
  function RawLines({
    piece,
    selected,
  }: {
    piece: Piece;
    selected: ReadonlySet<string>;
  }) {
    return piece.lines.map((line, i) => (
      <li
        key={i}
        data-kind={kindOf(line.text)}
        data-block={line.block ?? undefined}
        data-selected={
          line.block !== null && selected.has(line.block) ? "" : undefined
        }
      >
        {line.text}
      </li>
    ));
  },
  (a, b) => a.selected === b.selected && samePiece(a.piece, b.piece),
);

/** How tall a page of the source is: a row a line, and a row more for
 *  each time a long one wraps. */
function rawHeight(piece: Piece): number {
  const ROW = RAW_ROW;
  const MEASURE = 90;
  let rows = 0;
  for (const { text } of piece.lines)
    rows += Math.max(1, Math.ceil(text.length / MEASURE));
  return Math.round(rows * ROW);
}

/** The markdown characters, one row a line, numbered in the gutter. The
 *  numbers are CSS counters rather than text, so a copy of the view is the
 *  markdown alone; a blank line is empty, and its number gives it its
 *  height. A list a page, drawn a batch at a time as the rendered view
 *  is. The look is `.source` in index.css. */
function Raw({
  markdown,
  list,
  scroller,
  selected,
}: {
  markdown: Markdown;
  list: Piece[];
  scroller: React.RefObject<HTMLDivElement | null>;
  selected: (page: number) => ReadonlySet<string>;
}) {
  const items = useMemo(
    () => list.map((p) => ({ key: p.page, cost: p.text.length })),
    [list],
  );
  const heights = useMemo(() => list.map(rawHeight), [list]);
  const { shown, wait, filling } = useProgressive(items, scroller);
  return (
    <div
      className="pt-2 pb-24"
      aria-busy={filling}
      style={
        { "--digits": String(markdown.lines.length).length } as CSSProperties
      }
    >
      {list.map((piece, i) =>
        shown.has(piece.page) ? (
          <RawPiece
            key={piece.page}
            piece={piece}
            height={heights[i]}
            selected={selected(piece.page)}
          />
        ) : (
          <Waiting
            key={piece.page}
            page={piece.page}
            height={heights[i]}
            row={RAW_ROW}
            ref={wait(piece.page)}
          />
        ),
      )}
    </div>
  );
}

// ---- the pane -------------------------------------------------------------

/** What the pane says before the markdown is there. With no reading yet,
 *  the document is still being opened by the page pane, which starts one
 *  once it is; `page` is then how many pages are done, so the one being
 *  read is the next, and with all done what is left is writing it down.
 *  Nothing about pages before the first is done, which is also all a
 *  reading from the cache ever shows. */
function progress(reading: Reading | undefined): string {
  if (!reading) return "Opening…";
  if (reading.status !== "reading" || reading.page === 0) return "Reading…";
  if (reading.page >= reading.pages) return "Writing the markdown…";
  return `Reading page ${reading.page + 1} of ${reading.pages}…`;
}

/** Join the pane to the PDF pane's scroll once its markdown is shown, and
 *  again for each view, since each lays the blocks out anew. Where each
 *  block starts is measured off the elements marked with it, on the pages
 *  laid out, and estimated on the rest (`tops.ts`); and measured again
 *  whenever what the pane holds changes size -- a figure loading, a page
 *  drawn, the pane resized -- not on every scroll; and before the next
 *  follow when a page comes into view, and is laid out. */
function useScrollSync(
  docId: string,
  list: Piece[] | null,
  view: View,
  scroller: React.RefObject<HTMLDivElement | null>,
) {
  const ready = list !== null;
  // Read when measured, not when attached: the pieces change with every
  // edit, and the sync is the same sync across them.
  const byPage = useRef(new Map<number, Piece>());
  useEffect(() => {
    byPage.current = new Map(list?.map((p) => [p.page, p]));
  }, [list]);
  // Heard from before the first page is drawn, since the browser says a
  // page is skipped once, as it starts skipping it.
  const skipped = useRef(new WeakSet<Element>());
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const tracked = trackSkipped(el, () => remeasureSync(docId));
    skipped.current = tracked.skipped;
    return tracked.stop;
  }, [docId, scroller]);
  useEffect(() => {
    const el = scroller.current;
    const content = el?.firstElementChild;
    if (!ready || !el || !content) return;
    const ro = new ResizeObserver(() => invalidateSync(docId));
    ro.observe(content);
    const detach = attachSync(docId, "markdown", {
      scroller: el,
      tops: () => markdownTops(el, byPage.current, skipped.current),
    });
    return () => {
      ro.disconnect();
      detach();
    };
  }, [docId, ready, view, scroller]);
}

export function MarkdownPane({ docId }: { docId: string }) {
  const [view, setView] = useState<View>("rendered");
  const [properties, setProperties] = useState(false);
  const reading = useEditor((s) => s.readings[docId]);
  const scroller = useRef<HTMLDivElement>(null);
  const markdown = reading?.status === "ready" ? reading.markdown : null;
  const list = useMemo(() => markdown && pieces(markdown), [markdown]);
  useScrollSync(docId, list, view, scroller);
  const blocks = markdown?.blocks ?? NO_PLACED;
  const selected = useSelected(docId, blocks);

  /** A click on what a block wrote picks it, through the keys held, as a
   *  click on its box does; a click off every block lets the selection go.
   *  Not a click on a link, which goes where it points, nor one ending a
   *  drag over the words, which selected them to copy. */
  const onClick = (e: React.MouseEvent) => {
    const target = e.target as Element;
    if (target.closest("a")) return;
    const el = target.closest<HTMLElement>("[data-block]");
    if (!el) {
      if (offBlocks(e)) useEditor.getState().deselect();
      return;
    }
    if (!(window.getSelection()?.isCollapsed ?? true)) return;
    useEditor
      .getState()
      .pick(docId, el.dataset.block!, modifiers(e), "markdown");
  };

  return (
    <Pane
      left={
        // TODO: the editor's store, once ported: edit opens the markdown as
        // a draft, and a document marked done disables it.
        <button
          type="button"
          title="Edit the markdown as text; it becomes edits when you apply"
          className={barButton()}
        >
          <SquarePen className="h-4 w-4" />
          edit
        </button>
      }
      center={<ViewToggle view={view} onView={setView} />}
      right={
        <MoreMenu
          disabled={reading?.status !== "ready"}
          items={[
            {
              label: "Document properties",
              onPick: () => setProperties(true),
            },
          ]}
        />
      }
    >
      <div
        ref={scroller}
        className="relative h-full overflow-y-auto"
        onClick={onClick}
        // A shift-click on a block would also extend the browser's own
        // text selection from wherever it last was.
        onMouseDown={(e) =>
          e.shiftKey &&
          (e.target as Element).closest("[data-block]") &&
          e.preventDefault()
        }
      >
        {reading?.status === "ready" && list ? (
          view === "rendered" ? (
            <Rendered
              docId={docId}
              analysis={reading.analysis}
              blocks={blocks}
              list={list}
              scroller={scroller}
              selected={selected}
            />
          ) : (
            <Raw
              markdown={reading.markdown}
              list={list}
              scroller={scroller}
              selected={selected}
            />
          )
        ) : reading?.status === "failed" ? (
          <p className="p-6 text-center text-sm text-red-300">
            {reading.problem}
          </p>
        ) : (
          <p
            role="status"
            className="flex items-center justify-center gap-2 p-6 text-sm text-muted"
          >
            <Spinner />
            {progress(reading)}
          </p>
        )}
        {reading?.status === "ready" && (
          // Keyed by the view, so one view's hovered block is not the
          // other's: each draws its blocks anew.
          <BlockActions
            key={view}
            docId={docId}
            scroller={scroller}
            placement={view === "rendered" ? "corner" : "line"}
            reach={view === "rendered" ? 4 : 0}
          />
        )}
      </div>

      {properties && reading?.status === "ready" && list && (
        <MarkdownProperties
          docId={docId}
          markdown={reading.markdown}
          pieces={list}
          onClose={() => setProperties(false)}
        />
      )}
    </Pane>
  );
}
