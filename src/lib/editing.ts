/** Making edits: to the document on screen at once, and to the workspace
 *  after. There is no save -- every edit is kept as it is made.
 *
 * The screen does not wait on storage: an edit emits the markdown again and
 * shows it, and the engine writes `edits.json` and the markdown behind it.
 * Each save writes both files whole, and on a long book the markdown is
 * megabytes, so a quick run of edits is not a run of saves: while one is
 * being written, the edits after it wait as one, and only the newest is
 * written next. Nothing between the first and the last of the run needs to
 * be on disk, and the last is what is. */

import type { Edits } from "./edits";
import { emit } from "./emit";
import { engine } from "./engine";
import { actionsFor, hiding } from "./hiding";
import { useEditor } from "./store";
import { messageOf } from "./words";
import { assetsPrefix } from "./workspace";

/** A document's save in flight, and the newest edits waiting behind it. */
interface Saving {
  next: { edits: Edits; markdown: string } | null;
  /** Settled once nothing is left to write. */
  done: Promise<void>;
}

const saving = new Map<string, Saving>();

/** Make `next` of `docId`'s edits: shown at once, kept after. Nothing
 *  happens to a document not read yet, or when `next` hands back the edits
 *  it was given. */
export function commitEdits(
  docId: string,
  next: (edits: Edits) => Edits,
): void {
  const { readings, setReading } = useEditor.getState();
  const reading = readings[docId];
  if (reading?.status !== "ready") return;
  const edits = next(reading.edits);
  if (edits === reading.edits) return;
  const markdown = emit(reading.analysis, assetsPrefix(docId), edits);
  setReading(docId, { ...reading, edits, markdown });
  save(docId, edits, markdown.text);
}

/** Press one of the selection's two buttons: `hide` hides or shows it,
 *  `del` deletes or restores it, whichever the selection offers
 *  (`hiding.ts`). Nothing with
 *  nothing selected, or when the button is not offered. */
export function actOnSelection(button: "hide" | "del"): void {
  const { selection, readings } = useEditor.getState();
  if (!selection) return;
  const reading = readings[selection.docId];
  if (reading?.status !== "ready") return;
  const placed = reading.markdown.blocks;
  const offered = actionsFor(selection.ids, placed)?.[button];
  if (!offered) return;
  commitEdits(
    selection.docId,
    hiding(selection.ids, reading.analysis, placed, offered.action),
  );
}

/** Settled once every edit of `docId` made so far has been written, or has
 *  failed to be: what a test waits on, and what a tab closing would. */
export function saved(docId: string): Promise<void> {
  return saving.get(docId)?.done ?? Promise.resolve();
}

function save(docId: string, edits: Edits, markdown: string): void {
  const now = saving.get(docId);
  if (now) {
    // Behind the one being written: the newest takes the place of any
    // waiting already.
    now.next = { edits, markdown };
    return;
  }
  const mine: Saving = { next: { edits, markdown }, done: Promise.resolve() };
  saving.set(docId, mine);
  mine.done = (async () => {
    while (mine.next) {
      const { edits, markdown } = mine.next;
      mine.next = null;
      try {
        await engine.saveEdits(docId, edits, markdown);
        settle(docId, edits, undefined);
      } catch (cause) {
        settle(
          docId,
          edits,
          `Your last edit was not saved in this browser (${messageOf(cause)}).`,
        );
      }
    }
    saving.delete(docId);
  })();
}

/** Say how a save went, on the reading -- when the edits it wrote are still
 *  the ones shown. A later edit's save speaks for it. */
function settle(docId: string, edits: Edits, unsaved: string | undefined) {
  const { readings, setReading } = useEditor.getState();
  const reading = readings[docId];
  if (reading?.status !== "ready" || reading.edits !== edits) return;
  if (reading.unsaved === unsaved) return;
  setReading(docId, { ...reading, unsaved });
}
