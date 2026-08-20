import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

/**
 * The ambient state of the app, in one 24px strip: what document, which page,
 * how many edits, where the workspace lives, whether the engine is busy.
 * State lives here so the toolbar holds only things you click.
 */
export function StatusBar() {
  const activeDoc = useStore((s) => s.activeDoc);
  const view = useStore((s) => (s.activeDoc ? s.docs[s.activeDoc] : undefined));
  const currentPage = useStore((s) => s.currentPage);
  const selection = useStore((s) => s.selection);
  const workspace = useStore((s) => s.workspace);
  const busy = useStore((s) => s.busy);
  const blocks = view && !view.pending ? view.pages.reduce((n, p) => n + p.blocks.length, 0) : 0;
  return (
    <div className="h-6 shrink-0 flex items-center gap-4 px-3 bg-chrome border-t border-edge text-[11px] font-mono text-faint select-none">
      {activeDoc && view && !view.pending && (
        <>
          <span className="text-muted truncate max-w-[28ch]" title={activeDoc}>
            {activeDoc.split("/").pop()}.pdf
          </span>
          <span>
            page {currentPage} of {view.pages.length} · {blocks} blocks
          </span>
          <span>
            <Num v={view.edits.blocks} /> overrides · <Num v={view.edits.pages_reordered} /> reordered · <Num v={view.edits.inserts} /> inserted
          </span>
          {!selection && <span className="hidden lg:inline font-sans">select a box to shape it</span>}
        </>
      )}
      <span className="ml-auto" />
      {busy && <Loader2 className="w-3 h-3 animate-spin text-muted" />}
      <span className="truncate max-w-[32vw]" title={workspace}>
        {workspace}
      </span>
      <span className="text-faint/80">v{__APP_VERSION__}</span>
    </div>
  );
}

/** A counter that rolls when its value changes. */
function Num({ v }: { v: number }) {
  const prev = useRef(v);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (prev.current !== v) {
      prev.current = v;
      setNonce((n) => n + 1);
    }
  }, [v]);
  return (
    <span key={nonce} className={`inline-block text-muted ${nonce ? "animate-tick" : ""}`}>
      {v}
    </span>
  );
}
