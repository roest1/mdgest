import { PanelLeftClose, PanelLeftOpen, SquarePen } from "lucide-react";
import { startTransition, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PdfPane } from "src/components/editor/PdfPane";
import { Split } from "src/components/editor/Split";
import { TabBar } from "src/components/editor/TabBar";
import { FileTree } from "src/components/shared/FileTree";
import { Spinner } from "src/components/shared/Spinner";
import { engine } from "src/lib/engine";
import type { Entry } from "src/lib/tree";
import { messageOf } from "src/lib/words";

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-faint">
      {label}
    </div>
  );
}

type View = "rendered" | "raw";

/** How the markdown pane shows its document: typeset, or as source. The
 *  choice is the editor's, so the pane can act on it once it exists. */
function ViewToggle({ view, onView }: { view: View; onView: (view: View) => void }) {
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

  useEffect(() => {
    let live = true;
    engine.docs().then(
      (d) => live && setDocs(d),
      (cause: unknown) => live && setProblem(messageOf(cause)),
    );
    return () => {
      live = false;
    };
  }, []);

  // Memoised so the tree is rebuilt when the listing changes, not each time
  // a document is opened.
  const entries = useMemo<Entry[]>(
    () => (docs ?? []).map((path) => ({ path, kind: "pdf" })),
    [docs],
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

export default function Editor() {
  const docId = useParams()["*"] || "";
  const [sidebar, setSidebar] = useState(true);
  const navigate = useNavigate();
  // Not yet acted on: the markdown pane will read it once it exists.
  const [view, setView] = useState<View>("rendered");

  // Every document visited stays open as a tab until its tab is closed, in
  // the order first opened. Adjusted during render, like the tree's reveal,
  // so a document never draws without its tab.
  const [openDocs, setOpenDocs] = useState<string[]>(() => (docId ? [docId] : []));
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

        {/* The way back, where the GitHub link sits on the landing: far right,
            out of the way of everything the header is actually for. */}
        <Link
          to="/"
          title="mdgest"
          className="ml-auto shrink-0 rounded p-1 opacity-80 transition-opacity hover:opacity-100"
        >
          <img
            src="/mark.svg"
            alt="mdgest"
            width={20}
            height={20}
            className="rounded-[5px]"
          />
        </Link>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Hidden rather than unmounted, so closing the sidebar keeps which
            folders were open and does not read the listing again. The column
            behind the explorer carries the header's color, so what the
            curved corner cuts away reads as the header continuing down. */}
        <div className={`w-[260px] shrink-0 bg-chrome ${sidebar ? "" : "hidden"}`}>
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
            <div className="flex min-h-0 flex-1">
              <Split
                left={
                  <main className="h-full">
                    {/* Keyed, so another document starts from a fresh pane:
                        its own zoom, page and sidebar, not the last one's. */}
                    <PdfPane key={docId} docId={docId} />
                  </main>
                }
                right={
                  <section className="flex min-h-0 flex-1 flex-col">
                    {/* Three columns, as on the pages side, so the toggle
                        sits centred whatever the left label's width. */}
                    <div className="grid h-9 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-edge px-3 text-xs text-faint">
                      {/* The shape the pane's edit control will take. It
                          does nothing yet: there is no markdown to edit. */}
                      <button
                        type="button"
                        className="flex cursor-pointer items-center gap-1.5 justify-self-start
                          rounded-md border border-edge bg-raised/40 px-2 py-1 text-muted
                          transition-colors hover:bg-raised hover:text-ink"
                      >
                        <SquarePen className="h-4 w-4" />
                        edit
                      </button>
                      <ViewToggle view={view} onView={setView} />
                    </div>
                    <div className="min-h-0 flex-1">
                      <Placeholder label="markdown" />
                    </div>
                  </section>
                }
              />
            </div>
          ) : (
            <main className="min-w-0 flex-1">
              <Empty />
            </main>
          )}
        </div>
      </div>
    </div>
  );
}
