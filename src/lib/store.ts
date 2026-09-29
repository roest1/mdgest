/** The editor's state that more than one pane reads.
 *
 * Not persisted: a reload starts from the default view, reads the open
 * document again from the engine's cache, and selects nothing. The page
 * pane produces a document's reading, and both panes draw the selection. */

import { create } from "zustand";
import type { Analysis } from "./analysis";
import type { Markdown } from "./emit";

/** How the markdown pane shows its document: typeset, or as source. */
export type View = "rendered" | "raw";

/** Which blocks the page pane draws a box around: text, images, either or
 *  neither. Selection is drawn either way; this is the gray hairline on the
 *  rest. */
export interface Boxes {
  text: boolean;
  images: boolean;
}

/** Where a document's reading stands. `reading` counts pages as they are
 *  read; `ready` carries the analysis and the markdown emitted from it, the
 *  same text the engine wrote to the workspace. */
export type Reading =
  | { status: "reading"; page: number; pages: number }
  | { status: "ready"; analysis: Analysis; markdown: Markdown }
  | { status: "failed"; problem: string };

/** Which pane a selection was made in. The other one follows it into view;
 *  the one it was made in does not move under the pointer. */
export type Side = "page" | "markdown";

export interface Selection {
  docId: string;
  /** Selected block ids, in document order. */
  ids: string[];
  /** The block clicked last: what the other pane scrolls to, and where a
   *  shift-click ranges from. */
  focus: string;
  /** Where a shift-click ranges from: the last block picked without shift. */
  anchor: string;
  from: Side;
}

/** The keys held while clicking: shift extends a range from the anchor,
 *  ctrl or cmd toggles the one block. */
export interface Modifiers {
  range: boolean;
  toggle: boolean;
}

/** The keys held on a click, as `pick` reads them -- the one translation
 *  both panes click through. */
export function modifiers(e: {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): Modifiers {
  return { range: e.shiftKey, toggle: e.ctrlKey || e.metaKey };
}

interface Editor {
  view: View;
  setView: (view: View) => void;
  boxes: Boxes;
  setBoxes: (boxes: Partial<Boxes>) => void;
  /** Whether the page pane shows every block's index on a note. */
  notes: boolean;
  setNotes: (notes: boolean) => void;
  /** Which step of the walkthrough is showing, or null when it is not. */
  tour: number | null;
  setTour: (step: number | null) => void;

  readings: Record<string, Reading>;
  /** Set, or with undefined forget, a document's reading. */
  setReading: (docId: string, reading: Reading | undefined) => void;

  selection: Selection | null;
  /** Click on block `id` of `docId` in the pane `from`. */
  pick: (docId: string, id: string, modifiers: Modifiers, from: Side) => void;
  deselect: () => void;
}

export const useEditor = create<Editor>((set, get) => ({
  view: "rendered",
  setView: (view) => set({ view }),
  boxes: { text: true, images: true },
  setBoxes: (boxes) => set((s) => ({ boxes: { ...s.boxes, ...boxes } })),
  notes: true,
  setNotes: (notes) => set({ notes }),
  tour: null,
  setTour: (tour) => set({ tour }),

  readings: {},
  setReading: (docId, reading) =>
    set((s) => {
      const readings = { ...s.readings };
      if (reading) readings[docId] = reading;
      else delete readings[docId];
      return { readings };
    }),

  selection: null,
  pick: (docId, id, { range, toggle }, from) => {
    const { selection, readings } = get();
    const reading = readings[docId];
    const order = reading?.status === "ready" ? reading.markdown.order : [];
    const same = selection?.docId === docId ? selection : null;

    if (range && same) {
      // The anchor's block to this one, whichever way round, in the order
      // they were written -- which is the order across pages too.
      const a = order.indexOf(same.anchor);
      const b = order.indexOf(id);
      if (a >= 0 && b >= 0) {
        const ids = order.slice(Math.min(a, b), Math.max(a, b) + 1);
        return set({ selection: { docId, ids, focus: id, anchor: same.anchor, from } });
      }
    }
    if (toggle && same) {
      const ids = same.ids.includes(id)
        ? same.ids.filter((x) => x !== id)
        : order.filter((x) => x === id || same.ids.includes(x));
      if (ids.length === 0) return set({ selection: null });
      return set({ selection: { docId, ids, focus: id, anchor: id, from } });
    }
    set({ selection: { docId, ids: [id], focus: id, anchor: id, from } });
  },
  deselect: () => set({ selection: null }),
}));
