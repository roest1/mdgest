import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { hitBlock, useDrag } from "../lib/drag";
import { roleColor, shapeLabel } from "../lib/roles";
import { useStore } from "../store";
import type { Block, DocView, Page } from "../types";

/**
 * Every page in one scrolling column. Each page is its rendered image with an
 * overlay of numbered boxes — one per block — that you can click (select) and
 * drag (reorder). Overlays are toggled per kind so a figure drawn over text
 * can be got out of the way.
 */
export function PdfPane({ docId, view }: { docId: string; view: DocView }) {
  const overlays = useStore((s) => s.overlays);
  const zoom = useStore((s) => s.zoom);
  const setCurrentPage = useStore((s) => s.setCurrentPage);
  const scrollRequest = useStore((s) => s.scrollRequest);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // which page is in view
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        let best: { n: number; ratio: number } | null = null;
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page);
          if (e.isIntersecting && (!best || e.intersectionRatio > best.ratio)) best = { n, ratio: e.intersectionRatio };
        }
        if (best) setCurrentPage(best.n);
      },
      { root, threshold: [0.1, 0.3, 0.5, 0.7] },
    );
    pageRefs.current.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [view.pages.length, setCurrentPage]);

  // scroll to a block or page when asked
  useEffect(() => {
    if (!scrollRequest || (scrollRequest.side !== "pdf" && scrollRequest.side !== "both")) return;
    const t = scrollRequest.target;
    if (t.startsWith("page:")) {
      pageRefs.current.get(Number(t.slice(5)))?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const el = containerRef.current?.querySelector(`[data-pane="pdf"][data-block="${CSS.escape(t)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [scrollRequest]);

  return (
    <div ref={containerRef} className="h-full overflow-auto bg-ground relative select-none" onDragStart={(e) => e.preventDefault()}>
      <div className="flex flex-col items-center gap-6 py-6 px-4">
        {view.pages.map((p) => (
          <div key={p.n} ref={(el) => { if (el) pageRefs.current.set(p.n, el); }} data-page={p.n} className="w-full flex flex-col items-center">
            <PageView docId={docId} page={p} overlays={overlays} zoom={zoom} />
            <div className="text-[11px] text-faint mt-1 font-mono">
              page {p.n} · {p.blocks.length} blocks{p.reordered ? " · reordered" : ""}
            </div>
          </div>
        ))}
      </div>
      <DragGhost />
    </div>
  );
}

function PageView({ docId, page, overlays, zoom }: { docId: string; page: Page; overlays: ReturnType<typeof useStore.getState>["overlays"]; zoom: number }) {
  const selection = useStore((s) => s.selection);
  const selected = useStore((s) => s.selected);
  const hover = useStore((s) => s.hover);
  const select = useStore((s) => s.select);
  const selectRange = useStore((s) => s.selectRange);
  const setSelected = useStore((s) => s.setSelected);
  const setHover = useStore((s) => s.setHover);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const scrollTo = useStore((s) => s.scrollTo);
  const moveBlock = useStore((s) => s.moveBlock);
  const drag = useDrag((s) => s.drag);
  const W = page.width;
  const H = page.height;
  const widthPct = Math.round(100 * Math.min(1, 0.92 * zoom));

  // biggest boxes first, so small ones sit on top and stay clickable
  const visible = useMemo(() => {
    const list = page.blocks.filter((b) => b.bbox && (b.kind === "image" ? overlays.images : overlays.text));
    return list.sort((a, b) => area(b) - area(a));
  }, [page.blocks, overlays.images, overlays.text]);

  const pct = (b: Block) => {
    const [l, bt, r, t] = b.bbox!;
    return { left: `${(100 * l) / W}%`, top: `${(100 * (H - t)) / H}%`, width: `${(100 * (r - l)) / W}%`, height: `${(100 * (t - bt)) / H}%` };
  };

  const onPointerDown = useCallback(
    (e: React.PointerEvent, b: Block) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault(); // no text selection, no native drag of the page image
      const startX = e.clientX;
      const startY = e.clientY;
      const shift = e.shiftKey;
      let dragging = false;
      // dragging a selected box drags the whole selected group
      const cur = useStore.getState().selected;
      const group = cur.includes(b.id) && cur.length > 1 ? cur : [b.id];
      const onMove = (ev: PointerEvent) => {
        if (shift) return;
        if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 5) {
          dragging = true;
          useDrag.getState().start(b.id, page.n, group.length > 1 ? `${group.length} blocks` : `#${b.n}`, ev.clientX, ev.clientY, group);
          if (group.length === 1) select(b.id);
          document.body.style.cursor = "grabbing";
        }
        if (!dragging) return;
        const hit = hitBlock(ev.clientX, ev.clientY, "pdf");
        let target: string | null = null;
        let place: "before" | "after" = "before";
        if (hit && !group.includes(hit.id) && page.blocks.some((x) => x.id === hit.id)) {
          target = hit.id;
          const tb = page.blocks.find((x) => x.id === hit.id)!;
          const r = hit.el.getBoundingClientRect();
          // same row? decide left/right; otherwise above/below
          const sameRow = tb.bbox && b.bbox && Math.min(tb.bbox[3], b.bbox[3]) - Math.max(tb.bbox[1], b.bbox[1]) > 0.5 * Math.min(tb.bbox[3] - tb.bbox[1], b.bbox[3] - b.bbox[1]);
          place = sameRow ? (ev.clientX < r.left + r.width / 2 ? "before" : "after") : ev.clientY < r.top + r.height / 2 ? "before" : "after";
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
          scrollTo(b.id, "md");
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [page.blocks, page.n, select, selectRange, scrollTo, moveBlock],
  );

  // drag on the page itself (not on a box) draws a rectangle: every box it
  // touches becomes the selection, in page order — a group you can then drag.
  const onPageDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("[data-block]")) return;
      e.preventDefault();
      const root = pageRef.current;
      if (!root) return;
      const r0 = root.getBoundingClientRect();
      const sx = e.clientX;
      const sy = e.clientY;
      let moved = false;
      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        moved = true;
        const rect = { x0: Math.min(sx, ev.clientX), y0: Math.min(sy, ev.clientY), x1: Math.max(sx, ev.clientX), y1: Math.max(sy, ev.clientY) };
        setMarquee({ x0: rect.x0 - r0.left, y0: rect.y0 - r0.top, x1: rect.x1 - r0.left, y1: rect.y1 - r0.top });
        const hits: string[] = [];
        root.querySelectorAll<HTMLElement>('[data-pane="pdf"][data-block]').forEach((el) => {
          const b = el.getBoundingClientRect();
          if (b.left < rect.x1 && b.right > rect.x0 && b.top < rect.y1 && b.bottom > rect.y0) hits.push(el.dataset.block!);
        });
        const set = new Set(hits);
        setSelected(page.blocks.filter((b) => set.has(b.id)).map((b) => b.id));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setMarquee(null);
        if (!moved) select(null);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [page.blocks, setSelected, select],
  );

  return (
    <div ref={pageRef} onPointerDown={onPageDown} className="relative shadow-2xl shadow-black/60 rounded-sm bg-white cursor-crosshair" style={{ width: `${widthPct}%`, aspectRatio: `${W} / ${H}` }}>
      {marquee && (
        <div
          className="absolute border border-blue-400 bg-blue-400/15 pointer-events-none z-30"
          style={{ left: marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0 }}
        />
      )}
      <img src={api.pageUrl(docId, page.n)} alt={`page ${page.n}`} className="block w-full h-full select-none" draggable={false} loading="lazy" />
      {/* raw lines, for when you want to see every piece of text the page has */}
      {overlays.lines &&
        page.lines.map((l, i) => {
          const [x0, y0, x1, y1] = l.bbox;
          return (
            <div
              key={i}
              className="absolute border border-fuchsia-400/40 pointer-events-none"
              style={{ left: `${(100 * x0) / W}%`, top: `${(100 * (H - y1)) / H}%`, width: `${(100 * (x1 - x0)) / W}%`, height: `${(100 * (y1 - y0)) / H}%` }}
            />
          );
        })}
      {visible.map((b) => {
        const c = roleColor(b);
        const isSel = selection === b.id || selected.includes(b.id);
        const isHover = hover === b.id;
        const previewN = drag?.numbers?.get(b.id);
        const affected = drag?.affected.has(b.id);
        const isTarget = drag?.target === b.id;
        const isDragged = drag?.ids.includes(b.id);
        return (
          <div
            key={b.id}
            data-pane="pdf"
            data-block={b.id}
            onPointerDown={(e) => onPointerDown(e, b)}
            onMouseEnter={() => setHover(b.id)}
            onMouseLeave={() => setHover(null)}
            title={b.kind === "image" ? `figure ${b.picture + 1}` : b.text}
            className={`absolute border-[1.5px] rounded-[2px] cursor-grab active:cursor-grabbing transition-colors ${c.border} ${
              isSel ? `ring-2 ring-blue-400 ${c.bg}` : isHover && !drag ? "bg-white/10 brightness-125" : c.bg
            } ${isDragged ? "opacity-35" : ""} ${b.hidden ? "border-dashed" : ""} ${b.edited ? "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]" : ""}`}
            style={pct(b)}
          >
            {isTarget && (
              <div
                className={`drop-line ${
                  sameRowFlag(drag, b, page)
                    ? drag!.place === "before"
                      ? "left-[-4px] top-0 bottom-0 w-[3px]"
                      : "right-[-4px] top-0 bottom-0 w-[3px]"
                    : drag!.place === "before"
                      ? "top-[-4px] left-0 right-0 h-[3px]"
                      : "bottom-[-4px] left-0 right-0 h-[3px]"
                }`}
              />
            )}
            {overlays.numbers && (
              <span
                className={`absolute -top-[7px] -left-[7px] px-[3px] min-w-[14px] h-[13px] rounded-[3px] text-[10px] font-mono font-semibold leading-[13px] text-center shadow-md whitespace-nowrap transition-all ${c.badge} ${
                  affected ? "ring-2 ring-amber-400" : isSel ? "ring-2 ring-blue-400" : ""
                } ${b.hidden ? "line-through opacity-70" : ""} ${isSel || isHover ? "z-20 scale-110" : "opacity-90"}`}
              >
                {previewN ?? b.n}
                {(isSel || isHover) && <span className="font-normal opacity-90"> {shapeLabel(b)}</span>}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function sameRowFlag(drag: ReturnType<typeof useDrag.getState>["drag"], target: Block, page: Page): boolean {
  if (!drag) return false;
  const moving = page.blocks.find((x) => x.id === drag.id);
  if (!moving?.bbox || !target.bbox) return false;
  const ov = Math.min(target.bbox[3], moving.bbox[3]) - Math.max(target.bbox[1], moving.bbox[1]);
  return ov > 0.5 * Math.min(target.bbox[3] - target.bbox[1], moving.bbox[3] - moving.bbox[1]);
}

function area(b: Block): number {
  if (!b.bbox) return 0;
  return (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]);
}

export function DragGhost() {
  const drag = useDrag((s) => s.drag);
  if (!drag) return null;
  return (
    <div className="fixed z-50 pointer-events-none px-2 py-1 rounded bg-blue-600 text-white text-[11px] font-mono shadow-lg" style={{ left: drag.x + 12, top: drag.y + 12 }}>
      {drag.target && drag.numbers ? `${drag.label} → #${drag.numbers.get(drag.id)}` : `${drag.label} — drop on the place it should take`}
    </div>
  );
}
