/** Making edits: to the document on screen at once, and to the workspace
 *  after. There is no save -- every edit is written as it is made.
 *
 * The walkthrough's example is edited in memory alone, like the rest of
 * it: it is not the person's document and is kept nowhere. */

import type { Block } from "./analysis";
import { apply, join, redo, undo, unjoin, type Change, type Edits, type Shaped } from "./edits";
import { emit } from "./emit";
import { engine } from "./engine";
import { useEditor } from "./store";
import { isTourDoc } from "./tour-doc";
import { messageOf } from "./words";
import { assetsPrefix } from "./workspace";

/** Put `next` on screen and in the workspace, when it differs from what is
 *  there. A document marked done takes no edits until it is reopened --
 *  `setDone` alone passes `unlocked`. */
function commit(docId: string, next: (edits: Edits) => Edits, unlocked = false): void {
  const { readings, setReading } = useEditor.getState();
  const reading = readings[docId];
  if (reading?.status !== "ready") return;
  if (reading.edits.done && !unlocked) return;
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

export function undoEdit(docId: string) {
  commit(docId, undo);
}

export function redoEdit(docId: string) {
  commit(docId, redo);
}
