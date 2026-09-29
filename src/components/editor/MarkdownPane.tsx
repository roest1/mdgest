import { SquarePen } from "lucide-react";
import {
  type CSSProperties,
  createElement,
  type HTMLAttributes,
  memo,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Spinner } from "src/components/shared/Spinner";
import type { Analysis } from "src/lib/analysis";
import { useAssetUrl } from "src/lib/assets";
import type { Markdown, Placed } from "src/lib/emit";
import { attachSync, invalidateSync } from "src/lib/scrollsync";
import { modifiers, useEditor, type Selection, type View } from "src/lib/store";
import { assetsPrefix } from "src/lib/workspace";

/** What the source view needs of the selection: which blocks, where each
 *  one's lines are, which to bring into view, and whether to. The rendered
 *  view reads the store block by block instead, so a click does not remake
 *  it -- see `components`. */
interface Marks {
  /** By first source line: the placed block starting there. */
  byLine: Map<number, Placed>;
  /** The block picked last, when it was picked on the page and this pane
   *  should scroll to it; null when it was picked here. */
  scrollTo: string | null;
}

const NO_MARKS: Marks = { byLine: new Map(), scrollTo: null };

function marksOf(markdown: Markdown, selection: Selection | null, docId: string): Marks {
  if (!selection || selection.docId !== docId) return NO_MARKS;
  const byLine = new Map<number, Placed>();
  for (const id of selection.ids) {
    const at = markdown.blocks[id];
    if (at) byLine.set(at.from, at);
  }
  return { byLine, scrollTo: selection.from === "page" ? selection.focus : null };
}

type Pick = (id: string, e: MouseEvent) => void;

export function MarkdownPane({ docId }: { docId: string }) {
  const reading = useEditor((s) => s.readings[docId]);
  const view = useEditor((s) => s.view);
  const setView = useEditor((s) => s.setView);
  const selection = useEditor((s) => s.selection);
  const pick = useEditor((s) => s.pick);

  const markdown = reading?.status === "ready" ? reading.markdown : null;
  const marks = useMemo(
    () => (markdown ? marksOf(markdown, selection, docId) : NO_MARKS),
    [markdown, selection, docId],
  );
  const onPick = useCallback<Pick>(
    (id, e) => pick(docId, id, modifiers(e), "markdown"),
    [pick, docId],
  );
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useScrollSync(docId, markdown !== null, view, root, scroller, content);

  return (
    <div ref={root} className="flex h-full flex-col">
      {/* Three columns, as on the pages side, so the toggle sits centered
          whatever the width of what is beside it. */}
      <div
        data-bar
        className="grid h-9 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-edge px-3 text-xs text-faint"
      >
        {/* The shape the pane's edit control will take. It does nothing
            yet: there is no way to edit markdown back into decisions. */}
        <button
          type="button"
          disabled={markdown === null}
          className="flex cursor-pointer items-center gap-1.5 justify-self-start rounded-md
            border border-edge bg-raised/40 px-2 py-1 text-muted transition-colors
            enabled:hover:bg-raised enabled:hover:text-ink disabled:cursor-default disabled:opacity-40"
        >
          <SquarePen className="h-4 w-4" />
          edit
        </button>
        <ViewToggle view={view} onView={setView} />
      </div>

      <div
        ref={scroller}
        data-scroller
        className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
      >
        {reading === undefined || reading.status === "reading" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <Spinner className="h-5 w-5 text-muted" />
            {reading && reading.pages > 0 && (
              <p className="text-xs tabular-nums text-faint">
                Reading page {Math.max(1, reading.page)} of {reading.pages}
              </p>
            )}
          </div>
        ) : reading.status === "failed" ? (
          <p className="p-6 text-center text-sm text-red-300">{reading.problem}</p>
        ) : view === "rendered" ? (
          <div ref={content}>
            <Rendered
              docId={docId}
              analysis={reading.analysis}
              markdown={reading.markdown}
              onPick={onPick}
            />
          </div>
        ) : (
          <div ref={content}>
            <Raw markdown={reading.markdown} marks={marks} onPick={onPick} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Joins the pane to the pages' scroll once there is markdown to scroll.
 *  Where the blocks are is read from the DOM, and read again only after the
 *  content changes size -- a view switched, the pane resized, a figure
 *  loaded -- not on every scroll. */
function useScrollSync(
  docId: string,
  ready: boolean,
  view: View,
  root: React.RefObject<HTMLDivElement | null>,
  scroller: React.RefObject<HTMLDivElement | null>,
  content: React.RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!ready || !root.current || !el || !inner) return;
    const ro = new ResizeObserver(() => invalidateSync(docId));
    ro.observe(inner);
    const detach = attachSync(docId, "markdown", {
      root: root.current,
      scroller: el,
      tops: () => {
        const out = new Map<string, number>();
        const base = el.getBoundingClientRect().top - el.scrollTop;
        for (const node of el.querySelectorAll<HTMLElement>("[data-block]")) {
          const id = node.dataset.block!;
          if (!out.has(id)) out.set(id, node.getBoundingClientRect().top - base);
        }
        return out;
      },
    });
    return () => {
      ro.disconnect();
      detach();
    };
  }, [docId, ready, view, root, scroller, content]);
}

function ViewToggle({ view, onView }: { view: View; onView: (view: View) => void }) {
  // The walkthrough talks over the rendered view -- its arrows point into
  // it -- so while it runs the toggle waits, rather than being fought.
  const touring = useEditor((s) => s.tour !== null);
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
          disabled={touring}
          onClick={() => onView(v)}
          className={`cursor-pointer rounded px-2.5 py-0.5 text-xs transition-colors disabled:cursor-default ${
            view === v ? "bg-raised text-ink" : "text-muted enabled:hover:text-ink disabled:opacity-40"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

// ---- rendered -------------------------------------------------------------

/** The elements a block becomes, and so the ones that can be picked and
 *  marked. Each block is written on one source line, and every element
 *  here starts on the line of the block it came from -- a list item's own
 *  line, whatever is nested under it. */
const BLOCKS = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "table", "li"] as const;

/** Elements that can hold a wrapper around them without breaking what
 *  they are in. A list item cannot: a div between a list and its items
 *  takes the item out of the list, so it is marked on itself instead. */
const WRAPPED = new Set<string>(["p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "table"]);

/** Brings the element into view when it is the one to scroll to, and is
 *  not already -- with the panes' scroll synced it usually is, and moving
 *  it anyway would put the panes out of step. */
function useScrollTo(scroll: boolean) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!scroll || !el) return;
    const view = el.closest("[data-scroller]")?.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    if (view && box.top >= view.top && box.bottom <= view.bottom) return;
    el.scrollIntoView({ block: "center" });
  }, [scroll]);
  return ref;
}

/** react-markdown's elements: each one that came from a block is picked by
 *  clicking it, and marked with the selection when its block is selected.
 *  The parser records on every node the source lines it came from, and
 *  the emitter records which block wrote each line. Marked by wrapping,
 *  so the note can sit beside the element whatever it is -- except a list
 *  item, which takes the class itself.
 *
 * Each element reads its own block's selection from the store, so a click
 * re-renders the blocks it changed and nothing above them: these
 * components, and the tree they render, outlive every selection. */
function components(
  markdown: Markdown,
  docId: string,
  onPick: Pick,
  figure: Components["img"],
): Components {
  const blockAt = (line: number | undefined) =>
    line === undefined ? null : markdown.lines[line - 1]?.block ?? null;

  const make = (tag: (typeof BLOCKS)[number]) =>
    function Marked({ node, className, ...props }: HTMLAttributes<HTMLElement> & ExtraProps) {
      const line = node?.position?.start.line;
      const id = blockAt(line);
      const on = useEditor(
        (s) => id !== null && s.selection?.docId === docId && s.selection.ids.includes(id),
      );
      // Scrolled to when it was picked on the page: this pane should show
      // it. Picked here, it stays where it was clicked.
      const scroll = useEditor(
        (s) =>
          id !== null &&
          s.selection?.docId === docId &&
          s.selection.from === "page" &&
          s.selection.focus === id,
      );
      const ref = useScrollTo(scroll);
      const at = on && id !== null ? markdown.blocks[id] : undefined;

      const onClick = id
        ? (e: MouseEvent) => {
            // A click on an item inside an item is the inner one's.
            e.stopPropagation();
            onPick(id, e);
          }
        : undefined;
      // A shift-click would also extend the browser's own text selection.
      const onMouseDown = id ? (e: MouseEvent) => e.shiftKey && e.preventDefault() : undefined;
      const classes = [className, id ? "pick" : "", on && !WRAPPED.has(tag) ? "selection" : ""]
        .filter(Boolean)
        .join(" ");
      const note = at ? (
        <span className="note" aria-hidden>
          {at.n}
        </span>
      ) : null;

      if (!on || !WRAPPED.has(tag)) {
        return createElement(
          tag,
          {
            ...props,
            className: classes || undefined,
            onClick,
            onMouseDown,
            ref,
            "data-block": id ?? undefined,
            "data-tour": on ? "selected" : undefined,
          },
          note,
          props.children,
        );
      }
      return (
        <div
          className="selection"
          data-tour="selected"
          ref={ref as React.RefObject<HTMLDivElement>}
        >
          {note}
          {createElement(tag, {
            ...props,
            className: classes || undefined,
            onClick,
            onMouseDown,
            "data-block": id ?? undefined,
          })}
        </div>
      );
    };

  return {
    ...Object.fromEntries(BLOCKS.map((tag) => [tag, make(tag)])),
    img: figure,
  };
}

/** The <img> for `docId`'s markdown: a figure, by the path the markdown
 *  gives it. A path under the document's own assets folder is one the
 *  workspace holds; anything else the markdown could say is shown as its
 *  alt text alone. The size comes from the analysis, so the pane lays out
 *  at its final height before the pixels arrive -- a scroll to a block
 *  would otherwise land above it once the images ahead of it grew. Made
 *  once per document, not per selection, so a click remounts no image. */
function figureFor(docId: string, analysis: Analysis): Components["img"] {
  const prefix = assetsPrefix(docId);
  const sizes = new Map<string, [number, number]>();
  for (const page of analysis.pages) for (const pic of page.pictures) sizes.set(pic.path, pic.px);
  return function Figure({
    node: _node,
    src,
    alt,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & ExtraProps) {
    const name = typeof src === "string" && src.startsWith(prefix) ? src.slice(prefix.length) : "";
    const url = useAssetUrl(docId, name);
    const px = sizes.get(name);
    if (!url) return <span className="text-faint">[{alt}]</span>;
    return <img {...props} src={url} alt={alt} width={px?.[0]} height={px?.[1]} />;
  };
}

/** The document as a reader would see it. react-markdown writes no raw HTML
 *  through, so what a PDF's text happens to contain stays text. The look is
 *  `.markdown` in index.css.
 *
 * The tree is memoised on the document alone: parsing it is the pane's one
 *  expensive step, and the selection is read inside each element, not here. */
function Rendered({
  docId,
  analysis,
  markdown,
  onPick,
}: {
  docId: string;
  analysis: Analysis;
  markdown: Markdown;
  onPick: Pick;
}) {
  const figure = useMemo(() => figureFor(docId, analysis), [docId, analysis]);
  const parts = useMemo(
    () => components(markdown, docId, onPick, figure),
    [markdown, docId, onPick, figure],
  );
  return useMemo(
    () => (
      <article className="markdown mx-auto max-w-[72ch] px-8 pt-6 pb-24">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={parts}>
          {markdown.text}
        </ReactMarkdown>
      </article>
    ),
    [markdown, parts],
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

/** One row of the source view: a line, picked by clicking it when a block
 *  wrote it, and lit when that block is selected. Memoised: a selection
 *  touches a handful of rows, and the thousands of others should not pay
 *  for the click. */
const Row = memo(function Row({
  text,
  block,
  at,
  scroll,
  onPick,
}: {
  text: string;
  block: string | null;
  at: Placed | undefined;
  scroll: boolean;
  onPick: Pick;
}) {
  const ref = useScrollTo(scroll);
  return (
    <li
      ref={ref as React.RefObject<HTMLLIElement>}
      data-kind={kindOf(text)}
      data-selected={at ? "" : undefined}
      data-pick={block ? "" : undefined}
      data-block={block ?? undefined}
      onClick={block ? (e) => onPick(block, e) : undefined}
    >
      {at && (
        <span className="note" aria-hidden>
          {at.n}
        </span>
      )}
      {text || " "}
    </li>
  );
});

/** The markdown characters, one row a line, numbered in the gutter. The
 *  numbers are CSS counters rather than text, so a copy of the view is the
 *  markdown alone. A blank line holds a space: with `pre-wrap` that is what
 *  gives an empty row its height. The look is `.source` in index.css. */
function Raw({ markdown, marks, onPick }: { markdown: Markdown; marks: Marks; onPick: Pick }) {
  const scrollLine = marks.scrollTo ? markdown.blocks[marks.scrollTo]?.from : undefined;
  return (
    <ol
      className="source pt-2 pb-24"
      style={{ "--digits": String(markdown.lines.length).length } as CSSProperties}
    >
      {markdown.lines.map((line, i) => (
        <Row
          key={i}
          text={line.text}
          block={line.block}
          at={marks.byLine.get(i + 1)}
          scroll={scrollLine === i + 1}
          onPick={onPick}
        />
      ))}
    </ol>
  );
}
