import { Menu, Minus, Plus } from "lucide-react";
import {
  addTransitionType,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  ViewTransition,
} from "react";
import { Spinner } from "src/components/shared/Spinner";
import { engine } from "src/lib/engine";
import { openPdf, type PDFPageProxy } from "src/lib/pdf";
import { messageOf } from "src/lib/words";
import { iconButton } from "./controls";
import { MoreMenu } from "./MoreMenu";
import { PageCanvas } from "./PageCanvas";
import { Pane } from "./Pane";

/** CSS px per PDF point at 100%: a point is 1/72 in, a CSS px 1/96. */
const PX_PER_PT = 96 / 72;
/** Around the pages, and between them, in CSS px. */
const PAD = 16;
const GAP = 16;
/** The steps the zoom buttons take, as in a browser's own PDF viewer. */
const ZOOMS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
  5,
];
const MIN_ZOOM = ZOOMS[0];
const MAX_ZOOM = ZOOMS.at(-1)!;

/** The Transition type for the sidebar being shown or hidden. Its own, not
 *  the explorer's, so only this pane's boundaries answer it. */
const SIDEBAR = "pdf-sidebar";

interface Loaded {
  pages: PDFPageProxy[];
  /** Each page's size at scale 1, in PDF points -- read once here, for the
   *  column's layout. */
  sizes: { w: number; h: number }[];
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
 *  and every page's size, all before the first page is laid out. A page's
 *  size is what places every page after it, so the column is not drawn
 *  until all of them are known. */
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
      task = openPdf(bytes);
      const doc = await task.promise;
      const pages = await Promise.all(
        Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)),
      );
      const sizes = pages.map((p) => {
        const { width, height } = p.getViewport({ scale: 1 });
        return { w: width, h: height };
      });
      if (live) setLoaded({ pages, sizes });
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
function layout(
  sizes: { w: number; h: number }[],
  scale: number,
  twoPage: boolean,
): Row[] {
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
 *  the way down the view. At the very bottom it is the last row, which may
 *  never reach that line. */
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

/** What `sizes` is before a document has loaded: one value, so nothing
 *  downstream recomputes for a fresh empty array each render. */
const NO_SIZES: { w: number; h: number }[] = [];

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
  // The bar sets these and the body draws them, so they live here.
  const [sidebar, setSidebar] = useState(false);
  const [twoPage, setTwoPage] = useState(false);
  // The zoom fits the first page to the pane's width, and keeps fitting it as
  // the pane changes size, until one is picked with the buttons. To the
  // first page rather than the widest: one landscape fold-out would
  // otherwise shrink every portrait page around it.
  const [picked, setPicked] = useState<number | null>(null);
  const [paneWidth, setPaneWidth] = useState(0);
  const [range, setRange] = useState({ first: 0, last: -1, current: 1 });
  const scroller = useRef<HTMLDivElement>(null);

  const sizes = loaded?.sizes ?? NO_SIZES;
  const fit =
    sizes.length && paneWidth
      ? Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, (paneWidth - 2 * PAD) / (sizes[0].w * PX_PER_PT)),
        )
      : null;
  const zoom = picked ?? fit;
  const ready = loaded !== null && zoom !== null;
  const scale = (zoom ?? 1) * PX_PER_PT;
  const rows = useMemo(
    () => layout(sizes, scale, twoPage),
    [sizes, scale, twoPage],
  );
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

  /** Scroll a page to the top of the view. */
  const goTo = (page: number) => {
    const el = scroller.current;
    const row = rows[rowOf(page)];
    if (el && row) el.scrollTop = row.top - GAP / 2;
  };

  // The next step either way, or undefined at that end of `ZOOMS` -- which
  // is also what disables the button, so "can zoom" and "do zoom" cannot
  // drift apart. The tolerance absorbs a fit zoom sitting on a step.
  const zoomIn = zoom !== null ? ZOOMS.find((z) => z > zoom + 1e-3) : undefined;
  const zoomOut =
    zoom !== null ? ZOOMS.findLast((z) => z < zoom - 1e-3) : undefined;

  return (
    <Pane
      left={
        <Hamburger
          sidebar={sidebar}
          onSidebar={() =>
            startTransition(() => {
              addTransitionType(SIDEBAR);
              setSidebar((s) => !s);
            })
          }
        />
      }
      center={
        <PdfNav
          ready={ready}
          pages={loaded?.pages.length ?? 0}
          current={range.current}
          zoom={zoom}
          onPage={goTo}
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
              onPick: () => setTwoPage((t) => !t),
            },
            "divider",
            // TODO: PropertiesDialog, once ported.
            { label: "Document properties", disabled: true },
          ]}
        />
      }
    >
      {/* As the editor does the explorer (routes/Editor.tsx): the sidebar
          slides in from the pane's edge, and the pages ride the edge that
          stays put while they fade to their new width. Hidden rather than
          unmounted, so it is one snapshot either side of the change. */}
      <div className="flex h-full">
        <ViewTransition
          default="none"
          update={{ [SIDEBAR]: "explorer", default: "none" }}
        >
          {/* TODO: PdfSidebar (thumbnails / outline), once ported. */}
          <div
            className={`w-40 shrink-0 border-r border-edge ${sidebar ? "" : "hidden"}`}
          />
        </ViewTransition>
        <ViewTransition
          default="none"
          update={{ [SIDEBAR]: "panes-out panes-in", default: "none" }}
        >
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
              <div
                className="flex w-max min-w-full flex-col"
                style={{ padding: PAD, gap: GAP }}
              >
                {rows.map((row, i) => (
                  <PageRow
                    key={row.pages[0].n}
                    row={row}
                    pages={loaded.pages}
                    scale={scale}
                    active={i >= range.first && i <= range.last}
                    marginLeft={Math.max(
                      0,
                      (paneWidth - 2 * PAD - row.width) / 2,
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        </ViewTransition>
      </div>
    </Pane>
  );
}

/** One row of the column. Memoised: scrolling moves `range` every page or
 *  so, and only the rows whose `active` flipped should pay for it -- not
 *  every row of a thousand-page document. */
const PageRow = memo(function PageRow({
  row,
  pages,
  scale,
  active,
  marginLeft,
}: {
  row: Row;
  pages: PDFPageProxy[];
  scale: number;
  active: boolean;
  marginLeft: number;
}) {
  return (
    <div
      className="flex items-start"
      style={{ gap: GAP, height: row.height, marginLeft }}
    >
      {row.pages.map((p) => (
        <div
          key={p.n}
          data-page={p.n}
          className="relative bg-white shadow-lg shadow-black/50"
          style={{ width: p.w, height: p.h }}
        >
          <PageCanvas page={pages[p.n - 1]} scale={scale} active={active} />
        </div>
      ))}
    </div>
  );
});
