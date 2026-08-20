import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { DocTabs } from "./components/DocTabs";
import { DocumentView } from "./components/DocumentView";
import { Explorer } from "./components/Explorer";
import { StatusBar } from "./components/StatusBar";
import { Toasts } from "./components/Toasts";
import { isDesktop, onFileDrop, openExternal } from "./lib/desktop";
import { useStore } from "./store";

/** Desktop-only window plumbing: OS drags land here as native events with
 * absolute paths (the webview never sees an HTML5 drop), and links in
 * rendered markdown leave through the system browser instead of navigating
 * the app away from itself. */
function useDesktopWindow() {
  const setNativeDragOver = useStore((s) => s.setNativeDragOver);
  const addPaths = useStore((s) => s.addPaths);
  useEffect(() => {
    if (!isDesktop) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    onFileDrop({
      over: () => setNativeDragOver(true),
      leave: () => setNativeDragOver(false),
      drop: (paths) => {
        setNativeDragOver(false);
        addPaths(paths);
      },
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
      if (a && /^https?:\/\//.test(a.href)) {
        e.preventDefault();
        openExternal(a.href);
      }
    };
    document.addEventListener("click", onClick, true);
    return () => {
      disposed = true;
      unlisten?.();
      document.removeEventListener("click", onClick, true);
    };
  }, [setNativeDragOver, addPaths]);
}

export default function App() {
  const activeDoc = useStore((s) => s.activeDoc);
  const [sidebar, setSidebar] = useState(true);
  useDesktopWindow();
  return (
    <div className="h-full flex flex-col">
      <header className="h-11 flex items-center gap-3 px-3 bg-chrome shrink-0">
        <button className="ghost p-1" onClick={() => setSidebar((v) => !v)} title="Toggle explorer">
          {sidebar ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
        </button>
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-md bg-gradient-to-br from-brand-green to-emerald-700 flex items-center justify-center text-[11px] font-bold text-black">md</span>
          <span className="font-display font-semibold text-[15px] tracking-tight text-ink">mdgest</span>
          <span className="text-xs text-faint hidden sm:inline">pdf → markdown, page by page</span>
        </div>
      </header>
      <div className="flex-1 min-h-0 flex">
        {sidebar && (
          <aside className="w-[270px] shrink-0 border-r border-edge bg-chrome/50 min-h-0">
            <Explorer />
          </aside>
        )}
        <main className="flex-1 min-w-0 min-h-0 flex flex-col">
          <DocTabs />
          <div className="flex-1 min-h-0">
            {activeDoc ? (
              <DocumentView key={activeDoc} docId={activeDoc} />
            ) : (
              <Empty />
            )}
          </div>
        </main>
      </div>
      <StatusBar />
      <Toasts />
    </div>
  );
}

function Empty() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="glass rounded-2xl p-8 max-w-md text-center animate-fade-in">
        <h1 className="font-display text-2xl font-semibold text-ink">Open a document</h1>
        <p className="font-display text-sm text-muted mt-3 leading-relaxed">
          Drop a PDF, a zip, or a whole folder into the explorer. Each document opens as a tab: the page on the left with numbered boxes around every piece of text and every picture, the markdown on the right with the same numbers in its gutter.
        </p>
        <p className="text-xs text-faint mt-4">
          Everything here is also a command: <span className="kbd">mdgest add</span> <span className="kbd">mdgest show</span> <span className="kbd">mdgest set</span> <span className="kbd">mdgest move</span> <span className="kbd">mdgest index</span>
        </p>
      </div>
    </div>
  );
}
