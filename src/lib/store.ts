/** The editor's state that more than one pane reads.
 *
 * Not persisted: a reload starts from the default view, reads the open
 * document again from the engine's cache, and selects nothing. The page
 * pane produces a document's reading, and both panes draw the selection. */

import { create } from "zustand";
import type { Analysis } from "./analysis";
import type { Edits } from "./edits";
import type { Markdown } from "./emit";

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
 *  read; `ready` carries the analysis, a person's edits to it, and the
 *  markdown emitted from the two -- the same text the engine wrote to the
 *  workspace. `unsaved` says why the last edits did not reach it. */
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

/** The markdown open as text: what has been written, and the source it
 *  was opened on, which it is matched against when it is applied. */
export interface Draft {
  text: string;
  base: Markdown;
}

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

/** A block being divided, and where its cuts stand: `cuts` holds the
 *  word each one goes before, in order, as `divide.ts` counts the
 *  block's words. */
export interface Dividing {
  docId: string;
  id: string;
  cuts: number[];
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

/** Whether a plain click landed off every block -- on a pane's background
 *  or a page's bare paper -- rather than ending a drag that selected text.
 *  Both panes clear the selection on one. */
export function offBlocks(e: {
  target: EventTarget;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  if (e.shiftKey || e.ctrlKey || e.metaKey) return false;
  if (!(e.target instanceof Element) || e.target.closest("[data-block]")) return false;
  return window.getSelection()?.isCollapsed ?? true;
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

  readings: ById<Reading>;
  /** Set, or with undefined forget, a document's reading. */
  setReading: (docId: string, reading: Reading | undefined) => void;
  /** How many times each document has been sent back to be read again --
   *  by a revert -- since the page loaded. The page pane reads it once
   *  more whenever this moves. */
  rereads: ById<number>;
  reread: (docId: string) => void;

  /** Which documents are done, for the explorer. A document's own reading
   *  carries the same in its edits; this is the workspace's list. */
  done: ById<boolean>;
  setDone: (docId: string, done: boolean) => void;

  selection: Selection | null;
  /** The block being divided on the page -- the one selected, while its
   *  cut cursor is out -- and the cuts placed in it so far. Any change of
   *  selection puts the cursor away.
   *
   * The cuts are held here rather than in the cursor because the pages
   * pane draws only what is near the view: scrolling the block a screen
   * away takes the cursor down, and what a person has placed in it has to
   * outlive that and be there when they scroll back. */
  dividing: Dividing | null;
  setDividing: (dividing: Dividing | null) => void;
  /** A cut placed before word `k` of the block being divided, or taken
   *  away again when one is already there. */
  toggleCut: (k: number) => void;
  /** Each document whose markdown is open as a draft: the text written so
   *  far and the source it was opened on. Kept here, not in the pane, so a
   *  draft outlives a switch to another document. Until it is applied or
   *  cancelled nothing else edits that document: the draft is applied to
   *  the edits it was made from. */
  drafts: ById<Draft>;
  setDraft: (docId: string, draft: Draft | null) => void;
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

  readings: byId(),
  setReading: (docId, reading) =>
    set((s) => {
      const readings = byId(s.readings);
      if (reading) readings[docId] = reading;
      else delete readings[docId];
      return { readings };
    }),
  rereads: byId(),
  reread: (docId) =>
    set((s) => {
      const rereads = byId(s.rereads);
      rereads[docId] = (rereads[docId] ?? 0) + 1;
      return { rereads };
    }),

  done: byId(),
  setDone: (docId, done) =>
    set((s) => {
      const marks = byId(s.done);
      marks[docId] = done;
      return { done: marks };
    }),

  selection: null,
  dividing: null,
  setDividing: (dividing) => set({ dividing }),
  toggleCut: (k) =>
    set((s) => {
      if (!s.dividing) return {};
      const had = s.dividing.cuts;
      const cuts = had.includes(k) ? had.filter((x) => x !== k) : [...had, k].sort((a, b) => a - b);
      return { dividing: { ...s.dividing, cuts } };
    }),
  drafts: byId(),
  setDraft: (docId, draft) =>
    set((s) => {
      const drafts = byId(s.drafts);
      if (draft) drafts[docId] = draft;
      else delete drafts[docId];
      return { drafts };
    }),
  pick: (docId, picked, { range, toggle }, from) => {
    if (get().dividing) set({ dividing: null });
    const { selection, readings } = get();
    const reading = readings[docId];
    const order = reading?.status === "ready" ? reading.markdown.order : [];
    // A block joined onto another is picked as the block it is now part of.
    const id = (reading?.status === "ready" && reading.markdown.blocks[picked]?.joined) || picked;
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
    // A plain click on the one block selected lets it go.
    if (!range && !toggle && same?.ids.length === 1 && same.ids[0] === id)
      return set({ selection: null });
    set({ selection: { docId, ids: [id], focus: id, anchor: id, from } });
  },
  deselect: () => set({ selection: null, dividing: null }),
}));
