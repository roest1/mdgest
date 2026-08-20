import { AlertTriangle, Check, Copy, Download, GripVertical, Pencil, PencilLine, Stamp, Trash2, Undo2, X } from "lucide-react";
import { Modal } from "./Modal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api";
import { hitBlock, useDrag } from "../lib/drag";
import { listMarkers } from "../lib/order";
import { roleColor } from "../lib/roles";
import { useStore } from "../store";
import type { Block, DocView, Page } from "../types";

/**
 * The output, beside the page it came from. Two views of the same list of
 * blocks: rendered (headings as headings, lists as lists, each block a row
 * with its number in the gutter) and source (the markdown characters, with
 * the block number of each line in an nvim-style gutter).
 */
export function MarkdownPane({ docId, view }: { docId: string; view: DocView }) {
  const mdMode = useStore((s) => s.mdMode);
  const setMdMode = useStore((s) => s.setMdMode);
  const scrollRequest = useStore((s) => s.scrollRequest);
  const toast = useStore((s) => s.toast);
  const applyMarkdown = useStore((s) => s.applyMarkdown);
  const busy = useStore((s) => s.busy);
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<string | null>(null); // the raw markdown while editing
  const [confirmNew, setConfirmNew] = useState<string[] | null>(null); // new lines awaiting the warning
  const editing = draft !== null;
  const dirty = editing && draft !== view.markdown;

  const apply = async (text: string) => {
    await applyMarkdown(text);
    setDraft(null);
    setConfirmNew(null);
    setMdMode("rendered");
  };

  const onDone = async () => {
    // words the PDF cannot vouch for: draft lines whose bare text is new
    const bare = (l: string) =>
      l
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/^\s*(?:[-*+•]|\d{1,3}\.|[a-z]\.|(?:x{0,3})(?:ix|iv|v?i{1,3})\.)\s+/i, "")
        .replace(/[*_`]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    const had = new Set(view.markdown.split("\n").map(bare));
    const fresh = draft!.split("\n").filter((l) => {
      const b = bare(l);
      return b && b !== "---" && !had.has(b);
    });
    if (fresh.length) setConfirmNew(fresh);
    else await apply(draft!);
  };

  useEffect(() => {
    if (!scrollRequest || (scrollRequest.side !== "md" && scrollRequest.side !== "both")) return;
    const t = scrollRequest.target;
    const sel = t.startsWith("page:") ? `[data-mdpage="${t.slice(5)}"]` : `[data-pane="md"][data-block="${CSS.escape(t)}"]`;
    const el = ref.current?.querySelector(sel);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [scrollRequest, mdMode]);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="h-9 flex items-center gap-1 px-2 border-b border-edge/60 shrink-0">
        <div className="seg">
          <button className={`seg-item ${mdMode === "rendered" && !editing ? "seg-item-on" : ""}`} onClick={() => { setDraft(null); setMdMode("rendered"); }}>
            rendered
          </button>
          <button className={`seg-item ${mdMode === "source" && !editing ? "seg-item-on" : ""}`} onClick={() => { setDraft(null); setMdMode("source"); }}>
            source
          </button>
        </div>
        <span className="w-1" />
        {!editing ? (
          <button className="ghost" onClick={() => setDraft(view.markdown)} title="Edit the markdown as text; your changes become block edits when you're done">
            <PencilLine className="w-3.5 h-3.5" /> edit text
          </button>
        ) : (
          <>
            <button
              className="btn btn-sm btn-primary"
              disabled={busy || !dirty}
              onClick={onDone}
              title="Apply: the difference becomes edits (one undo step) and the view returns to rendered"
            >
              <Check className="w-3.5 h-3.5" /> done
            </button>
            <button className="btn btn-sm" onClick={() => setDraft(null)}>
              <X className="w-3.5 h-3.5" /> cancel
            </button>
            <span className="text-xs text-faint ml-1 hidden xl:inline truncate">
              same words, new markup → reshaped · removed line → deleted · new words → inserted as yours
            </span>
          </>
        )}
        <span className="ml-auto" />
        {!editing && (
          <span className="hidden xl:flex items-center gap-1 text-xs text-faint mr-2 select-none" title="Sweep across the text to select a group; drag the numbers in the gutter to move.">
            <GripVertical className="w-3.5 h-3.5" /> drag a number to move · sweep text to select
          </span>
        )}
        <button
          className="ghost"
          title="Copy markdown"
          onClick={async () => {
            await navigator.clipboard.writeText(view.markdown);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
            toast("markdown copied", "success");
          }}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        <a className="ghost" href={api.markdownUrl(docId)} download={`${view.doc.name}.md`} title="Download .md">
          <Download className="w-3.5 h-3.5" />
        </a>
      </div>
      <div ref={ref} className="flex-1 overflow-auto font-sans" onDragStart={(e) => e.preventDefault()}>
        {editing ? (
          <textarea
            autoFocus
            value={draft!}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="w-full h-full min-h-full resize-none bg-transparent outline-none p-3 pl-4 font-mono [font-variant-ligatures:none] text-[12.5px] leading-[1.45] text-ink"
          />
        ) : mdMode === "rendered" ? (
          <Rendered docId={docId} view={view} />
        ) : (
          <Source view={view} />
        )}
      </div>
      {confirmNew && (
        <Modal title="Careful" onClose={() => setConfirmNew(null)} width="max-w-lg">
          <div className="flex gap-3 items-start">
            <AlertTriangle className="w-8 h-8 text-amber-400 shrink-0" />
            <div className="text-sm text-ink/90 min-w-0">
              <p>
                You are about to put text into the converted markdown that does not exist in the PDF — {confirmNew.length} line
                {confirmNew.length === 1 ? "" : "s"}:
              </p>
              <pre className="mt-2 max-h-40 overflow-auto text-[11px] font-mono [font-variant-ligatures:none] text-pink-200/90 bg-ground/60 border border-edge rounded p-2 whitespace-pre-wrap">{confirmNew.slice(0, 20).join("\n")}{confirmNew.length > 20 ? `\n… and ${confirmNew.length - 20} more` : ""}</pre>
              <p className="mt-2 text-muted text-xs">It will be marked as inserted by a person — the only text the page cannot vouch for. Continue?</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn" onClick={() => setConfirmNew(null)}>
              Keep editing
            </button>
            <button className="btn btn-primary" onClick={() => apply(draft!)}>
              I understand, continue
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ rendered

function Rendered({ docId, view }: { docId: string; view: DocView }) {
  return (
    <div className="pb-24">
      {view.pages.map((p, i) => (
        <div key={p.n} data-mdpage={p.n}>
          {i > 0 && (
            <div className="flex items-center gap-2 px-3 my-2 text-[11px] text-faint font-mono select-none">
              <span className="w-10 text-right pr-2 border-r border-edge">—</span>
              <span className="flex-1 border-t border-dashed border-edge-strong" />
              <span>page {p.n}</span>
              <span className="flex-1 border-t border-dashed border-edge-strong" />
            </div>
          )}
          <PageRows docId={docId} page={p} />
        </div>
      ))}
    </div>
  );
}

function PageRows({ docId, page }: { docId: string; page: Page }) {
  const selection = useStore((s) => s.selection);
  const selected = useStore((s) => s.selected);
  const hover = useStore((s) => s.hover);
  const select = useStore((s) => s.select);
  const selectRange = useStore((s) => s.selectRange);
  const setSelected = useStore((s) => s.setSelected);
  const setHover = useStore((s) => s.setHover);
  const scrollTo = useStore((s) => s.scrollTo);
  const moveBlock = useStore((s) => s.moveBlock);
  const updateInsert = useStore((s) => s.updateInsert);
  const sweeping = useRef(false); // a drag-select just happened: swallow the click that follows

  // press on a row's content and sweep down (or up): every row passed becomes
  // the selection — the mouse version of click, shift-click.
  const onRowDown = useCallback(
    (e: React.PointerEvent, b: Block) => {
      if (e.button !== 0 || e.shiftKey) return;
      if ((e.target as HTMLElement).closest("button, textarea, input, a")) return;
      const sx = e.clientX;
      const sy = e.clientY;
      let moved = false;
      const ids = page.blocks.map((x) => x.id);
      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        if (!moved) {
          moved = true;
          sweeping.current = true;
          window.getSelection()?.removeAllRanges();
        }
        ev.preventDefault();
        const hit = hitBlock(ev.clientX, ev.clientY, "md");
        const j = hit ? ids.indexOf(hit.id) : -1;
        const i = ids.indexOf(b.id);
        if (j < 0 || i < 0) return;
        const [lo, hi] = i < j ? [i, j] : [j, i];
        setSelected(ids.slice(lo, hi + 1));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (moved) setTimeout(() => (sweeping.current = false), 0);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [page.blocks, setSelected],
  );
  const removeInsert = useStore((s) => s.removeInsert);
  const patchBlock = useStore((s) => s.patchBlock);
  const drag = useDrag((s) => s.drag);
  const markers = useMemo(() => listMarkers(page.blocks), [page.blocks]);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const onHandleDown = useCallback(
    (e: React.PointerEvent, b: Block) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const sx = e.clientX;
      const sy = e.clientY;
      const shift = e.shiftKey;
      let dragging = false;
      const cur = useStore.getState().selected;
      const group = cur.includes(b.id) && cur.length > 1 ? cur : [b.id];
      const onMove = (ev: PointerEvent) => {
        if (shift) return;
        if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 4) {
          dragging = true;
          useDrag.getState().start(b.id, page.n, group.length > 1 ? `${group.length} blocks` : `#${b.n}`, ev.clientX, ev.clientY, group);
          if (group.length === 1) select(b.id);
          document.body.style.cursor = "grabbing";
        }
        if (!dragging) return;
        const hit = hitBlock(ev.clientX, ev.clientY, "md");
        let target: string | null = null;
        let place: "before" | "after" = "before";
        if (hit && !group.includes(hit.id) && page.blocks.some((x) => x.id === hit.id)) {
          target = hit.id;
          const r = hit.el.getBoundingClientRect();
          place = ev.clientY < r.top + r.height / 2 ? "before" : "after";
        }
        useDrag.getState().update(ev.clientX, ev.clientY, target, place, page.blocks);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        if (dragging) {
          const d = useDrag.getState().end();
          if (d?.target) moveBlock(d.ids, { target: d.target, place: d.place });
        } else if (shift) {
          selectRange(b.id);
        } else {
          select(b.id);
          scrollTo(b.id, "pdf");
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [page.blocks, page.n, select, selectRange, scrollTo, moveBlock],
  );

  return (
    <div>
      {page.blocks.map((b) => {
        const c = roleColor(b);
        const isSel = selection === b.id || selected.includes(b.id);
        const isHover = hover === b.id;
        const previewN = drag?.numbers?.get(b.id);
        const affected = drag?.affected.has(b.id);
        const isTarget = drag?.target === b.id;
        const breakRow = (
          <div className="flex items-center text-[11px] text-faint font-mono select-none">
            <span className="w-12 shrink-0 text-right pr-2 border-r border-edge">—</span>
            <span className="flex-1 mx-3 border-t-2 border-dashed border-edge-strong" />
            <span className="pr-3">---</span>
          </div>
        );
        return (
          <div key={b.id}>
          {b.break_before && breakRow}
          <div
            data-pane="md"
            data-block={b.id}
            onMouseEnter={() => setHover(b.id)}
            onMouseLeave={() => setHover(null)}
            onPointerDown={(e) => onRowDown(e, b)}
            onClick={(e) => {
              if (sweeping.current) return;
              if (e.shiftKey) {
                selectRange(b.id);
                return;
              }
              select(b.id);
              scrollTo(b.id, "pdf");
            }}
            className={`relative flex items-stretch group select-none ${isSel ? "bg-blue-500/15" : isHover && !drag ? "bg-white/[0.04]" : ""} ${
              drag?.ids.includes(b.id) ? "opacity-35" : ""
            }`}
          >
            {isTarget && (
              <>
                <div className={`drop-line left-1 right-1 h-[3px] ${drag!.place === "before" ? "top-[-2px]" : "bottom-[-2px]"}`} />
                <div className={`drop-caret left-[-2px] ${drag!.place === "before" ? "top-[-7px]" : "bottom-[-7px]"}`} />
              </>
            )}
            {/* gutter: the number, and the drag handle */}
            <div
              className="w-12 shrink-0 flex items-start justify-end gap-0.5 pr-1 pt-1 border-r border-edge select-none cursor-grab active:cursor-grabbing"
              onPointerDown={(e) => onHandleDown(e, b)}
              title="drag to move · click to select"
            >
              <GripVertical className={`w-3 h-3 mt-[1px] text-faint ${isHover && !drag ? "opacity-100" : "opacity-0"} transition-opacity`} />
              {/* fill says what the block is; the ring says what's happening to it */}
              <span
                className={`px-1 min-w-[20px] text-center rounded-sm text-[11px] font-mono font-semibold leading-[16px] transition-all ${c.badge} ${
                  affected ? "ring-2 ring-amber-400" : isSel ? "ring-2 ring-blue-400" : ""
                } ${b.hidden ? "line-through opacity-60" : ""}`}
              >
                {previewN ?? b.n}
              </span>
            </div>
            {/* the block */}
            <div className={`flex-1 min-w-0 px-3 py-[3px] ${b.hidden ? "opacity-40 line-through" : ""}`}>
              <BlockContent docId={docId} page={page} b={b} marker={markers.get(b.id)} />
              {b.kind === "insert" && (
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-[11px] text-pink-300/80 uppercase tracking-wider">inserted · not on the page</span>
                  <button className="p-0.5 text-muted hover:text-ink" onClick={(e) => { e.stopPropagation(); setEditing({ id: b.id, text: b.text }); }} title="Edit inserted text">
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button className="p-0.5 text-muted hover:text-red-300" onClick={(e) => { e.stopPropagation(); removeInsert(b.id); }} title="Remove inserted text">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
              {editing?.id === b.id && (
                <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                  <textarea autoFocus value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} rows={4} className="w-full bg-ground border border-pink-700/60 rounded p-2 text-xs font-mono [font-variant-ligatures:none] text-ink outline-none" />
                  <div className="flex gap-1 mt-1">
                    <button className="btn btn-sm btn-primary" onClick={() => { updateInsert(b.id, editing.text); setEditing(null); }}>
                      <Check className="w-3 h-3" /> save
                    </button>
                    <button className="btn btn-sm" onClick={() => setEditing(null)}>
                      <X className="w-3 h-3" /> cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
            {b.rule && <Stamp className="w-3 h-3 self-start mt-1.5 mr-1 text-amber-300/70 shrink-0" aria-label="shaped by a learned rule" />}
            {b.kind !== "insert" && (
              <button
                className={`self-start mt-1 mr-1 p-0.5 ${b.hidden ? "text-muted hover:text-emerald-300" : "opacity-0 group-hover:opacity-100 text-faint hover:text-red-300"}`}
                title={b.hidden ? "Restore" : "Delete from the markdown (h) — the page keeps it, struck through"}
                onClick={(e) => {
                  e.stopPropagation();
                  patchBlock(b.id, { hidden: !b.hidden });
                }}
              >
                {b.hidden ? <Undo2 className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
              </button>
            )}
          </div>
          {b.break_after && breakRow}
          </div>
        );
      })}
    </div>
  );
}

function BlockContent({ docId, page, b, marker }: { docId: string; page: Page; b: Block; marker?: string }) {
  const inline = (text: string) => {
    let node: React.ReactNode = text;
    if (b.bold) node = <strong>{node}</strong>;
    if (b.italic) node = <em>{node}</em>;
    return node;
  };
  if (b.role === "image") {
    const pic = page.pictures[b.picture];
    if (!pic?.path) return <span className="text-xs text-faint italic">figure {b.picture + 1} (not extractable)</span>;
    return (
      <figure className="my-1">
        <img src={api.assetUrl(docId, pic.path)} alt={`page ${page.n} figure ${b.picture + 1}`} className="max-h-56 max-w-full rounded border border-edge" loading="lazy" />
        <figcaption className="text-[11px] text-faint font-mono mt-0.5">
          page {page.n} figure {b.picture + 1}
        </figcaption>
      </figure>
    );
  }
  if (b.role === "insert") {
    return (
      <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-1 prose-li:my-0 border-l-2 border-pink-500/60 pl-2">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{b.text || "_empty_"}</ReactMarkdown>
      </div>
    );
  }
  if (b.role === "heading") {
    const lvl = Math.max(1, Math.min(6, b.level || 2));
    const cls = ["text-2xl", "text-xl", "text-lg", "text-base", "text-sm", "text-sm"][lvl - 1];
    return (
      <div className={`${cls} font-semibold text-ink ${lvl <= 2 ? "mt-2 mb-1" : "mt-1"}`}>
        <span className="text-faint font-mono text-[11px] mr-2 align-middle">{"#".repeat(lvl)}</span>
        {b.text}
      </div>
    );
  }
  if (marker) {
    return (
      <div className="flex gap-2 text-sm text-ink/90 leading-snug" style={{ paddingLeft: (b.depth || 0) * 18 }}>
        <span className="text-muted font-mono shrink-0 w-6 text-right">{marker}</span>
        <span className="min-w-0">{inline(b.text)}</span>
      </div>
    );
  }
  return <p className="text-sm text-ink/90 leading-relaxed my-0.5">{inline(b.text)}</p>;
}

// ------------------------------------------------------------------ source

function Source({ view }: { view: DocView }) {
  const selection = useStore((s) => s.selection);
  const selected = useStore((s) => s.selected);
  const hover = useStore((s) => s.hover);
  const select = useStore((s) => s.select);
  const selectRange = useStore((s) => s.selectRange);
  const setHover = useStore((s) => s.setHover);
  const scrollTo = useStore((s) => s.scrollTo);
  return (
    <div className="font-mono [font-variant-ligatures:none] text-[12.5px] leading-[1.45] pb-24">
      {view.md_lines.map((l, i) => {
        const isSel = l.block && (selection === l.block || selected.includes(l.block));
        const isHover = l.block && hover === l.block;
        return (
          <div
            key={i}
            data-pane="md"
            data-block={l.block ?? undefined}
            data-mdpage={l.page_break ? l.page : undefined}
            className={`flex ${isSel ? "bg-blue-500/15" : isHover ? "bg-white/[0.04]" : ""} ${l.block ? "cursor-pointer" : ""}`}
            onMouseEnter={() => l.block && setHover(l.block)}
            onMouseLeave={() => setHover(null)}
            onClick={(e) => {
              if (!l.block) return;
              if (e.shiftKey) {
                selectRange(l.block);
                return;
              }
              select(l.block);
              scrollTo(l.block, "pdf");
            }}
          >
            <span className={`w-12 shrink-0 text-right pr-2 select-none border-r border-edge ${isSel ? "text-blue-300" : "text-faint"}`}>{l.n ?? ""}</span>
            <span className={`pl-3 whitespace-pre-wrap break-words ${l.page_break ? "text-faint" : l.text.startsWith("#") ? "text-blue-200" : l.text.startsWith("![") ? "text-amber-200" : "text-ink/90"}`}>
              {l.text || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}
