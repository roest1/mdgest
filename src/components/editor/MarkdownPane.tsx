import { SquarePen } from "lucide-react";
import {
  createElement,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
} from "react";
import ReactMarkdown, {
  type Components,
  type ExtraProps,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import { Spinner } from "src/components/shared/Spinner";
import type { Analysis } from "src/lib/analysis";
import { useAssetUrl } from "src/lib/assets";
import type { Markdown } from "src/lib/emit";
import { pieces, samePiece, type Piece } from "src/lib/pieces";
import { attachSync, invalidateSync, remeasureSync } from "src/lib/scrollsync";
import { useEditor, type Reading } from "src/lib/store";
import { assetsPrefix } from "src/lib/workspace";
import { barButton } from "./controls";
import { MarkdownProperties } from "./MarkdownProperties";
import { MoreMenu } from "./MoreMenu";
import { Pane } from "./Pane";
import { useProgressive } from "./progressive";
import { markdownTops, trackSkipped } from "./tops";

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

/** react-markdown's block elements, each marked with the block that wrote
 *  it: the parser records on every node the source line it starts on, and
 *  the emitter records which block wrote each line. What the scroll sync
 *  finds a block's place in this pane by. A piece is parsed alone, so its
 *  line 1 is its own first line. */
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
        ...props
      }: HTMLAttributes<HTMLElement> & ExtraProps) {
        return createElement(tag, {
          ...props,
          "data-block": blockAt(node?.position?.start.line),
        });
      },
    ]),
  );
}

/** One page of the markdown, parsed and drawn on its own: drawn again
 *  only when what it says changes, so an edit costs its page and not the
 *  document. */
const RenderedPiece = memo(
  function RenderedPiece({
    piece,
    components,
    height,
  }: {
    piece: Piece;
    components: Components;
    /** Its estimated height: what it is taken to be while off screen,
     *  until it has been laid out once. */
    height: number;
  }) {
    const all = useMemo(
      () => ({ ...marked(piece), ...components }),
      [piece, components],
    );
    return (
      <div
        className="piece"
        data-piece={piece.page}
        style={{ containIntrinsicSize: `auto ${height}px` }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={all}>
          {piece.text}
        </ReactMarkdown>
      </div>
    );
  },
  (a, b) =>
    a.components === b.components &&
    a.height === b.height &&
    samePiece(a.piece, b.piece),
);

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
 *  markdown parses alone in a fifth of the time it takes in the whole. */
function Rendered({
  docId,
  analysis,
  list,
  scroller,
}: {
  docId: string;
  analysis: Analysis;
  list: Piece[];
  scroller: React.RefObject<HTMLDivElement | null>;
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
  const { shown, wait, filling } = useProgressive(items, scroller);
  return (
    <article
      className="markdown mx-auto max-w-[72ch] px-8 pt-6 pb-24"
      aria-busy={filling}
    >
      {list.map((piece, i) =>
        shown.has(piece.page) ? (
          <RenderedPiece
            key={piece.page}
            piece={piece}
            components={components}
            height={heights[i]}
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
type Kind = "heading" | "rule" | "image" | "text";

function kindOf(line: string): Kind {
  if (/^#{1,6}\s/.test(line)) return "heading";
  if (/^(---+|```)\s*$/.test(line)) return "rule";
  if (line.startsWith("![")) return "image";
  return "text";
}

/** One page of the source, its lines numbered on from the pages before. */
const RawPiece = memo(
  function RawPiece({ piece, height }: { piece: Piece; height: number }) {
    return (
      <ol
        className="source piece"
        data-piece={piece.page}
        style={{
          counterReset: `line ${piece.from}`,
          containIntrinsicSize: `auto ${height}px`,
        }}
      >
        {piece.lines.map((line, i) => (
          <li
            key={i}
            data-kind={kindOf(line.text)}
            data-block={line.block ?? undefined}
          >
            {line.text}
          </li>
        ))}
      </ol>
    );
  },
  (a, b) =>
    a.piece.from === b.piece.from &&
    a.height === b.height &&
    samePiece(a.piece, b.piece),
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
}: {
  markdown: Markdown;
  list: Piece[];
  scroller: React.RefObject<HTMLDivElement | null>;
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
          <RawPiece key={piece.page} piece={piece} height={heights[i]} />
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
      <div ref={scroller} className="h-full overflow-y-auto">
        {reading?.status === "ready" && list ? (
          view === "rendered" ? (
            <Rendered
              docId={docId}
              analysis={reading.analysis}
              list={list}
              scroller={scroller}
            />
          ) : (
            <Raw markdown={reading.markdown} list={list} scroller={scroller} />
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
