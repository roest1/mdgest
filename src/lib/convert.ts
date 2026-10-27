/** Getting a document read: from the engine's cache when it has been read
 *  before, off its pages otherwise, and kept for the next visit.
 *
 * Reading runs where the document is open, on the page, since pdf.js has it
 * there already; the engine keeps what comes out. One reading per opening
 * of a document at a time: a second ask while it runs joins it. */

import { READER, UNUSABLE_ANALYSIS, type Analysis } from "./analysis";
import { emit, type Markdown } from "./emit";
import { engine } from "./engine";
import type { PDFPageProxy } from "./pdf";
import type { Figure } from "./protocol";
import { readPage } from "./read";
import { structure, type ReadPage } from "./structure";
import { assetsPrefix } from "./workspace";

export interface Converted {
  analysis: Analysis;
  markdown: Markdown;
}

type Hear = (page: number, pages: number) => void;

/** A reading under way: the pages it reads, and everyone listening. */
interface Running {
  pages: PDFPageProxy[];
  job: Promise<Converted>;
  hear: Set<Hear>;
}

const running = new Map<string, Running>();

/** `docId` read: its stored analysis, or its `pages` read and kept when
 *  there is none. `onPage` hears each page as it is read -- never, when the
 *  analysis was stored. An ask while a reading of the same `pages` is under
 *  way joins it, and hears its pages too; an ask with other pages -- the
 *  document opened again -- is a reading of its own, since the first's
 *  pages may be destroyed under it. */
export function convert(
  docId: string,
  pages: PDFPageProxy[],
  onPage?: Hear,
): Promise<Converted> {
  let now = running.get(docId);
  if (now?.pages !== pages) {
    const hear = new Set<Hear>();
    const job: Promise<Converted> = run(docId, pages, (page, of) => {
      for (const h of hear) h(page, of);
    }).finally(() => {
      if (running.get(docId)?.job === job) running.delete(docId);
    });
    now = { pages, job, hear };
    running.set(docId, now);
  }
  if (onPage) now.hear.add(onPage);
  return now.job;
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
  onPage?: (page: number, pages: number) => void,
): Promise<Converted> {
  let analysis = await engine.analysis(docId).catch(rereadable);
  // One an older reader made is read again, the way a `READER` bump says:
  // its blocks may not be this reader's. Nothing is lost while there are no
  // edits; once there are, the edits' feature asks before dropping them.
  if (analysis && analysis.reader !== READER) analysis = null;
  if (!analysis) {
    const read: ReadPage[] = [];
    const figures: Figure[] = [];
    for (const [i, page] of pages.entries()) {
      const result = await readPage(page);
      read.push(result.page);
      figures.push(...result.figures);
      onPage?.(i + 1, pages.length);
    }
    analysis = structure(read);
    await engine.convert(docId, analysis, figures);
  }
  return { analysis, markdown: emit(analysis, assetsPrefix(docId)) };
}
