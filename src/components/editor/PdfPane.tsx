import { Check, EllipsisVertical, Menu, Minus, Plus } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Spinner } from "src/components/shared/Spinner";
import type { Block } from "src/lib/analysis";
import { ensureRead } from "src/lib/convert";
import type { Placed } from "src/lib/emit";
import { engine } from "src/lib/engine";
import {
  openPdf,
  readOutline,
  readProperties,
  resolve,
  type OutlineNode,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type Properties,
} from "src/lib/pdf";
import { modifiers, useEditor, type Boxes } from "src/lib/store";
import { isTourDoc, tourSource } from "src/lib/tour-doc";
import { attachSync, invalidateSync } from "src/lib/scrollsync";
import { messageOf } from "src/lib/words";
import { sourcePath } from "src/lib/workspace";
import { PageCanvas } from "./PageCanvas";
import { PdfSidebar, THUMB_WIDTH, type SidebarView } from "./PdfSidebar";
import { PropertiesDialog } from "./PropertiesDialog";
import { Snapshots } from "./snapshots";

/** CSS px per PDF point at 100%: a point is 1/72 in, a CSS px 1/96. */
const PX_PER_PT = 96 / 72;
/** Around the pages, and between them, in CSS px. */
const PAD = 16;
const GAP = 16;
/** The steps the zoom buttons take, as in a browser's own PDF viewer. */
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const MIN_ZOOM = ZOOMS[0];
const MAX_ZOOM = ZOOMS.at(-1)!;

interface Loaded {
  doc: PDFDocumentProxy;
  pages: PDFPageProxy[];
  /** Each page's size at scale 1, in PDF points -- read once here, for the
   *  column's layout and the thumbnails both. */
  sizes: { w: number; h: number }[];
  outline: OutlineNode[];
  properties: Properties;
}

/** Why a document would not open, in words for the pane. pdf.js names its
 *  errors; its messages are written for developers. */
function whyNot(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : "";
  if (name === "PasswordException") {
    return "This PDF is password-protected, which mdgest cannot open yet.";
  }
  if (name === "InvalidPDFException") {
    return "This file is damaged or is not a PDF, and could not be opened.";
  }
  return `This PDF could not be opened (${messageOf(cause)}).`;
}

/** Open `docId` from the workspace: its bytes from the engine, then parsed,
 *  every page's size, the outline and the properties, all before the first
 *  page is laid out. A page's size is what places every page after it, so
 *  the column is not drawn until all of them are known. */
function useDocument(docId: string): { loaded: Loaded | null; problem: string | null } {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let task: ReturnType<typeof openPdf> | null = null;
    (async () => {
      const bytes = isTourDoc(docId) ? await tourSource() : await engine.source(docId);
      if (!live) return;
      // Taken before `openPdf`, which hands the buffer to pdf.js and leaves
      // this view of it empty.
      const size = bytes.byteLength;
      task = openPdf(bytes);
      const doc = await task.promise;
      // The pages, the outline and the properties depend on nothing but the
      // document, so their round trips to pdf.js's worker overlap.
      const pages$ = Promise.all(
        Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)),
      );
      const [pages, outline, properties] = await Promise.all([
        pages$,
        readOutline(doc),
        readProperties(doc, sourcePath(docId).at(-1)!, size, pages$.then((p) => p[0])),
      ]);
      const sizes = pages.map((p) => {
        const { width, height } = p.getViewport({ scale: 1 });
        return { w: width, h: height };
      });
      if (live) setLoaded({ doc, pages, sizes, outline, properties });
    })().catch((cause: unknown) => live && setProblem(whyNot(cause)));

    return () => {
      live = false;
      // Ends pdf.js's side of the document, whatever stage it reached; the
      // worker itself stays for the next one.
      void task?.destroy();
    };
  }, [docId]);

  return { loaded, problem };
}

interface Row {
  /** The row's pages left to right: 1-based number and drawn size in CSS px.
   *  The sizes live here so the boxes the render draws are the very numbers
   *  the row's geometry was summed from. */
  pages: { n: number; w: number; h: number }[];
  top: number;
  width: number;
  height: number;
}

/** The column's geometry, worked out rather than measured: every page's
 *  size is known, so where each row sits follows from the zoom alone. That
 *  is what lets a page be scrolled to, and the pages near the view picked
 *  out, without reading the DOM. */
function layout(sizes: { w: number; h: number }[], scale: number, twoPage: boolean): Row[] {
  const rows: Row[] = [];
  let top = PAD;
  for (let i = 0; i < sizes.length; i += twoPage ? 2 : 1) {
    const nums = twoPage && i + 1 < sizes.length ? [i + 1, i + 2] : [i + 1];
    const pages = nums.map((n) => ({
      n,
      w: Math.round(sizes[n - 1].w * scale),
      h: Math.round(sizes[n - 1].h * scale),
    }));
    const width = pages.reduce((sum, p) => sum + p.w, 0);
    const height = Math.max(...pages.map((p) => p.h));
    rows.push({ pages, top, width: width + GAP * (pages.length - 1), height });
    top += height + GAP;
  }
  return rows;
}

/** Which rows are worth drawing -- the view, and a screen either side --
 *  and which page is current: the first of the row under a line a third of
 *  the way down the view, which is where a jump to a heading puts it. At the
 *  very bottom it is the last row, which may never reach that line. */
function inView(rows: Row[], top: number, height: number, end: boolean) {
  let first = -1;
  let last = -1;
  let current = 0;
  const probe = top + height / 3;
  rows.forEach((row, i) => {
    const bottom = row.top + row.height;
    if (bottom >= top - height && row.top <= top + 2 * height) {
      if (first < 0) first = i;
      last = i;
    }
    // Rows are in order, so the last one starting above the probe holds it,
    // or is the nearest above it when the probe falls in a gap.
    if (row.top <= probe) current = i;
  });
  if (end) current = rows.length - 1;
  return { first, last, current: rows[current].pages[0].n };
}

/** What a page has on it and which of it is selected, for its row. */
const NO_BLOCKS: Block[] = [];
const NO_IDS: string[] = [];
const NO_PLACED: Record<string, Placed> = {};

/** What `sizes` is before a document has loaded: one value, so nothing
 *  downstream recomputes for a fresh empty array each render. */
const NO_SIZES: { w: number; h: number }[] = [];

const iconButton =
  "cursor-pointer rounded p-1 text-muted transition-colors enabled:hover:text-ink disabled:cursor-default disabled:opacity-40";

export function PdfPane({ docId }: { docId: string }) {
  const { loaded, problem } = useDocument(docId);
  const [sidebar, setSidebar] = useState(false);
  const [sidebarView, setSidebarView] = useState<SidebarView>("thumbnails");
  const [twoPage, setTwoPage] = useState(false);
  const [properties, setProperties] = useState(false);
  // The zoom fits the first page to the pane's width, and keeps fitting it as
  // the pane changes size, until one is picked with the buttons. To the
  // first page rather than the widest: one landscape fold-out would
  // otherwise shrink every portrait page around it.
  const [picked, setPicked] = useState<number | null>(null);
  const [paneWidth, setPaneWidth] = useState(0);
  const [range, setRange] = useState({ first: 0, last: -1, current: 1 });
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // One per document -- the pane is keyed by it -- fed by every finished
  // render and read by the thumbnails.
  const [snapshots] = useState(() => new Snapshots(THUMB_WIDTH));

  // The document is read once it is open: off its pages the first time,
  // from the engine's cache after. Closing the pane mid-read gives it up.
  useEffect(() => {
    if (!loaded) return;
    return ensureRead(docId, loaded.pages);
  }, [docId, loaded]);
  const reading = useEditor((s) => s.readings[docId]);
  const analysis = reading?.status === "ready" ? reading.analysis : null;
  const placed = reading?.status === "ready" ? reading.markdown.blocks : NO_PLACED;
  const selection = useEditor((s) => s.selection);
  const selectedIds = selection?.docId === docId ? selection.ids : NO_IDS;
  const pick = useEditor((s) => s.pick);
  const boxes = useEditor((s) => s.boxes);
  const notes = useEditor((s) => s.notes);
  const onPick = useCallback(
    (id: string, e: React.MouseEvent) => pick(docId, id, modifiers(e), "page"),
    [pick, docId],
  );

  const sizes = loaded?.sizes ?? NO_SIZES;
  const fit =
    sizes.length && paneWidth
      ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (paneWidth - 2 * PAD) / (sizes[0].w * PX_PER_PT)))
      : null;
  const zoom = picked ?? fit;
  const ready = loaded !== null && zoom !== null;
  const scale = (zoom ?? 1) * PX_PER_PT;
  const rows = useMemo(() => layout(sizes, scale, twoPage), [sizes, scale, twoPage]);
  // The row a page sits in follows from the pairing alone: `layout` takes
  // the pages strictly in order, one or two at a time.
  const rowOf = useCallback(
    (page: number) => (twoPage ? (page - 1) >> 1 : page - 1),
    [twoPage],
  );

  // Where the view is, as the page in it and how far into that page's row,
  // taken at every look. A zoom, a resize in fit mode or a change of view
  // re-lays the column, and this is what keeps the same place in view
  // across it: the pixel offset alone would land somewhere else.
  const anchor = useRef<{ page: number; into: number } | null>(null);

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el || rows.length === 0) return;
    // Scrolled to the bottom, and able to scroll at all: a document that fits
    // the pane is at its bottom from the start.
    const end =
      el.scrollHeight > el.clientHeight && el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    const next = inView(rows, el.scrollTop, el.clientHeight, end);
    const row = rows[rowOf(next.current)];
    anchor.current = { page: next.current, into: (el.scrollTop - row.top) / row.height };
    setRange((was) =>
      was.first === next.first && was.last === next.last && was.current === next.current
        ? was
        : next,
    );
  }, [rows, rowOf]);

  // Runs with the new rows and the anchor the old ones left.
  useLayoutEffect(() => {
    const el = scroller.current;
    const held = anchor.current;
    if (el && held) {
      const row = rows[rowOf(held.page)];
      if (row) el.scrollTop = row.top + held.into * row.height;
    }
    measure();
  }, [rows, rowOf, measure]);

  // The observer below outlives every remake of `measure`, and should call
  // whichever is current.
  const measureRef = useRef(measure);
  useLayoutEffect(() => {
    measureRef.current = measure;
  });

  // The view changes size with the window and the sidebars, not only with
  // scrolling. Read once here as well as observed: an observer's first
  // report waits for a rendering step, which a background tab does not take,
  // and the fit should not wait for the tab to be looked at. `clientWidth`
  // leaves out the scrollbar, whose gutter is always kept.
  //
  // One observer for the pane's whole life, and its reports settle for a
  // beat before landing: dragging the split divider resizes the pane on
  // every pointer move, and in fit mode each width would otherwise re-lay
  // the column and rasterise every visible page, only to be thrown away by
  // the next move. CSS stretches the pages meanwhile.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setPaneWidth(el.clientWidth);
    let settle = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(settle);
      settle = window.setTimeout(() => {
        setPaneWidth(el.clientWidth);
        measureRef.current();
      }, 150);
    });
    ro.observe(el);
    return () => {
      clearTimeout(settle);
      ro.disconnect();
    };
  }, []);

  const frame = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(measure);
  };

  /** Scroll to a page, or to a point on it given in PDF coordinates. */
  const goTo = useCallback(
    (page: number, top: number | null = null) => {
      const el = scroller.current;
      const row = rows[rowOf(page)];
      if (!el || !row || !loaded) return;
      const y =
        top === null
          ? 0
          : Math.max(
              0,
              loaded.pages[page - 1].getViewport({ scale }).convertToViewportPoint(0, top)[1],
            );
      el.scrollTop = row.top + y - GAP / 2;
    },
    [rows, rowOf, loaded, scale],
  );

  // Each block by its id, once per analysis, for the picked-block scroll.
  const blockById = useMemo(() => {
    const out = new Map<string, Block>();
    for (const page of analysis?.pages ?? []) {
      for (const block of page.blocks) out.set(block.id, block);
    }
    return out;
  }, [analysis]);

  // A block picked in the markdown pane is brought into view here, if it
  // is not already: to a third of the way down, where a jump to a heading
  // puts things. One made here stays where it was clicked.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !selection || selection.docId !== docId || selection.from === "page") return;
    const block = blockById.get(selection.focus);
    if (!block) return;
    const row = rows[rowOf(block.page)];
    if (!row) return;
    const top = row.top + block.box.y * scale;
    const bottom = top + block.box.h * scale;
    const seen = top >= el.scrollTop && bottom <= el.scrollTop + el.clientHeight;
    if (!seen) el.scrollTop = top - el.clientHeight / 3;
    // Not `rows` or `scale`: a zoom should not scroll back to the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, docId, blockById]);

  // Where each block that made it into the markdown starts, for the scroll
  // sync: from the layout, like everything else here, not the DOM -- only
  // the pages near the view carry their blocks' elements.
  const tops = useCallback(() => {
    const out = new Map<string, number>();
    for (const page of analysis?.pages ?? []) {
      for (const block of page.blocks) {
        const row = rows[rowOf(block.page)];
        if (row && placed[block.id]) out.set(block.id, row.top + block.box.y * scale);
      }
    }
    return out;
  }, [analysis, placed, rows, rowOf, scale]);
  const topsRef = useRef(tops);
  useLayoutEffect(() => {
    topsRef.current = tops;
    invalidateSync(docId);
  }, [tops, docId]);

  // Joined once the column is drawn, which is when the scroller holds it.
  useEffect(() => {
    if (!ready || !root.current || !scroller.current) return;
    return attachSync(docId, "page", {
      root: root.current,
      scroller: scroller.current,
      tops: () => topsRef.current(),
    });
  }, [ready, docId]);

  // Stable per analysis, so `PageRow`'s memo can compare it like any other
  // prop rather than needing a comparator that lists the rest.
  const blocksOf = useCallback(
    (n: number) => analysis?.pages[n - 1]?.blocks ?? NO_BLOCKS,
    [analysis],
  );

  const followOutline = useCallback(
    (node: OutlineNode) => {
      if (!loaded) return;
      resolve(loaded.doc, node.dest).then(
        (target) => target && goTo(target.page, target.top),
        (cause: unknown) => console.warn(cause),
      );
    },
    [loaded, goTo],
  );

  // The next step either way, or undefined at that end of `ZOOMS` -- which
  // is also what disables the button, so "can zoom" and "do zoom" cannot
  // drift apart. The tolerance absorbs a fit zoom sitting on a step.
  const zoomIn = zoom !== null ? ZOOMS.find((z) => z > zoom + 1e-3) : undefined;
  const zoomOut = zoom !== null ? ZOOMS.findLast((z) => z < zoom - 1e-3) : undefined;

  return (
    <div ref={root} className="flex h-full flex-col">
      <PageBar
        ready={ready}
        pages={loaded?.pages.length ?? 0}
        current={range.current}
        zoom={zoom}
        sidebar={sidebar}
        twoPage={twoPage}
        onSidebar={() => setSidebar((s) => !s)}
        onPage={goTo}
        onZoomIn={zoomIn === undefined ? undefined : () => setPicked(zoomIn)}
        onZoomOut={zoomOut === undefined ? undefined : () => setPicked(zoomOut)}
        onTwoPage={() => setTwoPage((t) => !t)}
        onProperties={() => setProperties(true)}
      />

      <div className="flex min-h-0 flex-1">
        {sidebar && loaded && (
          <PdfSidebar
            view={sidebarView}
            onView={setSidebarView}
            pages={loaded.pages}
            sizes={loaded.sizes}
            snapshots={snapshots}
            current={range.current}
            outline={loaded.outline}
            onPage={goTo}
            onOutline={followOutline}
          />
        )}

        <div
          ref={scroller}
          onScroll={onScroll}
          className="relative min-w-0 flex-1 overflow-auto bg-ground [scrollbar-gutter:stable]"
        >
          {problem ? (
            <p className="p-6 text-center text-sm text-red-300">{problem}</p>
          ) : !ready ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="h-5 w-5 text-muted" />
            </div>
          ) : (
            // Each row centered in the pane, not in the column: a landscape
            // page wider than the pane widens the column, and centering in
            // that would push every portrait page off to the right. A row
            // too wide to center starts at the left edge instead, so all of
            // its overflow is to the right, where it can be scrolled to.
            <div className="flex w-max min-w-full flex-col" style={{ padding: PAD, gap: GAP }}>
              {rows.map((row, i) => (
                <PageRow
                  key={row.pages[0].n}
                  row={row}
                  pages={loaded.pages}
                  scale={scale}
                  snapshots={snapshots}
                  active={i >= range.first && i <= range.last}
                  marginLeft={Math.max(0, (paneWidth - 2 * PAD - row.width) / 2)}
                  blocksOf={blocksOf}
                  placed={placed}
                  selected={selectedIds}
                  boxes={boxes}
                  notes={notes}
                  onPick={onPick}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {properties && loaded && (
        <PropertiesDialog properties={loaded.properties} onClose={() => setProperties(false)} />
      )}
    </div>
  );
}

/** One row of the column. Memoised: scrolling moves `range` every page or
 *  so, and only the rows whose `active` flipped should pay for it -- not
 *  every row of a thousand-page document. */
const PageRow = memo(
  function PageRow({
    row,
    pages,
    scale,
    snapshots,
    active,
    marginLeft,
    blocksOf,
    placed,
    selected,
    boxes,
    notes,
    onPick,
  }: {
    row: Row;
    pages: PDFPageProxy[];
    scale: number;
    snapshots: Snapshots;
    active: boolean;
    marginLeft: number;
    blocksOf: (page: number) => Block[];
    placed: Record<string, Placed>;
    selected: string[];
    boxes: Boxes;
    notes: boolean;
    onPick: (id: string, e: React.MouseEvent) => void;
  }) {
    return (
      <div className="flex items-start" style={{ gap: GAP, height: row.height, marginLeft }}>
        {row.pages.map((p) => (
          <div
            key={p.n}
            data-paper
            className="relative bg-white shadow-lg shadow-black/50"
            style={{ width: p.w, height: p.h }}
          >
            <PageCanvas page={pages[p.n - 1]} scale={scale} active={active} snapshots={snapshots} />
            {/* The blocks go with the canvas: only pages near the view carry
                the elements, so a long document is not a long document's
                worth of them. */}
            {active && (
              <Blocks
                blocks={blocksOf(p.n)}
                placed={placed}
                selected={selected}
                boxes={boxes}
                notes={notes}
                scale={scale}
                onPick={onPick}
              />
            )}
          </div>
        ))}
      </div>
    );
  },
);

/** Around a block, a little outside the text: the box the page's reading
 *  gives is the glyphs' own, and a border on it would touch them. */
const INSET = { x: 3, y: 2 };

/** How far a box's left edge must be from the page's, in CSS px, for its
 *  note to hang in the margin. Nearer than this -- a full-bleed picture, a
 *  line at the very edge -- and the note would fall off the page, where
 *  the pane clips it, so it sits inside the box instead. */
const NOTE_ROOM = 24;

/** One page's blocks, each a box over where it is drawn, at the page's
 *  scale, with its number -- restarting at 1 on every page -- on a note.
 *  A block is picked by clicking it; the selected ones take the selection
 *  style. The look is `.hit`, `.selection` and `.note` in index.css,
 *  shared with the markdown pane's. Pictures first, so the text over one
 *  stays on top. */
function Blocks({
  blocks,
  placed,
  selected,
  boxes,
  notes,
  scale,
  onPick,
}: {
  blocks: Block[];
  placed: Record<string, Placed>;
  selected: string[];
  boxes: Boxes;
  notes: boolean;
  scale: number;
  onPick: (id: string, e: React.MouseEvent) => void;
}) {
  const ordered = useMemo(
    () => [...blocks.filter((b) => b.kind === "image"), ...blocks.filter((b) => b.kind === "text")],
    [blocks],
  );
  return (
    <>
      {ordered.map((block) => {
        const on = selected.includes(block.id);
        const at = placed[block.id];
        const boxed = block.kind === "image" ? boxes.images : boxes.text;
        const left = block.box.x * scale - INSET.x;
        return (
          <div
            key={block.id}
            role="button"
            tabIndex={-1}
            aria-pressed={on}
            data-block={block.id}
            title={at ? `Block ${at.n}` : undefined}
            className={`hit ${boxed ? "" : "quiet"} ${on ? "selection on-paper" : ""}`}
            style={{
              left,
              top: block.box.y * scale - INSET.y,
              width: block.box.w * scale + 2 * INSET.x,
              height: block.box.h * scale + 2 * INSET.y,
            }}
            onClick={(e) => onPick(block.id, e)}
            // A shift-click extends the browser's own text selection from
            // wherever it last was -- across the bars' labels -- unless
            // the press is taken here.
            onMouseDown={(e) => e.shiftKey && e.preventDefault()}
          >
            {/* A selected block keeps its index whatever the dock says: the
                index is how the block is found in the markdown. */}
            {at && (notes || on) && (
              <span className={`note ${left < NOTE_ROOM ? "inside" : ""}`} aria-hidden>
                {at.n}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

/** The page pane's toolbar: outline on the left, page and zoom in the
 *  middle, more on the right. */
function PageBar({
  ready,
  pages,
  current,
  zoom,
  sidebar,
  twoPage,
  onSidebar,
  onPage,
  onZoomIn,
  onZoomOut,
  onTwoPage,
  onProperties,
}: {
  ready: boolean;
  pages: number;
  current: number;
  zoom: number | null;
  sidebar: boolean;
  twoPage: boolean;
  onSidebar: () => void;
  onPage: (page: number) => void;
  /** Undefined at that end of the zoom range, which disables the button. */
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onTwoPage: () => void;
  onProperties: () => void;
}) {
  // What is being typed, while something is; the current page otherwise.
  const [draft, setDraft] = useState<string | null>(null);
  const settle = () => {
    const n = Number.parseInt(draft ?? "", 10);
    if (Number.isFinite(n)) onPage(Math.min(pages, Math.max(1, n)));
    setDraft(null);
  };

  return (
    <div
      data-bar
      className="grid h-9 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-edge px-2 text-xs text-muted"
    >
      <button
        type="button"
        title={sidebar ? "Hide sidebar" : "Show sidebar"}
        aria-pressed={sidebar}
        disabled={!ready}
        onClick={onSidebar}
        className={`${iconButton} justify-self-start ${sidebar ? "text-ink" : ""}`}
      >
        <Menu className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          aria-label="Page"
          disabled={!ready}
          value={draft ?? (ready ? String(current) : "")}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
          onFocus={(e) => e.target.select()}
          onBlur={settle}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(null);
              // Blurring settles, and a null draft settles on nothing.
              requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
            }
          }}
          className="w-8 rounded bg-ground px-1 py-0.5 text-center text-ink outline-none focus:ring-1 focus:ring-edge-strong"
        />
        <span className="tabular-nums">/ {ready ? pages : "–"}</span>

        <span className="mx-1 h-4 w-px bg-edge" />

        <button
          type="button"
          title="Zoom out"
          disabled={!ready || !onZoomOut}
          onClick={onZoomOut}
          className={iconButton}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-12 rounded bg-ground px-1 py-0.5 text-center tabular-nums text-ink">
          {zoom === null ? "–" : `${Math.round(zoom * 100)}%`}
        </span>
        <button
          type="button"
          title="Zoom in"
          disabled={!ready || !onZoomIn}
          onClick={onZoomIn}
          className={iconButton}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <MoreMenu
        ready={ready}
        twoPage={twoPage}
        onTwoPage={onTwoPage}
        onProperties={onProperties}
      />
    </div>
  );
}

const menuItem =
  "flex w-full cursor-pointer items-center gap-3 px-3 py-1.5 text-left text-ink hover:bg-edge";

/** The three dots: view toggles above the line, the document below. */
function MoreMenu({
  ready,
  twoPage,
  onTwoPage,
  onProperties,
}: {
  ready: boolean;
  twoPage: boolean;
  onTwoPage: () => void;
  onProperties: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Every item acts and closes the menu.
  const pick = (act: () => void) => () => {
    act();
    setOpen(false);
  };

  // Any press outside the menu, or Escape, closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative justify-self-end">
      <button
        type="button"
        title="More"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!ready}
        onClick={() => setOpen((o) => !o)}
        className={`${iconButton} ${open ? "text-ink" : ""}`}
      >
        <EllipsisVertical className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border border-edge bg-raised py-1 text-sm shadow-xl shadow-black/40"
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={twoPage}
            onClick={pick(onTwoPage)}
            className={menuItem}
          >
            <Check className={`h-4 w-4 shrink-0 ${twoPage ? "" : "invisible"}`} />
            Two page view
          </button>

          <div className="my-1 h-px bg-edge" />

          <button
            type="button"
            role="menuitem"
            onClick={pick(onProperties)}
            className={menuItem}
          >
            <span className="w-4 shrink-0" />
            Document properties
          </button>
        </div>
      )}
    </div>
  );
}
