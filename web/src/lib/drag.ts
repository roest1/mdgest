import { create } from "zustand";
import { previewMove } from "./order";
import type { Block } from "../types";

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
