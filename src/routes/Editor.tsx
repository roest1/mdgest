import {
  addTransitionType,
  startTransition,
  useState,
  useEffect,
  useMemo,
  useRef,
  ViewTransition,
} from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  CircleCheck,
  CircleHelp,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Spinner } from "src/components/shared/Spinner";
import { FileTree } from "src/components/shared/FileTree";
import { WorkspaceName } from "src/components/shared/WorkspaceName";
import { TabBar } from "src/components/editor/TabBar";
import { Toolbar } from "src/components/editor/Toolbar";
import { Split } from "src/components/editor/Split";
import { TABS } from "src/components/editor/transitions";
import { Slide } from "src/components/shared/Slide";
import { releaseAssets } from "src/lib/assets";
import { engine } from "src/lib/engine";
import { byId, useEditor } from "src/lib/store";
import { messageOf } from "src/lib/words";
import type { Entry } from "src/lib/tree";
import { MarkdownPane } from "src/components/editor/MarkdownPane";
import { PdfPane } from "src/components/editor/PdfPane";

/** The editor's contents as the tab bar comes or goes: what was there
 *  fades out, what replaces it fades in once the frame has nearly arrived. */
const PANES = {
  enter: { [TABS]: "panes-in", default: "none" },
  exit: { [TABS]: "panes-out", default: "none" },
} as const;

/** A document's address. Ids may hold spaces and any script's letters, so
 *  each segment is encoded; the slashes between them stay, since the route
 *  is a splat. */
function editPath(docId: string): string {
  return `/edit/${docId.split("/").map(encodeURIComponent).join("/")}`;
}

/** The sidebar: the workspace's documents. Until the engine answers there
 *  is a spinner, and if it refuses, why. */
function Sidebar({
  docs,
  problem,
  docId,
  onOpen,
}: {
  docs: string[] | null;
  problem: string | null;
  docId: string;
  onOpen: (doc: string) => void;
}) {
  // Memoised so the tree is rebuilt when the listing changes, not each time
  // a document is opened.
  const entries = useMemo<Entry[]>(
    () =>
      (docs ?? []).map((path) => ({
        path,
        kind: "pdf",
      })),
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
      onSelect={onOpen}
      className="h-full"
    />
  );
}

/** What fills both panes while no document is open: one surface, not a
 *  split, since there is nothing yet to put side by side. `missing` is an
 *  id the address asked for that the workspace does not hold. */
function Empty({ missing }: { missing: string | null }) {
  if (missing) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-edge bg-raised/40 px-10 py-8 text-center">
          <h2 className="font-serif text-2xl font-semibold text-ink">
            No such document
          </h2>
          <p className="mt-3 font-serif text-sm leading-relaxed break-words text-muted">
            This workspace holds nothing at{" "}
            <span className="font-mono text-ink">{missing}</span>. It may have
            been removed or renamed since the link was made. Pick a document
            from the explorer.
          </p>
        </div>
      </div>
    );
  }
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

export default function Editor() {
  const asked = useParams()["*"] || "";
  const [sidebar, setSidebar] = useState(true);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const navigate = useNavigate();

  // The workspace's documents, read once when the editor opens: the
  // explorer lists them, and the address is checked against them.
  const [docs, setDocs] = useState<string[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
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

  // An address is typed, pasted or kept, so it can name a document that is
  // not there -- or no longer is. Nothing opens for it until the listing
  // says it is, and one it does not hold is let go of below.
  const docId = docs?.includes(asked) ? asked : "";
  const [missing, setMissing] = useState<string | null>(null);

  // What was held of every document goes when the editor does. A reading is
  // the engine's cache held on the page, read again on the next open at
  // little cost -- and kept past here, it could be shown for a document of
  // the same name in the workspace the landing makes next.
  useEffect(
    () => () => {
      for (const id of Object.keys(useEditor.getState().readings))
        releaseAssets(id);
      useEditor.setState({ readings: byId() });
    },
    [],
  );

  // An unreadable manifest leaves the name blank here: the landing is where
  // that is said, and the editor never reaches one past it.
  useEffect(() => {
    let live = true;
    engine.workspaceName().then(
      (name) => live && setWorkspace(name),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  // Every document visited stays open as a tab until its tab is closed, in
  // the order first opened. Adjusted during render, like the tree's reveal,
  // so a document never draws without its tab.
  const [openDocs, setOpenDocs] = useState<string[]>([]);
  if (docId && !openDocs.includes(docId)) {
    setOpenDocs((prev) => (prev.includes(docId) ? prev : [...prev, docId]));
  }

  // What was held of a document goes with its tab: its figures' blobs, and
  // its reading, which the next open answers from the engine's cache. Once
  // the tab has gone, not as it is closed: the panes showing the document
  // are unmounted by then, so neither shows it without its reading on the
  // way out, nor can a reading still going put one back.
  const wasOpen = useRef<string[]>([]);
  useEffect(() => {
    for (const doc of wasOpen.current) {
      if (openDocs.includes(doc)) continue;
      releaseAssets(doc);
      useEditor.getState().setReading(doc, undefined);
    }
    wasOpen.current = openDocs;
  }, [openDocs]);

  // Back to the tab last open, or to none, in place of the address: Back
  // should not return to it.
  const unknown = docs !== null && asked !== "" && !docs.includes(asked);
  useEffect(() => {
    if (!unknown) return;
    const back = openDocs.at(-1);
    navigate(back ? editPath(back) : "/edit", { replace: true });
  }, [unknown, openDocs, navigate]);
  // What was asked for is said in the empty editor until a document opens.
  // Adjusted during render, as the tabs are.
  if (unknown && missing !== asked) setMissing(asked);
  if (docId && missing !== null) setMissing(null);

  const tabs = openDocs.length > 0;

  // The tab bar coming or going is the one change that animates, and only
  // these two places can cause it. The router already makes a navigation a
  // Transition; one started here nests inside ours and inherits its type.
  const openDoc = (doc: string) => {
    startTransition(() => {
      if (!tabs) addTransitionType(TABS);
      navigate(editPath(doc));
    });
  };

  const closeTab = (doc: string) => {
    startTransition(() => {
      const rest = openDocs.filter((d) => d != doc);
      if (rest.length == 0) addTransitionType(TABS);
      setOpenDocs(rest);
      if (doc == docId) {
        const at = openDocs.indexOf(doc);
        const next = rest[Math.min(at, rest.length - 1)];
        navigate(next ? editPath(next) : "/edit", { replace: true });
      }
    });
  };

  return (
    <div className="flex h-screen flex-col">
      {/* Three columns, the outer two of equal width, so the workspace's name
          sits on the page's center line whatever is either side of it. */}
      <header className="grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 bg-chrome px-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebar((open) => !open)}
            title={sidebar ? "Hide explorer" : "Show explorer"}
            className="cursor-pointer rounded p-1 text-muted transition-colors hover:text-ink"
          >
            {sidebar ? (
              <PanelLeftClose className="h-5 w-5" />
            ) : (
              <PanelLeftOpen className="h-5 w-5" />
            )}
          </button>

          {/* The way back to the landing, as the landing draws its brand: the
              wordmark in Literata 600 at -0.028em, which mark.svg's outlines
              were set in -- see Brand. */}
          <Link
            to="/"
            title="Home"
            className="flex shrink-0 items-center gap-2 rounded opacity-90 transition-opacity hover:opacity-100"
          >
            <img
              src="/mark.svg"
              alt=""
              width={24}
              height={24}
              className="rounded-[5px]"
            />
            <span className="font-serif text-lg font-semibold tracking-[-0.028em] text-ink">
              mdgest
            </span>
          </Link>
        </div>

        {/* The workspace's name, and that what is done to it is kept as it
            is done -- here, where the name an export goes out under is. The
            status hangs off the name's right edge rather than sitting beside
            it, so the name alone is what the center column centers; narrow
            windows drop it before it can reach the help button. */}
        <div className="relative flex min-w-0 items-center text-sm">
          <WorkspaceName
            name={workspace}
            onRename={async (name) =>
              setWorkspace(await engine.renameWorkspace(name))
            }
            className="max-w-[min(40vw,24rem)] text-center"
          />
          <span
            className="absolute top-1/2 left-full ml-2 hidden -translate-y-1/2 items-center gap-1 text-xs leading-none whitespace-nowrap text-faint lg:flex"
            title="Every edit is written to this browser as it is made. Export is the copy you keep."
          >
            <CircleCheck className="h-3.5 w-3.5" aria-hidden />
            Autosaved in this browser · export to keep it
          </span>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-3">
          {/* (TODO): Tutorial */}
          <button
            type="button"
            title="Show me around"
            onClick={() => alert("Tutorial coming soon")}
            className="cursor-pointer rounded p-1 text-muted transition-colors hover:text-ink"
          >
            <CircleHelp className="h-5 w-5" />
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {/* Slides in from the window's edge, and the editor follows it every
            frame -- see Slide. Hidden rather than unmounted, so closing the
            sidebar keeps which folders were open and does not read the
            listing again. The column behind the explorer carries the
            header's color, so what the curved corner cuts away reads as the
            header continuing down. */}
        <Slide open={sidebar} width={260} className="bg-chrome">
          <aside className="h-full overflow-hidden rounded-tr-xl border-t border-r border-edge bg-ground">
            <Sidebar
              docs={docs}
              problem={problem}
              docId={docId}
              onOpen={openDoc}
            />
          </aside>
        </Slide>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {tabs && (
            <ViewTransition
              enter={{ [TABS]: "tabs-in", default: "none" }}
              exit={{ [TABS]: "tabs-out", default: "none" }}
            >
              <TabBar
                docs={openDocs}
                active={docId || undefined}
                onSelect={(doc) => navigate(editPath(doc))}
                onClose={closeTab}
              />
            </ViewTransition>
          )}

          {docId && <Toolbar key={docId} docId={docId} />}

          {/* One frame whether or not a document is open, so there is one
              thing to move when the tab bar pushes it down. Its curved
              corner belongs to the empty editor only: under a tab bar that
              corner is the markdown pane header's. The column behind it
              carries the header's color, as the explorer's does. */}
          <ViewTransition update={{ [TABS]: "surface", default: "none" }}>
            <div
              className={`flex min-h-0 min-w-0 flex-1 bg-chrome ${!tabs && sidebar ? "-ml-px" : ""}`}
            >
              <main
                className={`relative flex min-h-0 min-w-0 flex-1 bg-black ${
                  tabs ? "" : "rounded-tl-xl border-t border-l border-edge"
                }`}
              >
                {/* What the frame holds fades rather than moving with it:
                    the empty card and the split are different layouts, and
                    the frame's snapshot crossfading between them reads as
                    both at once. Keyed, or React sees one boundary updating
                    rather than one leaving and another arriving. */}
                {/* Blank while the listing is out, so an address it will
                    turn down never draws a document first. */}
                {asked && docs === null && !problem ? null : docId ? (
                  <ViewTransition key="split" {...PANES}>
                    <Split
                      left={
                        <div className="h-full">
                          <PdfPane key={docId} docId={docId} />
                        </div>
                      }
                      right={
                        <section className="min-h-0 flex-1">
                          <MarkdownPane key={docId} docId={docId} />
                        </section>
                      }
                    />
                    {/* TODO: FloatingToolbar:
                     <FloatingToolbar docId={docId} /> */}
                  </ViewTransition>
                ) : (
                  <ViewTransition key="empty" {...PANES}>
                    <div className="min-w-0 flex-1">
                      <Empty missing={missing} />
                    </div>
                  </ViewTransition>
                )}
              </main>
            </div>
          </ViewTransition>
        </div>
      </div>
    </div>
  );
}
