/** The editor's state that more than one pane reads.
 *
 * Not persisted: a reload reads the open document again from the engine's
 * cache. The page pane produces a document's reading, and the markdown pane
 * shows it. */

import { create } from "zustand";
import type { Analysis } from "./analysis";
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

/** Where a document's reading stands. `reading` counts pages as they are
 *  read; `ready` carries the analysis and the markdown emitted from it --
 *  the same text the engine wrote to the workspace. */
export type Reading =
  | { status: "reading"; page: number; pages: number }
  | { status: "ready"; analysis: Analysis; markdown: Markdown }
  | { status: "failed"; problem: string };

interface EditorState {
  readings: ById<Reading>;
  /** Set, or with undefined forget, a document's reading. */
  setReading: (docId: string, reading: Reading | undefined) => void;
}

export const useEditor = create<EditorState>()((set) => ({
  readings: byId(),
  setReading: (docId, reading) =>
    set((s) => {
      const readings = byId(s.readings);
      if (reading) readings[docId] = reading;
      else delete readings[docId];
      return { readings };
    }),
}));
