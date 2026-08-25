import { CircleHelp, Ellipsis, GitBranch, Hash, Image as ImageIcon, ListRestart, Loader2, Redo2, Ruler, Stamp, Type, Undo2, WrapText, ZoomIn, ZoomOut } from "lucide-react";
import { HelpBar } from "./HelpBar";
import { RulesPanel } from "./RulesPanel";
import { VersionsPanel } from "./VersionsPanel";
import { useEffect, useRef, useState } from "react";
import { findBlock, useStore } from "../store";
import { MarkdownPane } from "./MarkdownPane";
import { Modal } from "./Modal";
import { PageRail } from "./PageRail";
import { PdfPane } from "./PdfPane";
import { ShapeBar } from "./ShapeBar";

/** PDF on the left, markdown on the right, thumbnails on the far left, one bar above. */
export function DocumentView({ docId }: { docId: string }) {
  const view = useStore((s) => s.docs[docId]);
  const overlays = useStore((s) => s.overlays);
  const toggleOverlay = useStore((s) => s.toggleOverlay);
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const resetEdits = useStore((s) => s.resetEdits);
  const busy = useStore((s) => s.busy);
  const [split, setSplit] = useState(0.52);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(() => localStorage.getItem("mdgest-help") !== "closed");
  const setHelp = (v: boolean) => {
    setHelpOpen(v);
    localStorage.setItem("mdgest-help", v ? "open" : "closed");
  };
  const [showVersions, setShowVersions] = useState(false);
  const learnScope = useStore((s) => s.learnScope);
  const setLearnScope = useStore((s) => s.setLearnScope);
  const folders = ancestorsOf(docId);
  const splitRef = useRef<HTMLDivElement>(null);

  useShortcuts(docId);

  const startSplit = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = splitRef.current;
    if (!el) return;
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      setSplit(Math.min(0.85, Math.max(0.15, (ev.clientX - r.left) / r.width)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!view || view.pending) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
        <p className="text-sm">{view?.job?.status === "error" ? `analysis failed: ${view.job.error}` : "reading the page map…"}</p>
        <p className="text-xs text-faint font-mono">{docId}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* toolbar — only things you click; ambient state lives in the status bar */}
      <div className="h-10 flex items-center gap-1 px-2 bg-chrome border-b border-edge shrink-0">
        <button className={`chip ${overlays.text ? "chip-on" : ""}`} onClick={() => toggleOverlay("text")} title="Boxes around every piece of text (t)">
          <Type className="w-3.5 h-3.5" /> text <span className="chip-key">t</span>
        </button>
        <button className={`chip ${overlays.images ? "chip-on" : ""}`} onClick={() => toggleOverlay("images")} title="Boxes around every image (g) — turn off to work on text under a picture">
          <ImageIcon className="w-3.5 h-3.5" /> images <span className="chip-key">g</span>
        </button>
        <button className={`chip ${overlays.numbers ? "chip-on" : ""}`} onClick={() => toggleOverlay("numbers")} title="Show the numbers (#)">
          <Hash className="w-3.5 h-3.5" /> numbers <span className="chip-key">#</span>
        </button>
        <button className={`chip ${overlays.lines ? "chip-on" : ""}`} onClick={() => toggleOverlay("lines")} title="Every raw line the text layer reports (l)">
          <WrapText className="w-3.5 h-3.5" /> lines <span className="chip-key">l</span>
        </button>
        <span className="w-2" />
        <div className="flex items-center rounded-md border border-edge bg-ground/60 shrink-0">
          <button className="ghost" onClick={() => setZoom(zoom - 0.15)} title="Zoom out">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[11px] font-mono text-muted w-10 text-center select-none">{Math.round(zoom * 100)}%</span>
          <button className="ghost" onClick={() => setZoom(zoom + 0.15)} title="Zoom in">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
        <span className="w-2" />
        <label className="flex items-center gap-1.5 text-xs text-muted shrink-0" title="Every shape decision you make is also recorded as a rule in this folder, so the next document of the same shape starts ahead. Deeper folders win over shallower ones.">
          <Stamp className="w-3.5 h-3.5" />
          learn in
          <select
            value={learnScope ?? "__off"}
            onChange={(e) => setLearnScope(e.target.value === "__off" ? null : e.target.value)}
            className="bg-ground border border-edge rounded px-1 py-0.5 text-xs text-ink outline-none focus:border-blue-500 max-w-[180px]"
          >
            <option value="__off">off</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f || "(workspace)"}
              </option>
            ))}
          </select>
        </label>
        <button className="ghost" onClick={() => setShowRules(true)} title="What has been learned on this document's path">
          <Ruler className="w-3.5 h-3.5" />
          rules{view.rules_applied ? ` · ${view.rules_applied}` : ""}
        </button>
        <span className="ml-auto" />
        <button className={`btn btn-sm ${view.versions?.dirty ? "border-amber-500/60 text-amber-200" : ""}`} onClick={() => setShowVersions(true)} title="Saved versions of this document's edits">
          <GitBranch className="w-3.5 h-3.5" />
          {view.versions?.base ?? "original"}
          {view.versions?.dirty ? " *" : ""}
        </button>
        <button className="ghost" onClick={() => undo()} disabled={busy || !view.edits.undo} title="Undo (⌘Z)">
          <Undo2 className="w-3.5 h-3.5" /> undo
        </button>
        <button className="ghost" onClick={() => redo()} disabled={busy || !view.edits.redo} title="Redo (⌘⇧Z)">
          <Redo2 className="w-3.5 h-3.5" />
        </button>
        <button className={`ghost ${helpOpen ? "bg-raised text-ink" : ""}`} onClick={() => setHelp(!helpOpen)} title="Show the keys and gestures">
          <CircleHelp className="w-3.5 h-3.5" />
        </button>
        <div className="relative shrink-0">
          <button className={`ghost ${menuOpen ? "bg-raised text-ink" : ""}`} onClick={() => setMenuOpen((v) => !v)} title="More">
            <Ellipsis className="w-3.5 h-3.5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-1 glass rounded-lg shadow-xl py-1 min-w-[190px] animate-fade-in">
                <button
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 text-red-300 hover:bg-raised disabled:opacity-40"
                  disabled={busy}
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmReset(true);
                  }}
                >
                  <ListRestart className="w-3.5 h-3.5" /> reset every edit…
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* panes — the shape bar and the cheat sheet float over them */}
      <div className="flex-1 min-h-0 flex relative">
        <div className="w-[116px] shrink-0">
          <PageRail docId={docId} view={view} />
        </div>
        <div ref={splitRef} className="flex-1 min-w-0 flex">
          <div style={{ width: `${split * 100}%` }} className="min-w-0 h-full">
            <PdfPane docId={docId} view={view} />
          </div>
          <div onPointerDown={startSplit} className="w-1.5 cursor-col-resize bg-edge/60 hover:bg-blue-500/50 transition-colors shrink-0" title="Drag to resize" />
          <div className="flex-1 min-w-0 h-full bg-chrome/40 border-l border-edge">
            <MarkdownPane docId={docId} view={view} />
          </div>
        </div>
        <ShapeBar />
        {helpOpen && <HelpBar onClose={() => setHelp(false)} />}
      </div>

      {showRules && <RulesPanel docId={docId} onClose={() => setShowRules(false)} />}
      {showVersions && <VersionsPanel view={view} onClose={() => setShowVersions(false)} />}
      {confirmReset && (
        <Modal title="Forget every edit?" onClose={() => setConfirmReset(false)} width="max-w-sm">
          <p className="text-sm text-ink/90">Every override, reorder, join and insertion on this document goes. Undo can bring it back.</p>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={async () => { await resetEdits(); setConfirmReset(false); }}>
              Reset
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ancestorsOf(docId: string): string[] {
  const parts = docId.split("/").slice(0, -1);
  const out = [""];
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

/** Keys for the fast path: select a box, tap a key. */
function useShortcuts(docId: string) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const s = useStore.getState();
      if (s.activeDoc !== docId) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (e.key === "Escape") {
        s.select(null);
        return;
      }
      if (e.key === "t" && !mod) return s.toggleOverlay("text");
      if (e.key === "g" && !mod) return s.toggleOverlay("images");
      if (e.key === "#") return s.toggleOverlay("numbers");
      if (e.key === "l" && !mod) return s.toggleOverlay("lines");
      const found = findBlock(s.docs[docId], s.selection);
      if (!found || mod) return;
      const b = found.block;
      const page = s.docs[docId].pages[found.pageIndex];
      const idx = page.blocks.findIndex((x) => x.id === b.id);
      const group = s.selected.length > 1 ? s.selected : [b.id];
      const patch = (f: Record<string, unknown>) => (group.length > 1 ? s.patchBlocks(group, f as never) : s.patchBlock(b.id, f as never));
      switch (e.key) {
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
          return patch({ role: "heading", level: Number(e.key) });
        case "p":
          return patch({ role: "para" });
        case "-":
          return patch({ role: "bullet" });
        case "n":
          return patch({ role: "numbered" });
        case "a":
          return patch({ role: "alpha" });
        case "r":
          return patch({ role: "roman" });
        case "b":
          return patch({ bold: !b.bold });
        case "i":
          return patch({ italic: !b.italic });
        case "h":
          return patch({ hidden: !b.hidden });
        case "<":
          return patch({ break_before: !b.break_before });
        case ">":
          return patch({ break_after: !b.break_after });
        case "[":
          return patch({ depth: Math.max(0, (b.depth || 0) - 1) });
        case "]":
          return patch({ depth: (b.depth || 0) + 1 });
        case "j":
        case "ArrowDown": {
          const nb = page.blocks[idx + 1] ?? s.docs[docId].pages[found.pageIndex + 1]?.blocks[0];
          if (nb) {
            s.select(nb.id);
            s.scrollTo(nb.id, "both");
          }
          e.preventDefault();
          return;
        }
        case "k":
        case "ArrowUp": {
          const prevPage = s.docs[docId].pages[found.pageIndex - 1];
          const nb = page.blocks[idx - 1] ?? prevPage?.blocks[prevPage.blocks.length - 1];
          if (nb) {
            s.select(nb.id);
            s.scrollTo(nb.id, "both");
          }
          e.preventDefault();
          return;
        }
        // one place up or down means one *visible* place: a deleted block has
        // no number to take, so stepping onto it would look like nothing moved
        case "K": {
          const first = page.blocks.findIndex((x) => group.includes(x.id));
          const above = page.blocks.slice(0, first).filter((x) => !x.hidden && !group.includes(x.id));
          const t = above[above.length - 1];
          if (t) s.moveBlock(group, { target: t.id, place: "before" });
          return;
        }
        case "J": {
          const last = page.blocks.map((x) => group.includes(x.id)).lastIndexOf(true);
          const t = page.blocks.slice(last + 1).find((x) => !x.hidden && !group.includes(x.id));
          if (t) s.moveBlock(group, { target: t.id, place: "after" });
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [docId]);
}
