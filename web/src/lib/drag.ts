import { useCallback } from "react";
import { create } from "zustand";
import { previewMove } from "./order";
import { useStore } from "../store";
import type { Block, Page } from "../types";

export interface DragState {
  id: string;
  ids: string[]; // the whole group being moved (includes id)
  page: number;
  target: string | null;
  place: "before" | "after";
  numbers: Map<string, number> | null;
  affected: Set<string>;
  x: number;
  y: number;
  label: string;
}

interface DragStore {
  drag: DragState | null;
  start: (id: string, page: number, label: string, x: number, y: number, ids?: string[]) => void;
  update: (x: number, y: number, target: string | null, place: "before" | "after", blocks: Block[]) => void;
  end: () => DragState | null;
}

export const useDrag = create<DragStore>((set, get) => ({
  drag: null,
  start: (id, page, label, x, y, ids) =>
    set({ drag: { id, ids: ids && ids.length ? ids : [id], page, target: null, place: "before", numbers: null, affected: new Set(), x, y, label } }),
  update: (x, y, target, place, blocks) => {
    const d = get().drag;
    if (!d) return;
    if (target && !d.ids.includes(target)) {
      const p = previewMove(blocks, d.ids, target, place);
      set({ drag: { ...d, x, y, target, place, numbers: p.numbers, affected: p.affected } });
    } else {
      set({ drag: { ...d, x, y, target: null, numbers: null, affected: new Set() } });
    }
  },
  end: () => {
    const d = get().drag;
    set({ drag: null });
    return d;
  },
}));

/** Find the block element under a point within a pane. */
export function hitBlock(x: number, y: number, pane: string): { id: string; el: HTMLElement } | null {
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    const h = (el as HTMLElement).closest?.(`[data-pane="${pane}"][data-block]`) as HTMLElement | null;
    if (h) return { id: h.dataset.block!, el: h };
  }
  return null;
}

/** Do these two blocks sit side by side on the page? Then "before" means left,
 * not above — dropping onto the right half of a neighbouring column has to mean
 * what it looks like it means. */
export function sameRow(a: Block | undefined, b: Block | undefined): boolean {
  if (!a?.bbox || !b?.bbox) return false;
  const overlap = Math.min(a.bbox[3], b.bbox[3]) - Math.max(a.bbox[1], b.bbox[1]);
  return overlap > 0.5 * Math.min(a.bbox[3] - a.bbox[1], b.bbox[3] - b.bbox[1]);
}

/** What a block's number badge shows and how it is ringed — identical in both
 * panes, and it was wrong in one of them every time it changed. */
export function badgeState(b: Block, drag: DragState | null, selected: boolean) {
  return {
    label: drag?.numbers?.get(b.id) ?? b.n ?? "—", // a deleted block has no number
    ring: drag?.affected.has(b.id) ? "ring-2 ring-amber-400" : selected ? "ring-2 ring-blue-400" : "",
    dim: b.hidden ? "opacity-60" : "",
  };
}

/**
 * Press a block (its box on the page, or its number in the panel): move past
 * the threshold and you are dragging it — with the whole selection, if it is in
 * one — and the page renumbers under the pointer. Let go without moving and it
 * is a click, which selects.
 *
 * One hook for both panes. They differ in two details and used to differ in
 * fifty lines, so a fix to the gesture reached whichever pane the person who
 * made it happened to be looking at.
 */
export function useBlockDrag(pane: "pdf" | "md", page: Page) {
  const select = useStore((s) => s.select);
  const selectFrom = useStore((s) => s.selectFrom);
  const moveBlock = useStore((s) => s.moveBlock);
  const other = pane === "pdf" ? "md" : "pdf";
  return useCallback(
    (e: React.PointerEvent, b: Block) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault(); // no text selection, no native drag of the page image
      const startX = e.clientX;
      const startY = e.clientY;
      // the modifiers as they were when the press began, not when it ended
      const mods = { shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey };
      const held = mods.shiftKey || mods.metaKey || mods.ctrlKey;
      let dragging = false;
      // dragging a selected block drags the whole selected group
      const cur = useStore.getState().selected;
      const group = cur.includes(b.id) && cur.length > 1 ? cur : [b.id];
      const onMove = (ev: PointerEvent) => {
        if (held) return; // a modifier means this press is about the selection
        if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) {
          dragging = true;
          const label = group.length > 1 ? `${group.length} blocks` : b.n ? `#${b.n}` : "a deleted block";
          useDrag.getState().start(b.id, page.n, label, ev.clientX, ev.clientY, group);
          if (group.length === 1) select(b.id);
          document.body.style.cursor = "grabbing";
        }
        if (!dragging) return;
        const hit = hitBlock(ev.clientX, ev.clientY, pane);
        let target: string | null = null;
        let place: "before" | "after" = "before";
        if (hit && !group.includes(hit.id) && page.blocks.some((x) => x.id === hit.id)) {
          target = hit.id;
          const r = hit.el.getBoundingClientRect();
          // side by side on the page: left/right. Stacked (and every row in the
          // panel is stacked, whatever the page does): above/below.
          place =
            pane === "pdf" && sameRow(page.blocks.find((x) => x.id === hit.id), b)
              ? ev.clientX < r.left + r.width / 2
                ? "before"
                : "after"
              : ev.clientY < r.top + r.height / 2
                ? "before"
                : "after";
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
        } else {
          selectFrom(mods, b.id, other);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [pane, other, page.blocks, page.n, select, selectFrom, moveBlock],
  );
}
