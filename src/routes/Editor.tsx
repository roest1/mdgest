import { CircleHelp, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { FloatingToolbar } from "src/components/editor/FloatingToolbar";
import { ExportMenu } from "src/components/editor/ExportMenu";
import { MarkdownPane } from "src/components/editor/MarkdownPane";
import { PdfPane } from "src/components/editor/PdfPane";
import { Split } from "src/components/editor/Split";
import { TabBar } from "src/components/editor/TabBar";
import { Toolbar } from "src/components/editor/Toolbar";
import { Tour } from "src/components/editor/Tour";
import { FileTree } from "src/components/shared/FileTree";
import { Spinner } from "src/components/shared/Spinner";
import { releaseAssets } from "src/lib/assets";
import { redoEdit, undoEdit } from "src/lib/editing";
import { engine } from "src/lib/engine";
// For its listener alone: it is what keeps every glint on one clock.
import "src/lib/glint";
import { useEditor } from "src/lib/store";
import { TOUR_DOC } from "src/lib/tour-doc";
import type { Entry } from "src/lib/tree";
import { messageOf } from "src/lib/words";

/** What fills both panes while no document is open: one surface, not a
 *  split, since there is nothing yet to put side by side. */
function Empty() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-edge bg-raised/40 px-10 py-8 text-center">
        <h2 className="font-serif text-2xl font-semibold text-ink">
          Open a PDF to begin converting
        </h2>
        <p className="mt-3 font-serif text-sm leading-relaxed text-muted">
          Pick a document from the explorer. Its pages open on the left, the
          markdown on the right.
        </p>
      </div>
    </div>
  );
}

/** A document's address. Ids may hold spaces and any script's letters, so
 *  each segment is encoded; the slashes between them stay, since the route
 *  is a splat. */
function editPath(docId: string): string {
  return `/edit/${docId.split("/").map(encodeURIComponent).join("/")}`;
}

/** The sidebar: the workspace's documents, read once when the editor opens.
 *  Until the engine answers there is a spinner, and if it refuses, why. */
function Explorer({ docId }: { docId: string }) {
  const [docs, setDocs] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const navigate = useNavigate();

  const done = useEditor((s) => s.done);
  useEffect(() => {
    let live = true;
    engine.docs().then(
      (d) => live && setDocs(d),
      (cause: unknown) => live && setProblem(messageOf(cause)),
    );
    // The checks come after the listing, and a listing without them is
    // still a listing: a failure here leaves the rows unchecked.
    engine.doneDocs().then(
      (ids) => {
        if (!live || ids.length === 0) return;
        // One update for the lot, not a re-render per checked document.
        useEditor.setState((s) => ({
          done: { ...s.done, ...Object.fromEntries(ids.map((id) => [id, true])) },
        }));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  // The walkthrough's example is listed while the walkthrough runs, and
  // only then: it is not in the workspace, and should not look as if it is.
  const touring = useEditor((s) => s.tour !== null);

  // Memoised so the tree is rebuilt when the listing changes, not each time
  // a document is opened.
  const entries = useMemo<Entry[]>(
    () =>
      [...(docs ?? []), ...(touring ? [TOUR_DOC] : [])].map((path) => ({
        path,
        kind: "pdf",
        done: done[path],
      })),
    [docs, touring, done],
  );

  if (problem) return <p className="p-3 text-xs text-red-300">{problem}</p>;
  if (docs === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-4 w-4 text-muted" />
      </div>
    );
  }
  if (docs.length === 0) {
    return (
      <p className="p-3 text-xs text-faint">
        No documents yet.{" "}
        <Link to="/" className="text-muted hover:text-ink hover:underline">
          Add some
        </Link>
      </p>
    );
  }
  return (
    <FileTree
      entries={entries}
      activePath={docId}
      onSelect={(path) => navigate(editPath(path))}
      className="h-full"
    />
  );
}

/** Escape clears the selection, from anywhere but a field -- the page
 *  number's input uses Escape to give up what was typed, and only that. */
function useEscapeDeselects() {
  const deselect = useEditor((s) => s.deselect);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      deselect();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [deselect]);
}

/** Ctrl+Z undoes the open document's last edit, and Ctrl+Shift+Z or Ctrl+Y
 *  does it again -- from anywhere but a field, which keeps its own. */
function useUndoKeys(docId: string) {
  useEffect(() => {
    if (!docId) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) undoEdit(docId);
      else if ((key === "z" && e.shiftKey) || key === "y") redoEdit(docId);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [docId]);
}

export default function Editor() {
  const docId = useParams()["*"] || "";
  const [sidebar, setSidebar] = useState(true);
  const navigate = useNavigate();
  useEscapeDeselects();
  useUndoKeys(docId);

  // Every document visited stays open as a tab until its tab is closed, in
  // the order first opened. Adjusted during render, like the tree's reveal,
  // so a document never draws without its tab.
  const [openDocs, setOpenDocs] = useState<string[]>(() =>
    docId ? [docId] : [],
  );
  if (docId && !openDocs.includes(docId)) {
    setOpenDocs((prev) => (prev.includes(docId) ? prev : [...prev, docId]));
  }

  // Closing the active tab moves to the tab that took its place -- the one
  // after it, or the last one when it was last itself. There is no conversion
  // yet, so nothing can be unsaved and no tab asks before it goes. The
  // removal shares the navigation's transition: the router navigates in one,
  // and a removal that landed first would still be on the closed document's
  // route, where the block above would only put the tab back.
  const closeTab = (doc: string) => {
    releaseAssets(doc);
    startTransition(() => {
      const rest = openDocs.filter((d) => d !== doc);
      setOpenDocs(rest);
      if (doc === docId) {
        const at = openDocs.indexOf(doc);
        const next = rest[Math.min(at, rest.length - 1)];
        navigate(next ? editPath(next) : "/edit", { replace: true });
      }
    });
  };

  // The walkthrough runs on its own example document, in a tab of its own,
  // so it disturbs nothing of the person's. Starting it opens that tab and
  // remembers where they were; its end closes the tab and goes back.
  const tour = useEditor((s) => s.tour);
  const setTour = useEditor((s) => s.setTour);
  const returnTo = useRef<string | null>(null);
  const touring = useRef(false);
  const startTour = () => {
    if (docId !== TOUR_DOC) {
      returnTo.current = docId || null;
      navigate(editPath(TOUR_DOC));
    }
    setTour(0);
  };
  useEffect(() => {
    if (tour !== null) {
      touring.current = true;
      return;
    }
    if (!touring.current) return;
    touring.current = false;
    // The example is the person's document in nothing but looks: its
    // reading and its figures go with the tour, as convert.ts promises,
    // and the next run reads it afresh.
    releaseAssets(TOUR_DOC);
    useEditor.getState().setReading(TOUR_DOC, undefined);
    startTransition(() => {
      setOpenDocs((prev) => prev.filter((d) => d !== TOUR_DOC));
      const back = returnTo.current;
      returnTo.current = null;
      // A tour that ended on the example -- Escape, or its last step --
      // goes back to where the person was. One ended by their opening
      // another document stays on the document they went to.
      if (docId === TOUR_DOC) navigate(back ? editPath(back) : "/edit", { replace: true });
    });
    // Only on the tour's own transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour]);

  // The tour lives on its example alone: opening another document while it
  // runs is leaving it, not a step of it. Guarded by having arrived, since
  // starting the tour navigates and the route may land a render later.
  const onExample = useRef(false);
  useEffect(() => {
    if (tour === null) {
      onExample.current = false;
      return;
    }
    if (docId === TOUR_DOC) onExample.current = true;
    else if (onExample.current) setTour(null);
  }, [tour, docId, setTour]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 bg-chrome px-3">
        <button
          type="button"
          onClick={() => setSidebar((open) => !open)}
          title={sidebar ? "Hide explorer" : "Show explorer"}
          className="cursor-pointer rounded p-1 text-muted transition-colors hover:text-ink"
        >
          {sidebar ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeftOpen className="h-4 w-4" />
          )}
        </button>

        <span className="min-w-0 truncate font-mono text-xs text-muted">
          {docId || "no document selected"}
        </span>

        <ExportMenu />

        {/* The walkthrough, replayable: it shows itself once, the first time
            a document is open to be clicked on, and lives here after. */}
        <button
          type="button"
          title="Show me around"
          data-tour="help"
          onClick={startTour}
          className="cursor-pointer rounded p-1 text-muted transition-colors hover:text-ink"
        >
          <CircleHelp className="h-4 w-4" />
        </button>

        {/* The way back, where the GitHub link sits on the landing: far right,
            out of the way of everything the header is actually for. */}
        <Link
          to="/"
          title="mdgest"
          className="shrink-0 rounded p-1 opacity-80 transition-opacity hover:opacity-100"
        >
          <img
            src="/mark.svg"
            alt="mdgest"
            width={30}
            height={30}
            className="rounded-[5px]"
          />
        </Link>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Hidden rather than unmounted, so closing the sidebar keeps which
            folders were open and does not read the listing again. The column
            behind the explorer carries the header's color, so what the
            curved corner cuts away reads as the header continuing down. */}
        <div
          className={`w-[260px] shrink-0 bg-chrome ${sidebar ? "" : "hidden"}`}
        >
          <aside className="h-full overflow-hidden rounded-tr-xl border-t border-r border-edge bg-ground">
            <Explorer docId={docId} />
          </aside>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TabBar
            docs={openDocs}
            active={docId || undefined}
            onSelect={(doc) => navigate(editPath(doc))}
            onClose={closeTab}
          />
          {docId ? (
            <div className="relative flex min-h-0 flex-1">
              <Split
                left={
                  <main className="h-full">
                    {/* Keyed, so another document starts from a fresh pane:
                        its own zoom, page and sidebar, not the last one's. */}
                    <PdfPane key={docId} docId={docId} />
                  </main>
                }
                right={
                  <section className="min-h-0 flex-1">
                    {/* Keyed like the pages: a fresh read of the next
                        document's markdown, not the last one's. */}
                    <MarkdownPane key={docId} docId={docId} />
                  </section>
                }
              />
              <FloatingToolbar docId={docId} />
            </div>
          ) : (
            <main className="min-w-0 flex-1">
              <Empty />
            </main>
          )}
          {docId && <Toolbar docId={docId} />}
        </div>
      </div>
      <Tour />
    </div>
  );
}

