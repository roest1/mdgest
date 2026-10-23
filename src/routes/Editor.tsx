import { useState, useRef } from "react";
import { Link } from "react-router";
import {
  CircleHelp,
  PanelLeftClose,
  PanelLeftOpen,
  Download,
} from "lucide-react";

/** The workspace's name, in the middle of the header, and the place to
 *  change it: a click makes it a field, Enter or clicking away keeps what
 *  was typed, Escape gives it up. A workspace made of loose PDFs has no name
 *  until someone gives it one, and says so. */
function WorkspaceName({
  name,
  onRename,
}: {
  name: string | null;
  onRename: (name: string) => Promise<void>;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Escape blurs the field too, and the blur is where a name is kept; this
  // is how the blur tells the two apart.
  const dropped = useRef(false);

  const finish = () => {
    const next = typed?.trim();
    setTyped(null);
    if (dropped.current || !next || next === name) return;
    onRename(next).catch((cause: unknown) => setProblem(messageOf(cause)));
  };

  if (typed !== null) {
    return (
      <input
        autoFocus
        value={typed}
        aria-label="Workspace name"
        onChange={(e) => setTyped(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== "Escape") return;
          dropped.current = e.key === "Escape";
          e.currentTarget.blur();
        }}
        className="w-[min(40vw,24rem)] rounded border border-edge bg-ground px-2 py-0.5 text-center text-sm text-ink outline-none focus:border-muted"
      />
    );
  }
  return (
    <button
      type="button"
      title={problem ?? "Rename workspace"}
      onClick={() => {
        dropped.current = false;
        setProblem(null);
        setTyped(name ?? "");
      }}
      className={`max-w-[min(40vw,24rem)] cursor-text truncate rounded px-2 py-0.5 text-sm transition-colors hover:bg-edge/60 ${
        problem
          ? "text-red-300"
          : name
            ? "text-muted hover:text-ink"
            : "text-faint italic"
      }`}
    >
      {problem ?? name ?? "untitled workspace"}
    </button>
  );
}

export default function Editor() {
  const [sidebar, setSidebar] = useState(true);
  const [workspace, setWorkspace] = useState<string | null>(null);

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

        <WorkspaceName
          name={workspace}
          onRename={async (name) =>
            setWorkspace(await engine.renameWorkspace(name))
          }
        />

        <div className="flex min-w-0 items-center justify-end gap-3">
          {/* (TODO): ExportMenu.tsx */}
          <div className="relative ml-auto flex items-center gap-2">
            <button
              type="button"
              title="Export: the one save that survives clearing this browser"
              aria-haspopup="menu"
              data-tour="export"
              onClick={() => alert("Export coming soon")}
              className={
                "flex cursor-pointer items-center gap-1.5 rounded-md border border-edge bg-raised/40 px-2 py-1 text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:cursor-default bg-raised text-ink"
              }
            >
              <Download className="h-5 w-5" />
              export
            </button>
          </div>
          {/* (TODO): Tutorial */}
          <button
            type="button"
            title="Show me around"
            data-tour="help"
            onClick={() => alert("Tutorial coming soon")}
            className="cursor-pointer rounded p-1 text-muted transition-colors hover:text-ink"
          >
            <CircleHelp className="h-5 w-5" />
          </button>
        </div>
      </header>
    </div>
  );
}
