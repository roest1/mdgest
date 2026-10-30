/** Getting a document read: from the engine's cache when it has been read
 *  before, off its pages otherwise, and kept for the next visit.
 *
 * Reading runs where the document is open, on the page, since pdf.js has it
 * there already; the engine keeps what comes out. One reading of a document
 * at a time: a second ask while it runs joins it, and the pages it reads
 * stay open until it has read the last of them (`readDone`), so a pane that
 * unmounts under it -- its tab switched away from -- does not take them with
 * it. Only that long: writing the reading down needs no page, and can wait
 * on the workspace, so a switched-away document is not held in memory for
 * that. The panes
 * see it through the store (`ensureRead`); its tab closing gives it up
 * (`forgetReading`). */

import { READER, UNUSABLE_ANALYSIS, type Analysis } from "./analysis";
import { emit, type Markdown } from "./emit";
import { engine } from "./engine";
import type { PDFPageProxy } from "./pdf";
import type { Figure } from "./protocol";
import { readPage } from "./read";
import { structure, type ReadPage } from "./structure";
import { useEditor, type Reading } from "./store";
import { messageOf } from "./words";
import { assetsPrefix } from "./workspace";

export interface Converted {
  analysis: Analysis;
  markdown: Markdown;
}

type Hear = (page: number, pages: number) => void;

/** A reading under way: everyone listening, and whether it has been given
 *  up. A given-up reading stops at the next page and is joined by no one,
 *  but stays here until it has stopped, so `readDone` can wait on it. */
interface Running {
  job: Promise<Converted>;
  /** Settled once the reading is off its pages: the last of them read, or
   *  none needed, or the reading over however it ended. */
  offPages: Promise<void>;
  hear: Set<Hear>;
  canceled: boolean;
}

const running = new Map<string, Running>();

/** What a given-up reading ends with: not a failure of the document. */
export const CANCELED = "ReadingCanceled";

function canceled(): Error {
  const error = new Error("The reading was given up.");
  error.name = CANCELED;
  return error;
}

/** `docId` read: its stored analysis, or its `pages` read and kept when
 *  there is none. `onPage` hears each page as it is read -- never, when the
 *  analysis was stored. An ask while a reading is under way joins it, and
 *  hears its pages too, whichever pages it was asked with: the reading's
 *  own are kept open until it has read them. */
export function convert(
  docId: string,
  pages: PDFPageProxy[],
  onPage?: Hear,
): Promise<Converted> {
  const now = reading(docId, pages);
  if (onPage) now.hear.add(onPage);
  return now.job;
}

/** The reading of `docId` under way, started on `pages` when none is, or
 *  the one going has been given up. */
function reading(docId: string, pages: PDFPageProxy[]): Running {
  let now = running.get(docId);
  if (!now || now.canceled) {
    const hear = new Set<Hear>();
    let off!: () => void;
    const offPages = new Promise<void>((r) => (off = r));
    const mine = { hear, canceled: false, offPages } as Running;
    mine.job = run(docId, pages, mine, off, (page, of) => {
      for (const h of hear) h(page, of);
    });
    void mine.job.then(noop, noop).then(() => {
      off(); // Over without reading them all: given up, failed, or cached.
      if (running.get(docId) === mine) running.delete(docId);
    });
    now = mine;
    running.set(docId, now);
  }
  return now;
}

const noop = () => {};

/** Settled once no reading of `docId` is on its pages -- at once, when
 *  none is; when one is, once it has read the last of them, not once it is
 *  written down: the write needs no page, and may wait on the workspace
 *  lock. For whoever holds the pages a reading is on: they are destroyed
 *  after this, not before. */
export function readDone(docId: string): Promise<void> {
  const now = running.get(docId);
  return now ? now.offPages : Promise.resolve();
}

/** A stored analysis this build cannot use is no analysis: it holds no
 *  decisions and is regenerable from the PDF, so the document is read again
 *  rather than left as a file a person can neither see nor repair. Only
 *  that: a failure of the engine itself -- OPFS, the worker -- is real and
 *  stays thrown. */
function rereadable(cause: unknown): null {
  if (cause instanceof Error && cause.name === UNUSABLE_ANALYSIS) return null;
  throw cause;
}

async function run(
  docId: string,
  pages: PDFPageProxy[],
  job: { canceled: boolean },
  offPages: () => void,
  onPage?: (page: number, pages: number) => void,
): Promise<Converted> {
  let analysis = await engine.analysis(docId).catch(rereadable);
  if (job.canceled) throw canceled();
  // One an older reader made is read again, the way a `READER` bump says:
  // its blocks may not be this reader's. Nothing is lost while there are no
  // edits; once there are, the edits' feature asks before dropping them.
  if (analysis && analysis.reader !== READER) analysis = null;
  if (!analysis) {
    const read: ReadPage[] = [];
    const figures: Figure[] = [];
    for (const [i, page] of pages.entries()) {
      const result = await readPage(page);
      if (job.canceled) throw canceled();
      read.push(result.page);
      figures.push(...result.figures);
      onPage?.(i + 1, pages.length);
    }
    offPages();
    analysis = structure(read);
    await engine.convert(docId, analysis, figures);
    // Given up under the write: it is in the cache, where the next reading
    // finds it, but this one shows nothing of it.
    if (job.canceled) throw canceled();
  }
  return { analysis, markdown: emit(analysis, assetsPrefix(docId)) };
}

/** Have `docId` read for the panes, its reading kept in the store as it
 *  goes: page by page, then ready, or failed and why. Nothing to do when it
 *  is ready already, or a reading is going -- the pane mounted again after
 *  a tab switch finds it where the last one left it. The store hears the
 *  reading only until `forgetReading` gives it up: whatever a given-up
 *  reading ends with is its own, not the store's -- the document may be
 *  open again by then, on a reading of its own. */
export function ensureRead(docId: string, pages: PDFPageProxy[]): void {
  const state = useEditor.getState;
  const now = running.get(docId);
  if (state().readings[docId]?.status === "ready" || (now && !now.canceled))
    return;
  const mine = reading(docId, pages);
  const publish = (reading: Reading) => {
    if (!mine.canceled) state().setReading(docId, reading);
  };
  state().setReading(docId, {
    status: "reading",
    page: 0,
    pages: pages.length,
  });
  mine.hear.add((page, of) => publish({ status: "reading", page, pages: of }));
  mine.job.then(
    ({ analysis, markdown }) =>
      publish({ status: "ready", analysis, markdown }),
    (cause: unknown) => {
      if (cause instanceof Error && cause.name === CANCELED) return;
      publish({
        status: "failed",
        problem: `This document could not be read (${messageOf(cause)}).`,
      });
    },
  );
}

/** Give up on `docId`: a reading still going stops at the next page, or
 *  ends unshown if it was already being written down, and what the store
 *  shows of the document is forgotten. For when the document leaves the
 *  editor -- its tab closed. The next `ensureRead` reads afresh, or from
 *  the engine's cache if a reading had finished or got as far as the write. */
export function forgetReading(docId: string): void {
  const now = running.get(docId);
  if (now) now.canceled = true;
  useEditor.getState().setReading(docId, undefined);
}
