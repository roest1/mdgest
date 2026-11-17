/** The editor's state that more than one pane reads.
 *
 * Not persisted: a reload reads the open document again from the engine's
 * cache. The page pane produces a document's reading, and the markdown pane
 * shows it. */

import { create } from "zustand";
import type { Analysis } from "./analysis";
import type { Edits } from "./edits";
import type { Markdown } from "./emit";
import {
  lassoed,
  picked,
  type Modifiers,
  type Selection,
  type Side,
} from "./selection";

/** Anything the editor keys by document id, made without a prototype the
 *  way a manifest is (`workspace.ts`, `Manifest`). An id is a file name and
 *  `__proto__` is a legal one: on a plain object, writing that key replaces
 *  the object's prototype instead of adding an entry, and reading
 *  `constructor` finds what every object inherits. With no prototype every
 *  id is an ordinary key, for reads, writes and `in`. */
export type ById<T> = Record<string, T>;

/** A copy of `from` keyed by document id, or an empty one. */
export function byId<T>(from?: ById<T>): ById<T> {
  return Object.assign(Object.create(null) as ById<T>, from);
}

/** Which blocks the page pane draws a box around: text, images, either or
 *  neither. */
export interface Boxes {
  text: boolean;
  images: boolean;
}

/** Where a document's reading stands. `reading` counts pages as they are
 *  read; `ready` carries the analysis, the edits a person made to it, and
 *  the markdown emitted from both -- the same text the engine wrote to the
 *  workspace, or is about to (`editing.ts`). `unsaved` says why the last
 *  edit was not kept, until one is. */
export type Reading =
  | { status: "reading"; page: number; pages: number }
  | {
      status: "ready";
      analysis: Analysis;
      edits: Edits;
      markdown: Markdown;
      unsaved?: string;
    }
  | { status: "failed"; problem: string };

interface EditorState {
  readings: ById<Reading>;
  /** Set, or with undefined forget, a document's reading. */
  setReading: (docId: string, reading: Reading | undefined) => void;
  /** What the page pane draws over every document's pages: how the page is
   *  looked at, not edits to it, so one setting for the editor rather than
   *  one per document, kept across a switch of tab. */
  boxes: Boxes;
  setBoxes: (boxes: Partial<Boxes>) => void;
  /** Whether each block's number is shown on its box. */
  indices: boolean;
  setIndices: (indices: boolean) => void;
  /** The blocks selected, of one document at a time (`selection.ts`). A
   *  reading forgotten, or set on another analysis -- read again -- lets go
   *  of its document's selection: the ids are that analysis's. An edit
   *  keeps the analysis, and the selection with it. */
  selection: Selection | null;
  /** A click on block `id` of `docId` in the pane `from`. */
  pick: (docId: string, id: string, modifiers: Modifiers, from: Side) => void;
  /** A lasso over the blocks `hits` of `docId`: they become the selection,
   *  or are added to `base`, the selection as the lasso began. */
  lasso: (
    docId: string,
    hits: string[],
    base: Selection | null,
    from: Side,
  ) => void;
  deselect: () => void;
}

export const useEditor = create<EditorState>()((set, get) => ({
  readings: byId(),
  setReading: (docId, reading) =>
    set((s) => {
      const readings = byId(s.readings);
      if (reading) readings[docId] = reading;
      else delete readings[docId];
      const was = s.readings[docId];
      const same =
        reading?.status === "ready" &&
        was?.status === "ready" &&
        was.analysis === reading.analysis;
      const selection =
        s.selection?.docId === docId && !same ? null : s.selection;
      return { readings, selection };
    }),
  boxes: { text: true, images: true },
  setBoxes: (boxes) => set((s) => ({ boxes: { ...s.boxes, ...boxes } })),
  indices: true,
  setIndices: (indices) => set({ indices }),
  selection: null,
  pick: (docId, id, modifiers, from) => {
    const reading = get().readings[docId];
    if (reading?.status !== "ready") return;
    const { order, blocks } = reading.markdown;
    set({
      selection: picked(
        get().selection,
        docId,
        order,
        blocks,
        id,
        modifiers,
        from,
      ),
    });
  },
  lasso: (docId, hits, base, from) => {
    const reading = get().readings[docId];
    if (reading?.status !== "ready") return;
    const { order, blocks } = reading.markdown;
    set({ selection: lassoed(docId, order, blocks, hits, base, from) });
  },
  deselect: () => set({ selection: null }),
}));
