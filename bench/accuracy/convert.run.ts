/** The converter: every PDF of a job through the app's own reading path,
 *  the one `tests/reader.test.ts` runs -- pdf.js opens it, `readPage` reads
 *  each page, `structure` makes the blocks, `emit` writes the markdown --
 *  with nothing set that a person opening the document would not have. So
 *  what a benchmark scores is what the app shows.
 *
 *  Beside each document's markdown goes the text pdf.js finds in the PDF's
 *  own text layer, untouched by the reader: what `split.ts` holds against
 *  what the page should say, to tell a page that needs OCR from one that
 *  does not.
 *
 *  For the review report (`report.ts`) a job can also ask for each PDF's
 *  first page as a picture, with where the reader's blocks are on it.
 *
 *  A test only in that Vitest is what runs it in a browser; it asserts
 *  nothing about the reader. A document that cannot be read is written as
 *  empty markdown and named in the job's run file, and the scorer fails
 *  its tests. Its text layer is taken all the same, from the PDF opened
 *  again: what a PDF carries is not the reader's to lose. */

import { version, type PDFDocumentLoadingTask } from "pdfjs-dist";
import { test } from "vitest";
import { READER } from "src/lib/analysis";
import { emit } from "src/lib/emit";
import { openPdf } from "src/lib/pdf";
import { readPage } from "src/lib/read";
import { structure, type ReadPage } from "src/lib/structure";
import { messageOf } from "src/lib/words";
import { stem, type Drawn, type Job, type MdgestRun } from "./job.ts";

type Pdf = Awaited<PDFDocumentLoadingTask["promise"]>;

/** What one document may take before it is given up on. */
const LIMIT = 120_000;

/** A document given up on at `LIMIT`: not the reader's verdict on it but
 *  the clock's, which another machine reads differently. */
class GaveUp extends Error {
  constructor() {
    super(`not read in ${LIMIT / 1000}s`);
  }
}

/** `work`, or `GaveUp` once `LIMIT` has gone by. Work given up on is still
 *  running; what it throws once its document is gone is nobody's. */
function limited<T>(work: Promise<T>): Promise<T> {
  let timer = 0;
  const limit = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new GaveUp()), LIMIT);
  });
  work.catch(() => {});
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

const get = (what: string, path = "") =>
  fetch(`/__bench/${what}?path=${encodeURIComponent(path)}`);
async function put(path: string, body: string | Blob) {
  const res = await fetch(`/__bench/out?path=${encodeURIComponent(path)}`, {
    method: "PUT",
    body,
  });
  if (!res.ok) throw new Error(`${path} was not written: ${await res.text()}`);
}

interface Converted {
  markdown: string;
  /** The text layer, or null when it could not be taken after the
   *  reading. */
  layer: string | null;
  pages: number;
  ms: number;
  /** The first page, drawn, and the blocks on it, when asked for. */
  drawn?: { picture: Blob; blocks: Drawn };
}

/** How many pixels a point of the page is drawn at for the report. */
const DRAW_SCALE = 1.25;

/** The text pdf.js finds in `pdf`, page after page, a form feed between
 *  them. */
async function textLayer(pdf: Pdf): Promise<string> {
  const layer: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    layer.push(
      content.items
        .map((item) =>
          "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
        )
        .join(""),
    );
  }
  return layer.join("\f");
}

/** The text layer of a PDF whose reading failed or was given up on, from
 *  the PDF opened again. One pdf.js cannot open carries nothing it can
 *  read, and has none; one given up on is not known, and throws. */
async function layerAlone(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const task = openPdf(bytes);
  try {
    let pdf: Pdf;
    try {
      pdf = await limited(task.promise);
    } catch (cause) {
      if (cause instanceof GaveUp) throw cause;
      return "";
    }
    return await limited(textLayer(pdf));
  } finally {
    await task.destroy();
  }
}

async function convert(
  file: string,
  task: PDFDocumentLoadingTask,
  draw: boolean,
): Promise<Converted> {
  const t0 = performance.now();
  const pdf = await task.promise;
  const pages: ReadPage[] = [];
  for (let n = 1; n <= pdf.numPages; n++)
    pages.push((await readPage(await pdf.getPage(n))).page);
  // Figures are named as the app names them, under the document's own
  // assets folder; the pictures themselves are not kept.
  const name = stem(file).split("/").at(-1);
  const analysis = structure(pages);
  const written = emit(analysis, `${name}.assets/`);
  const markdown = written.text;
  const ms = performance.now() - t0;

  // After the reading and outside its time: asked for first, it would
  // change when the page's fonts load under the reader. One that fails
  // here is taken again by `layerAlone`, and the reading stands.
  let layer: string | null = null;
  try {
    layer = await textLayer(pdf);
  } catch {
    layer = null;
  }
  let drawn: Converted["drawn"];
  if (draw) {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: DRAW_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const picture = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("no picture"))),
        "image/jpeg",
        0.7,
      ),
    );
    const first = analysis.pages[0];
    drawn = {
      picture,
      blocks: {
        width: first.width,
        height: first.height,
        blocks: first.blocks.map((block) => ({
          n: written.blocks[block.id]?.n ?? 0,
          role: block.role,
          box: block.box,
        })),
      },
    };
  }
  return { markdown, layer, pages: pdf.numPages, ms, drawn };
}

test("convert", async () => {
  const job = (await (await get("job")).json()) as Job;
  const run: MdgestRun = { reader: READER, pdfjs: version, files: {} };
  for (const file of job.files) {
    // Asked for again for a second opening: pdf.js keeps the first.
    const bytes = async () =>
      new Uint8Array(await (await get("pdf", file)).arrayBuffer());
    let markdown = "";
    let layer: string | null = null;
    let drawn: Converted["drawn"];
    const task = openPdf(await bytes());
    try {
      const done = await limited(convert(file, task, !!job.draw));
      ({ markdown, layer, drawn } = done);
      run.files[file] = { pages: done.pages, ms: done.ms };
    } catch (cause) {
      run.files[file] = {
        pages: 0,
        ms: 0,
        error: messageOf(cause),
        ...(cause instanceof GaveUp ? { gaveUp: true } : {}),
      };
    } finally {
      await task.destroy();
    }
    if (layer === null) {
      try {
        layer = await layerAlone(await bytes());
      } catch (cause) {
        run.files[file].layer = messageOf(cause);
      }
    }
    await put(`${stem(file)}.txt`, layer ?? "");
    if (drawn) {
      await put(`${stem(file)}.jpg`, drawn.picture);
      await put(`${stem(file)}.blocks.json`, JSON.stringify(drawn.blocks));
    }
    await put(`${stem(file)}.md`, markdown);
  }
  await put(job.run, JSON.stringify(run));
});
