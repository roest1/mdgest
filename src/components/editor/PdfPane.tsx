import { Menu, Minus, Plus } from "lucide-react";
import {
  addTransitionType,
  startTransition,
  useState,
  ViewTransition,
} from "react";
import { iconButton } from "./controls";
import { MoreMenu } from "./MoreMenu";
import { Pane } from "./Pane";

/** The steps the zoom buttons take, as in a browser's own PDF viewer. */
const ZOOMS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
  5,
];

/** The Transition type for the sidebar being shown or hidden. Its own, not
 *  the explorer's, so only this pane's boundaries answer it. */
const SIDEBAR = "pdf-sidebar";

// TODO: from openPdf once pdf.ts is ported. Placeholder so the controls
// have something to act on.
const PAGES = 5;

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
 *  percentage. */
function PdfNav({
  pages,
  current,
  zoom,
  onPage,
  onZoomIn,
  onZoomOut,
}: {
  pages: number;
  current: number;
  zoom: number;
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
        value={draft ?? String(current)}
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
      <span className="tabular-nums">/ {pages}</span>

      <span className="mx-1 h-4 w-px bg-edge" />

      <button
        type="button"
        title="Zoom out"
        disabled={!onZoomOut}
        onClick={onZoomOut}
        className={iconButton}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="w-12 rounded bg-ground px-1 py-0.5 text-center tabular-nums text-ink">
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        title="Zoom in"
        disabled={!onZoomIn}
        onClick={onZoomIn}
        className={iconButton}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </>
  );
}

export function PdfPane({ docId: _docId }: { docId: string }) {
  // The bar sets these and the body draws them, so they live here.
  const [sidebar, setSidebar] = useState(false);
  const [current, setCurrent] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [twoPage, setTwoPage] = useState(false);

  const zoomIn = ZOOMS.find((z) => z > zoom + 1e-3);
  const zoomOut = ZOOMS.findLast((z) => z < zoom - 1e-3);

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
          pages={PAGES}
          current={current}
          zoom={zoom}
          // TODO: scroll the page into view, once the pages are drawn.
          onPage={setCurrent}
          onZoomIn={zoomIn === undefined ? undefined : () => setZoom(zoomIn)}
          onZoomOut={zoomOut === undefined ? undefined : () => setZoom(zoomOut)}
        />
      }
      right={
        <MoreMenu
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
          <div className="min-w-0 flex-1 overflow-auto" />
        </ViewTransition>
      </div>
    </Pane>
  );
}
