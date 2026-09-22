import { ArrowLeft, FileText, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-faint">
      {label}
    </div>
  );
}

export default function Editor() {
  const docId = useParams()["*"] || "";
  const [sidebar, setSidebar] = useState(true);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-edge bg-chrome px-3">
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

        <Link to="/" className="flex items-center gap-2 text-muted transition-colors hover:text-ink">
          <ArrowLeft className="h-4 w-4" />
          <img src="/mark-small.svg" alt="" width={20} height={20} className="rounded" />
        </Link>

        <span className="min-w-0 truncate font-mono text-xs text-muted">
          {docId || "no document selected"}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {sidebar && (
          <aside className="w-[260px] shrink-0 border-r border-edge bg-chrome/50">
            <Placeholder label="explorer" />
          </aside>
        )}

        <main className="min-w-0 flex-1 border-r border-edge">
          <Placeholder label="page" />
        </main>

        <section className="min-w-0 flex-1">
          <div className="flex h-9 items-center gap-2 border-b border-edge px-3 text-xs text-faint">
            <FileText className="h-3.5 w-3.5" />
            markdown
          </div>
          <Placeholder label="markdown" />
        </section>
      </div>
    </div>
  );
}
