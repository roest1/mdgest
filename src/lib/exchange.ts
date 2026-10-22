/** A document as an export's `mdgest.json` carries it, and back.
 *
 * In the browser each document keeps its own `edits.json`; an export
 * gathers them into the one manifest, an entry per document:
 *
 *     "invoices/a": {
 *       "sha256": "…",      the source the decisions were made on
 *       "reader": 1,        the reader whose blocks they are keyed to
 *       "done": true,
 *       "edits": { … },
 *       "check": "…"        SHA-256 of the entry without this field
 *     }
 *
 * An entry with no decisions is its hash and its check alone.
 *
 * This slice is what the stage needs of it: the names of the fields that
 * are decisions, so a source being replaced can shed them. Packing an entry
 * from a document's own files, checking one, and taking decisions back out
 * come with the editor, and belong here beside it.
 *
 * Pure, and run in the worker on both sides. */

import type { DocEntry } from "./workspace";

/** An entry with its decisions taken out: what stays of one whose source
 *  is being replaced. Anything else an entry carries is kept, as
 *  `parseManifest` promises. */
export function bare(entry: DocEntry): DocEntry {
  const { edits: _e, done: _d, reader: _r, check: _c, ...rest } = entry;
  return rest;
}
