import { Menu, Minus, Plus } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { Spinner } from "src/components/shared/Spinner";
import { ensureRead, readDone } from "src/lib/convert";
import { engine } from "src/lib/engine";
import { useEditor } from "src/lib/store";
import { attachSync, invalidateSync } from "src/lib/scrollsync";
import {
  openPdf,
  readOutline,
  readProperties,
  resolve,
  targetTop,
  type OutlineNode,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type Properties,
  type Target,
} from "src/lib/pdf";
import { human, messageOf } from "src/lib/words";
import { sourcePath } from "src/lib/workspace";
import { iconButton } from "./controls";
import { GAP, inView, layout, PAD, type Row } from "./column";
import { MoreMenu } from "./MoreMenu";
import { PageCanvas } from "./PageCanvas";
import { Pane } from "./Pane";
import {
  PdfSidebar,
  SidebarFrame,
  THUMB_WIDTH,
  type SidebarView,
} from "./PdfSidebar";
import { PropertiesDialog, type PropertyGroups } from "./PropertiesDialog";
import { Snapshots } from "./snapshots";

/** CSS px per PDF point at 100%: a point is 1/72 in, a CSS px 1/96. */
const PX_PER_PT = 96 / 72;
/** The steps the zoom buttons take, as in a browser's own PDF viewer. */
const ZOOMS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
  5,
];
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
function useDocument(docId: string): {
  loaded: Loaded | null;
  problem: string | null;
} {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let task: ReturnType<typeof openPdf> | null = null;
    (async () => {
      const bytes = await engine.source(docId);
      if (!live) return;
      // Taken before `openPdf`, which hands the buffer to pdf.js and leaves
      // this view of it empty.
      const size = bytes.byteLength;
      task = openPdf(bytes);
      const doc = await task.promise;
      // The pages and the outline depend on nothing but the document, so
      // their round trips to pdf.js's worker overlap.
      const [pages, outline] = await Promise.all([
        Promise.all(
          Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)),
        ),
        readOutline(doc),
      ]);
      const properties = await readProperties(
        doc,
        sourcePath(docId).at(-1)!,
        size,
        pages[0],
      );
      const sizes = pages.map((p) => {
        const { width, height } = p.getViewport({ scale: 1 });
        return { w: width, h: height };
      });
      if (live) setLoaded({ doc, pages, sizes, outline, properties });
    })().catch((cause: unknown) => live && setProblem(whyNot(cause)));

    return () => {
      live = false;
      // Ends pdf.js's side of the document, whatever stage it reached; the
      // worker itself stays for the next one. Not under a reading still on
      // these pages: that goes on past this pane, for the next one to show,
      // and lets go of the pages once it has read them.
      const opened = task;
      void readDone(docId).then(() => opened?.destroy());
    };
  }, [docId]);

  return { loaded, problem };
}

/** The zoom that fits the first row -- the first page, or the first two side
 *  by side -- to a pane `width` CSS px wide, or null with nothing to fit. To
 *  the first row rather than the widest: one landscape fold-out would
 *  otherwise shrink every portrait page around it. */
function fitZoom(
  sizes: { w: number; h: number }[],
  twoPage: boolean,
  width: number,
): number | null {
  const first = sizes.slice(0, twoPage ? 2 : 1);
  if (first.length === 0 || width === 0) return null;
  const room = width - 2 * PAD - GAP * (first.length - 1);
  const points = first.reduce((sum, s) => sum + s.w, 0);
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, room / (points * PX_PER_PT)));
}

/** How long the pane's width holds still before the pages are drawn again
 *  at it, in ms. */
const SETTLE = 150;

/** What `sizes` is before a document has loaded: one value, so nothing
 *  downstream recomputes for a fresh empty array each render. */
const NO_SIZES: { w: number; h: number }[] = [];

const when = (d: Date | null) =>
  d
    ? d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" })
    : null;

/** Points to inches, which is what a page size is read in where the
 *  documents this is for are printed. */
function pageSize({ width, height }: Properties["pageSize"]): string {
  const inches = (pt: number) => (pt / 72).toFixed(2);
  const shape = width > height ? "landscape" : "portrait";
  return `${inches(width)} × ${inches(height)} in (${shape})`;
}

/** The document's own description of itself, as pdf.js reads it. Every value
 *  but the file name, size and page count is whatever the file claims, and is
 *  rendered as text. */
function pdfProperties(p: Properties): PropertyGroups {
  return [
    [
      ["File name", p.fileName],
      ["File size", human(p.bytes)],
    ],
    [
      ["Title", p.title],
      ["Author", p.author],
      ["Subject", p.subject],
      ["Keywords", p.keywords],
      ["Created", when(p.created)],
      ["Modified", when(p.modified)],
      ["Application", p.application],
    ],
    [
      ["PDF producer", p.producer],
      ["PDF version", p.version],
      ["Page count", String(p.pages)],
      ["Page size", pageSize(p.pageSize)],
    ],
    [["Fast web view", p.fastWebView ? "Yes" : "No"]],
  ];
}

function Hamburger({
  sidebar,
  onSidebar,
}: {
  sidebar: boolean;
  onSidebar: () => void;
}) {
  return (
    <button
      type="button"
      title={sidebar ? "Hide sidebar" : "Show sidebar"}
      aria-pressed={sidebar}
      onClick={onSidebar}
      className={`${iconButton} ${sidebar ? "text-ink" : ""}`}
    >
      <Menu className="h-4 w-4" />
    </button>
  );
}

/** The page being read, out of how many, and the zoom either side of its
 *  percentage. Dashes and disabled until the document is laid out. */
function PdfNav({
  ready,
  pages,
  current,
  zoom,
  onPage,
  onZoomIn,
  onZoomOut,
}: {
  ready: boolean;
  pages: number;
  current: number;
  zoom: number | null;
  onPage: (page: number) => void;
  /** Undefined at that end of the zoom range, which disables the button. */
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}) {
  // What is being typed, while something is; the current page otherwise.
  const [draft, setDraft] = useState<string | null>(null);
  const settle = () => {
    const n = Number.parseInt(draft ?? "", 10);
    if (Number.isFinite(n)) onPage(Math.min(pages, Math.max(1, n)));
    setDraft(null);
  };

  return (
    <>
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
            const input = e.currentTarget;
            requestAnimationFrame(() => input.blur());
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
    </>
  );
}

export function PdfPane({ docId }: { docId: string }) {
  const { loaded, problem } = useDocument(docId);
  // The document is read here, where its pages are open, and the markdown
  // pane shows the reading from the store. A reading outlives this pane --
  // the tab switched away from mid-read -- and the next pane finds it.
  useEffect(() => {
    if (loaded) ensureRead(docId, loaded.pages);
  }, [docId, loaded]);
  // A document that does not open is not read either, and the markdown
  // pane says so rather than waiting on a reading that never starts.
  useEffect(() => {
    if (problem)
      useEditor.getState().setReading(docId, {
        status: "failed",
        problem: "Not read: " + problem,
      });
  }, [docId, problem]);
  // The bar sets these and the body draws them, so they live here.
  const [sidebar, setSidebar] = useState(false);
  const [sidebarView, setSidebarView] = useState<SidebarView>("thumbnails");
  const [twoPage, setTwoPage] = useState(false);
  const [properties, setProperties] = useState(false);
  // One per document -- the pane is keyed by it -- fed by every finished
  // render and read by the thumbnails.
  const [snapshots] = useState(() => new Snapshots(THUMB_WIDTH));
  // The zoom fits the first row to the pane's width, and keeps fitting it
  // as the pane changes size, until one is picked with the buttons.
  const [picked, setPicked] = useState<number | null>(null);
  // The pane's width as it is, and as it was when it last held still. The
  // first places the pages, every frame of a drag; the second is what they
  // are drawn at, once the drag is over -- see the observer below.
  const [paneWidth, setPaneWidth] = useState(0);
  const [settledWidth, setSettledWidth] = useState(0);
  const [range, setRange] = useState({ first: 0, last: -1, current: 1 });
  const scroller = useRef<HTMLDivElement>(null);

  const sizes = loaded?.sizes ?? NO_SIZES;
  const zoom = picked ?? fitZoom(sizes, twoPage, paneWidth);
  const ready = loaded !== null && zoom !== null;
  // Where the pages are laid out, and what they are drawn at. The same but
  // while the pane is being resized with the zoom on fit: then the boxes
  // follow the pane and the last drawing stretches to fill them.
  const scale = (zoom ?? 1) * PX_PER_PT;
  const drawScale =
    (picked ?? fitZoom(sizes, twoPage, settledWidth) ?? 1) * PX_PER_PT;
  const rows = useMemo(
    () => layout(sizes, scale, twoPage),
    [sizes, scale, twoPage],
  );
  // The column's extent: as tall as every row, and as wide as the pane or
  // the widest row, whichever is wider.
  const column = useMemo(() => {
    const last = rows.at(-1);
    const widest = rows.reduce((w, row) => Math.max(w, row.width), 0);
    return {
      width: Math.max(paneWidth, widest + 2 * PAD),
      height: last ? last.top + last.height + PAD : 0,
    };
  }, [rows, paneWidth]);
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
      el.scrollHeight > el.clientHeight &&
      el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    const next = inView(rows, el.scrollTop, el.clientHeight, end);
    const row = rows[rowOf(next.current)];
    anchor.current = {
      page: next.current,
      into: (el.scrollTop - row.top) / row.height,
    };
    setRange((was) =>
      was.first === next.first &&
      was.last === next.last &&
      was.current === next.current
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

  // The view changes size with the window, the split and both sidebars,
  // not only with scrolling. Read once here as well as observed: an
  // observer's first report waits for a rendering step, which a background
  // tab does not take, and the fit should not wait for the tab to be looked
  // at. `clientWidth` leaves out the scrollbar, whose gutter is always kept.
  //
  // One observer for the pane's whole life. Each report re-lays the column
  // before the frame is painted, so the pages follow a dragged divider or a
  // sliding sidebar exactly; that is arithmetic and box sizes, no drawing.
  // Drawing waits for the width to hold still: in fit mode every width is a
  // new zoom, and rasterising every visible page for each would be thrown
  // away by the next.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setPaneWidth(el.clientWidth);
    setSettledWidth(el.clientWidth);
    let settle = 0;
    const ro = new ResizeObserver(() => {
      const width = el.clientWidth;
      // Synchronously, so this frame paints the new layout rather than the
      // old one squeezed into the new width.
      flushSync(() => setPaneWidth(width));
      measureRef.current();
      clearTimeout(settle);
      settle = window.setTimeout(() => setSettledWidth(width), SETTLE);
    });
    ro.observe(el);
    return () => {
      clearTimeout(settle);
      ro.disconnect();
    };
  }, []);

  // Where each block starts in the column, for the scroll sync: worked out
  // from the layout rather than measured, since only the rows near the view
  // are in the document. Only blocks the markdown wrote, since only those
  // have somewhere to be on the other side.
  const reading = useEditor((s) => s.readings[docId]);
  const tops = useCallback(() => {
    const out = new Map<string, number>();
    if (reading?.status !== "ready") return out;
    const { analysis, markdown } = reading;
    for (const page of analysis.pages) {
      const row = rows[rowOf(page.n)];
      if (!row) continue;
      for (const block of page.blocks) {
        if (markdown.blocks[block.id])
          out.set(block.id, row.top + block.box.y * scale);
      }
    }
    return out;
  }, [reading, rows, rowOf, scale]);
  const topsRef = useRef(tops);
  useLayoutEffect(() => {
    topsRef.current = tops;
    invalidateSync(docId);
  }, [tops, docId]);

  // Joined once the column is drawn, which is when the scroller holds it.
  useEffect(() => {
    if (!ready || !scroller.current) return;
    return attachSync(docId, "page", {
      scroller: scroller.current,
      tops: () => topsRef.current(),
    });
  }, [ready, docId]);

  const frame = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(measure);
  };

  /** Scroll to a page, or to where a target points on it. */
  const goTo = useCallback(
    (page: number, target: Target | null = null) => {
      const el = scroller.current;
      const row = rows[rowOf(page)];
      if (!el || !row || !loaded) return;
      const y = target ? targetTop(loaded.pages[page - 1], scale, target) : 0;
      el.scrollTop = row.top + y - GAP / 2;
    },
    [rows, rowOf, loaded, scale],
  );
  // What the thumbnails are handed: one function for the pane's life, so a
  // zoom or a scroll does not re-render every thumbnail in a long strip.
  const goToRef = useRef(goTo);
  useLayoutEffect(() => {
    goToRef.current = goTo;
  });
  const goToPage = useCallback((page: number) => goToRef.current(page), []);

  const followOutline = useCallback(
    (node: OutlineNode) => {
      if (!loaded) return;
      resolve(loaded.doc, node.dest).then(
        (target) => target && goToRef.current(target.page, target),
        (cause: unknown) => console.warn(cause),
      );
    },
    [loaded],
  );

  // The next step either way, or undefined at that end of `ZOOMS` -- which
  // is also what disables the button, so "can zoom" and "do zoom" cannot
  // drift apart. The tolerance absorbs a fit zoom sitting on a step.
  const zoomIn = zoom !== null ? ZOOMS.find((z) => z > zoom + 1e-3) : undefined;
  const zoomOut =
    zoom !== null ? ZOOMS.findLast((z) => z < zoom - 1e-3) : undefined;

  return (
    <Pane
      left={
        <Hamburger sidebar={sidebar} onSidebar={() => setSidebar((s) => !s)} />
      }
      center={
        <PdfNav
          ready={ready}
          pages={loaded?.pages.length ?? 0}
          current={range.current}
          zoom={zoom}
          onPage={goToPage}
          onZoomIn={zoomIn === undefined ? undefined : () => setPicked(zoomIn)}
          onZoomOut={
            zoomOut === undefined ? undefined : () => setPicked(zoomOut)
          }
        />
      }
      right={
        <MoreMenu
          disabled={!ready}
          items={[
            {
              label: "Two page view",
              checked: twoPage,
              // Back to fitting, so the pages land side by side in the
              // pane -- or one alone across it -- whatever zoom was picked.
              onPick: () => {
                setTwoPage((t) => !t);
                setPicked(null);
              },
            },
            "divider",
            {
              label: "Document properties",
              onPick: () => setProperties(true),
            },
          ]}
        />
      }
    >
      {/* The sidebar slides in from the pane's edge and the pages follow
          it, re-laid every frame -- see SidebarFrame. */}
      <div className="flex h-full">
        <SidebarFrame open={sidebar}>
          {(state) =>
            loaded && (
              <PdfSidebar
                state={state}
                view={sidebarView}
                onView={setSidebarView}
                pages={loaded.pages}
                sizes={loaded.sizes}
                snapshots={snapshots}
                current={range.current}
                outline={loaded.outline}
                onPage={goToPage}
                onOutline={followOutline}
              />
            )
          }
        </SidebarFrame>
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
            // The whole column's size, and in it only the rows near the
            // view, each where `layout` puts it: a re-lay -- every frame of
            // a drag -- touches a handful of rows however long the
            // document is, and a row that leaves takes its canvas with it.
            //
            // Each row centered in the pane, not in the column: a landscape
            // page wider than the pane widens the column, and centering in
            // that would push every portrait page off to the right. A row
            // too wide to center starts at the left edge instead, so all of
            // its overflow is to the right, where it can be scrolled to.
            <div
              className="relative"
              style={{ width: column.width, height: column.height }}
            >
              {rows.slice(range.first, range.last + 1).map((row) => (
                <PageRow
                  key={row.pages[0].n}
                  row={row}
                  pages={loaded.pages}
                  drawScale={drawScale}
                  snapshots={snapshots}
                  left={
                    PAD + Math.max(0, (paneWidth - 2 * PAD - row.width) / 2)
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {properties && loaded && (
        <PropertiesDialog
          groups={pdfProperties(loaded.properties)}
          onClose={() => setProperties(false)}
        />
      )}
    </Pane>
  );
}

/** One row of the column, placed where `layout` put it. Memoised: a
 *  scroll that brings a row in should not re-render the rows already there.
 *  The row's boxes come from `row`; `drawScale` is what the pages are drawn
 *  at, which lags the boxes while the pane is resized. */
const PageRow = memo(function PageRow({
  row,
  pages,
  drawScale,
  snapshots,
  left,
}: {
  row: Row;
  pages: PDFPageProxy[];
  drawScale: number;
  snapshots: Snapshots;
  left: number;
}) {
  return (
    <div
      className="absolute flex items-start"
      style={{ gap: GAP, top: row.top, left, height: row.height }}
    >
      {row.pages.map((p) => (
        <div
          key={p.n}
          data-paper={p.n}
          className="relative bg-white shadow-lg shadow-black/50"
          style={{ width: p.w, height: p.h }}
        >
          <PageCanvas
            page={pages[p.n - 1]}
            scale={drawScale}
            active
            snapshots={snapshots}
          />
        </div>
      ))}
    </div>
  );
});
