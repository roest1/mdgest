/** Getting a document read: from the engine's cache when it has been read
 *  before, off its pages otherwise, and into the store for the panes.
 *
 * Reading runs where the document is open -- the page pane's -- and one
 * reading per document at a time: a second pane asking joins the first.
 * The engine keeps what comes out, so the next visit skips the pages. */

import type { Analysis } from "./analysis";
import { seedAsset } from "./assets";
import { blankEdits, type Edits } from "./edits";
import { emit } from "./emit";
import { engine } from "./engine";
import type { PDFPageProxy } from "./pdf";
import type { Figure } from "./protocol";
import { readPage } from "./read";
import { useEditor, type Reading } from "./store";
import { structure, type ReadPage } from "./structure";
import { isTourDoc } from "./tour-doc";
import { messageOf } from "./words";
import { assetsPrefix } from "./workspace";

interface Job {
  canceled: boolean;
}

const jobs = new Map<string, Job>();

/** Have `docId` read, from its `pages` if the engine has no analysis for
 *  it, and its reading put in the store. Returns a function that gives up
 *  on a reading still in progress -- for when the document closes under
 *  it -- and forgets what was shown of it. */
export function ensureRead(docId: string, pages: PDFPageProxy[]): () => void {
  const running = jobs.get(docId);
  if (running && !running.canceled) return () => cancel(docId, running);
  const job: Job = { canceled: false };
  jobs.set(docId, job);
  void run(docId, pages, job).finally(() => {
    if (jobs.get(docId) === job) jobs.delete(docId);
  });
  return () => cancel(docId, job);
}

function cancel(docId: string, job: Job): void {
  if (job.canceled) return;
  job.canceled = true;
  const { readings, setReading } = useEditor.getState();
  if (readings[docId]?.status === "reading") setReading(docId, undefined);
}

async function run(docId: string, pages: PDFPageProxy[], job: Job): Promise<void> {
  const publish = (reading: Reading) => {
    if (!job.canceled) useEditor.getState().setReading(docId, reading);
  };
  const current = useEditor.getState().readings[docId];
  if (current?.status === "ready") return;

  try {
    publish({ status: "reading", page: 0, pages: pages.length });
    // The walkthrough's example is read every time and kept nowhere: it
    // is not the person's document, and it is two pages.
    let analysis: Analysis | null = isTourDoc(docId) ? null : await engine.analysis(docId);
    if (job.canceled) return;

    // The worker reads the cached edits either way: `convert` answers them
    // with the write, so a fresh read asks no second round trip for them.
    let edits: Edits | null = null;
    if (!analysis) {
      const read: ReadPage[] = [];
      const figures: Figure[] = [];
      for (const [i, page] of pages.entries()) {
        publish({ status: "reading", page: i + 1, pages: pages.length });
        const result = await readPage(page);
        if (job.canceled) return;
        read.push(result.page);
        figures.push(...result.figures);
      }
      analysis = structure(read);
      // The page keeps a copy of each figure to show, since the buffers
      // themselves go to the engine.
      for (const { name, bytes } of figures) seedAsset(docId, name, bytes);
      if (!isTourDoc(docId)) edits = await engine.convert(docId, analysis, figures);
      if (job.canceled) return;
    } else {
      edits = isTourDoc(docId) ? null : await engine.edits(docId);
      if (job.canceled) return;
    }
    const made = edits ?? blankEdits();
    publish({
      status: "ready",
      analysis,
      edits: made,
      markdown: emit(analysis, assetsPrefix(docId), made),
    });
  } catch (cause) {
    publish({ status: "failed", problem: `This document could not be read (${messageOf(cause)}).` });
  }
}
