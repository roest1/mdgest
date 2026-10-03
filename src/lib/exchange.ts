/** A document as an export's `mdgest.json` carries it, and back.
 *
 * In the browser each document keeps its own `edits.json`; an export
 * gathers them into the one manifest, an entry per document:
 *
 *     "invoices/a": {
 *       "sha256": "…",      the source the decisions were made on
 *       "reader": 1,        the reader whose blocks they are keyed to
 *       "done": true,
 *       "edits": { "blocks": {…}, "joins": {…} },
 *       "check": "…"        SHA-256 of the entry without this field
 *     }
 *
 * An entry with no decisions is its hash and its check alone. Undo and redo
 * stay behind: they are the shape of one sitting, not decisions.
 *
 * The check is not a lock -- the file is a person's, on their disk -- but it
 * is how an import tells an entry someone changed by hand from one an export
 * wrote, and asks before trusting it. Each entry is checked on its own, so
 * a damaged one costs that document its decisions and nothing else.
 *
 * Pure, and run in the worker on both sides. */

import { READER } from "./analysis";
import { checkEdits, EDITS_VERSION, type Edits } from "./edits";
import { sha256 } from "./opfs";
import { messageOf } from "./words";
import type { DocEntry } from "./workspace";

/** The hex SHA-256 of an entry without its `check`, as JSON in the order
 *  its fields were written. */
async function checksum(entry: DocEntry): Promise<string> {
  const { check: _, ...rest } = entry;
  return sha256(new TextEncoder().encode(JSON.stringify(rest)));
}

/** An entry, checked, ready to write: `entry` with its `check` replaced. */
export async function sealed(entry: DocEntry): Promise<DocEntry> {
  const { check: _, ...rest } = entry;
  return { ...rest, check: await checksum(rest) };
}

/** A document's entry for an export, from its source's hash and, when it
 *  has any, its edits and the reader its analysis came from. */
export function entryFor(sha256: string, edits: Edits | null, reader: number): DocEntry {
  if (!edits) return { sha256 };
  const { version: _v, undo: _u, redo: _r, done, ...decisions } = edits;
  return {
    sha256,
    reader,
    ...(done ? { done: true } : {}),
    edits: decisions,
  };
}

/** An entry with its decisions taken out: what the browser's manifest keeps
 *  once they are in the document's `edits.json`, or once they are dropped. */
export function bare(entry: DocEntry): DocEntry {
  const { edits: _e, done: _d, reader: _r, check: _c, ...rest } = entry;
  return rest;
}

/** What an import makes of an entry. `edits` is what the document comes in
 *  with -- null to start it over -- and `reset` says why decisions it
 *  carried were dropped. `altered` is an entry whose check does not match:
 *  changed since it was exported, and asked about before commit. */
export interface Assessed {
  edits: Edits | null;
  altered: boolean;
  reset: string | null;
}

export async function assess(entry: DocEntry): Promise<Assessed> {
  const altered = typeof entry.check === "string" && entry.check !== (await checksum(entry));
  if (entry.edits === undefined) return { edits: null, altered, reset: null };
  if (entry.reader !== READER) {
    return {
      edits: null,
      altered,
      reset:
        typeof entry.reader === "number" && entry.reader > READER
          ? "its edits were made with a newer version of mdgest, so it starts over"
          : "its edits were made on another reader's blocks, so it starts over",
    };
  }
  const decisions = entry.edits;
  if (typeof decisions !== "object" || decisions === null || Array.isArray(decisions)) {
    return { edits: null, altered, reset: "its edits are not an object, so it starts over" };
  }
  try {
    const edits = checkEdits(
      { ...decisions, version: EDITS_VERSION, done: entry.done },
      "its entry",
    );
    if (!edits.done) delete edits.done;
    return { edits: { ...edits, undo: [], redo: [] }, altered, reset: null };
  } catch (cause) {
    return { edits: null, altered, reset: `${messageOf(cause).replace(/\.$/, "")}, so it starts over` };
  }
}
