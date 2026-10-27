/** Getting a document read: from the engine's cache when it has been read
 *  before, off its pages otherwise, and kept for the next visit.
 *
 * Reading runs where the document is open, on the page, since pdf.js has it
 * there already; the engine keeps what comes out. One reading per document
 * at a time: a second ask while one is running is answered by the first. */

import { UNUSABLE_ANALYSIS, type Analysis } from "./analysis";
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

const running = new Map<string, Promise<Converted>>();

/** `docId` read: its stored analysis, or its `pages` read and kept when
 *  there is none. `onPage` hears each page as it is read -- never, when the
 *  analysis was stored -- and only the first asker's is heard. */
export function convert(
  docId: string,
  pages: PDFPageProxy[],
  onPage?: (page: number, pages: number) => void,
): Promise<Converted> {
  const already = running.get(docId);
  if (already) return already;
  const job = run(docId, pages, onPage).finally(() => running.delete(docId));
  running.set(docId, job);
  return job;
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
