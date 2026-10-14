/** Making edits: to the document on screen at once, and to the workspace
 *  after. There is no save -- every edit is written as it is made.
 *
 * The walkthrough's example is edited in memory alone, like the rest of
 * it: it is not the person's document and is kept nowhere. */

import { READER, type Analysis, type Block } from "./analysis";
import { releaseAssets } from "./assets";
import {
  apply,
  isBlank,
  join,
  redo,
  restoreText,
  setCuts,
  setFurniture,
  undo,
  unjoin,
  type Change,
  type Edits,
  type Shaped,
} from "./edits";
import { emit, type Markdown } from "./emit";
import { engine } from "./engine";
import type { Choice, Furniture } from "./furniture";
import { applyDraft, type DraftResult } from "./draft";
import { useEditor } from "./store";
import { isTourDoc } from "./tour-doc";
import { messageOf } from "./words";
import { assetsPrefix } from "./workspace";

/** Put `next` on screen and in the workspace, when it differs from what is
 *  there. A document marked done takes no edits until it is reopened --
 *  `setDone` alone passes `unlocked`. */
function commit(docId: string, next: (edits: Edits) => Edits, unlocked = false): void {
  const { readings, setReading, drafting } = useEditor.getState();
  const reading = readings[docId];
  if (reading?.status !== "ready") return;
  if (reading.edits.done && !unlocked) return;
  // An open draft holds the document: it is applied to the edits it was
  // made from, so nothing else may change them in the meantime.
  if (drafting === docId && !unlocked) return;
  const edits = next(reading.edits);
  if (edits === reading.edits) return;
  const markdown = emit(reading.analysis, assetsPrefix(docId), edits);
  setReading(docId, { ...reading, edits, markdown });
  if (isTourDoc(docId)) return;

  engine.saveEdits(docId, edits, markdown.text).then(
    () => settle(docId, edits, undefined),
    (cause: unknown) =>
      settle(docId, edits, `Your last edit was not saved in this browser (${messageOf(cause)}).`),
  );
}

/** Record how a save went -- when the edits it wrote are still the ones
 *  shown. A later edit's save speaks for it. */
function settle(docId: string, edits: Edits, unsaved: string | undefined): void {
  const { readings, setReading } = useEditor.getState();
  const reading = readings[docId];
  if (reading?.status !== "ready" || reading.edits !== edits) return;
  if (reading.unsaved === unsaved) return;
  setReading(docId, { ...reading, unsaved });
}

/** Make `change` to every block in `blocks`, as one step undo takes back. */
export function editBlocks(docId: string, blocks: Block[], change: (block: Shaped) => Change) {
  commit(docId, (edits) => apply(edits, blocks, change));
}

/** Select `ids` of `docId`, in document order, when its selection is the
 *  one there is. */
function reselect(docId: string, ids: string[]) {
  const { selection, readings } = useEditor.getState();
  const reading = readings[docId];
  if (!selection || selection.docId !== docId || reading?.status !== "ready") return;
  const wanted = new Set(ids);
  const next = reading.markdown.order.filter((id) => wanted.has(id));
  if (next.length === 0) return;
  useEditor.setState({
    selection: { ...selection, ids: next, focus: next[0], anchor: next[0] },
  });
}

/** Join `ids` into one block, onto the first, as one step. What is left
 *  selected is the one block they make. */
export function joinBlocks(docId: string, ids: string[]) {
  commit(docId, (edits) => join(edits, ids));
  if (ids[0]) reselect(docId, [ids[0]]);
}

/** Divide block `id` -- or the piece of a block it is -- at `cuts`, word
 *  positions in the whole block, replacing the cuts it had: one step. What
 *  is left selected is every piece of it. */
export function divideBlock(docId: string, id: string, cuts: number[]) {
  commit(docId, (edits) => setCuts(edits, id, cuts));
  const reading = useEditor.getState().readings[docId];
  if (reading?.status !== "ready") return;
  const pieces = reading.markdown.order.filter((x) => x === id || x.startsWith(`${id}c`));
  reselect(docId, pieces);
}

/** What a draft of the markdown would make of the document's edits --
 *  `base`, the source it was opened on -- without making it: the edits and
 *  the text it inserts, or the problems in the way. */
export function readDraft(docId: string, base: Markdown, text: string): DraftResult {
  const reading = useEditor.getState().readings[docId];
  if (reading?.status !== "ready") return { problems: [{ line: 1, problem: "The document is still being read." }] };
  return applyDraft(reading.analysis, reading.edits, base, text);
}

/** Make the edits a draft came to, as the one step they are. The draft's
 *  own hold on the document is what this goes past. */
export function commitDraft(docId: string, edits: Edits) {
  commit(docId, () => edits, true);
}

/** Put the page's own words back on every corrected block of `ids`. */
export function restoreWording(docId: string, ids: string[]) {
  commit(docId, (edits) => restoreText(edits, ids));
}

/** Take apart every joined block headed by one of `ids`, as one step, and
 *  select every block they come apart into. */
export function unjoinBlocks(docId: string, ids: string[]) {
  const reading = useEditor.getState().readings[docId];
  if (reading?.status !== "ready") return;
  const heads = new Set(ids);
  const members = [
    ...ids,
    ...Object.entries(reading.edits.joins)
      .filter(([, head]) => heads.has(head))
      .map(([child]) => child),
  ];
  commit(docId, (edits) => unjoin(edits, ids));
  reselect(docId, members);
}

/** Mark a document done, or reopen it. Not an undo step: reopening is the
 *  way back. */
export function setDone(docId: string, done: boolean) {
  commit(
    docId,
    (edits) => {
      if (!!edits.done === done) return edits;
      const next: Edits = { ...edits, done };
      if (!done) delete next.done;
      return next;
    },
    true,
  );
  // The workspace's list, for the explorer. The example is not in the
  // workspace, and a check for it would outlive the tour.
  if (!isTourDoc(docId)) useEditor.getState().setDone(docId, done);
}

/** Keep, hide or delete one kind of the document's page furniture, as one
 *  step. */
export function setFurnitureEdit(docId: string, kind: Furniture, choice: Choice) {
  commit(docId, (edits) => setFurniture(edits, kind, choice));
}

export function undoEdit(docId: string) {
  commit(docId, undo);
}

export function redoEdit(docId: string) {
  commit(docId, redo);
}

/** What reverting a document would do, for the button that offers it:
 *
 * - `locked`: marked done, so it is reopened first;
 * - `current`: nothing to drop and nothing to gain -- no edits, and read by
 *   the current reader version, which would read it the same again;
 * - `refresh`: no edits, read by an older reader version: read again
 *   without asking, since nothing is lost;
 * - `revert`: edits to drop, so it asks first.
 *
 * `read` is the reader version the document's analysis was made by. */
export type Revert =
  | { kind: "locked" | "current" }
  | { kind: "refresh" | "revert"; read: number };

export function revertOf(analysis: Analysis, edits: Edits): Revert {
  if (edits.done) return { kind: "locked" };
  if (!isBlank(edits)) return { kind: "revert", read: analysis.reader };
  if (analysis.reader === READER) return { kind: "current" };
  return { kind: "refresh", read: analysis.reader };
}

/** Revert a document to its original: every edit dropped, and its PDF read
 *  again by the current reader version, as if it had just been added. Not an undo
 *  step -- undo lives in the `edits.json` this removes -- so the caller asks
 *  first. A document marked done is reopened before it can be reverted.
 *
 * The workspace goes first and the screen after: what is shown is never a
 * reading the workspace no longer has. The walkthrough's example is kept
 * nowhere, so for it there is only the screen. */
export async function revertToOriginal(docId: string): Promise<void> {
  const reading = useEditor.getState().readings[docId];
  if (reading?.status !== "ready" || reading.edits.done) return;
  let problem: string | undefined;
  if (!isTourDoc(docId)) {
    try {
      await engine.revert(docId);
    } catch (cause) {
      problem = messageOf(cause);
    }
  }
  const { selection, deselect, setReading, reread } = useEditor.getState();
  if (selection?.docId === docId) deselect();
  // A revert that stopped partway may have taken some files and not
  // others, so what is on screen can no longer be trusted either. A reload
  // reads the document again from whatever is left, which is consistent.
  if (problem !== undefined) {
    setReading(docId, {
      status: "failed",
      problem: `This document was not reverted (${problem}). Reload the page to open it again.`,
    });
    return;
  }
  setReading(docId, undefined);
  releaseAssets(docId);
  reread(docId);
}
