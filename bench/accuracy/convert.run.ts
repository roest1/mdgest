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
 *  A test only in that Vitest is what runs it in a browser; it asserts
 *  nothing about the reader. A document that cannot be read is written as
 *  empty markdown and named in `run.json`, and the scorer fails its tests. */

import { version } from "pdfjs-dist";
import { test } from "vitest";
import { READER } from "src/lib/analysis";
import { emit } from "src/lib/emit";
import { openPdf } from "src/lib/pdf";
import { readPage } from "src/lib/read";
import { structure, type ReadPage } from "src/lib/structure";
import { messageOf } from "src/lib/words";
import type { Job, MdgestRun } from "./job.ts";

/** What one document may take before it is given up on. */
const LIMIT = 120_000;

const get = (what: string, path = "") =>
  fetch(`/__bench/${what}?path=${encodeURIComponent(path)}`);
async function put(path: string, body: string) {
  const res = await fetch(`/__bench/out?path=${encodeURIComponent(path)}`, {
    method: "PUT",
    body,
  });
  if (!res.ok) throw new Error(`${path} was not written: ${await res.text()}`);
}

/** `file` without its `.pdf`: what its outputs are named after. */
const stem = (file: string) => file.replace(/\.pdf$/i, "");

interface Converted {
  markdown: string;
  /** The text layer, page after page, a form feed between them. */
  layer: string;
  pages: number;
  ms: number;
}

async function convert(
  file: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Converted> {
  const task = openPdf(bytes);
  let timer = 0;
  const limit = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
      () => reject(new Error(`not read in ${LIMIT / 1000}s`)),
      LIMIT,
    );
  });
  const work = (async () => {
    const t0 = performance.now();
    const pdf = await task.promise;
    const pages: ReadPage[] = [];
    for (let n = 1; n <= pdf.numPages; n++)
      pages.push((await readPage(await pdf.getPage(n))).page);
    // Figures are named as the app names them, under the document's own
    // assets folder; the pictures themselves are not kept.
    const name = stem(file).split("/").at(-1);
    const markdown = emit(structure(pages), `${name}.assets/`).text;
    const ms = performance.now() - t0;

    // After the reading and outside its time: asked for first, it would
    // change when the page's fonts load under the reader.
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
    return { markdown, layer: layer.join("\f"), pages: pdf.numPages, ms };
  })();
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
    // A reading given up on is still running; what it throws once its
    // document is gone is nobody's.
    work.catch(() => {});
    await task.destroy();
  }
}

test("convert", async () => {
  const job = (await (await get("job")).json()) as Job;
  const run: MdgestRun = { reader: READER, pdfjs: version, files: {} };
  for (const file of job.files) {
    const bytes = new Uint8Array(await (await get("pdf", file)).arrayBuffer());
    let markdown = "";
    try {
      const done = await convert(file, bytes);
      markdown = done.markdown;
      run.files[file] = { pages: done.pages, ms: done.ms };
      await put(`${stem(file)}.txt`, done.layer);
    } catch (cause) {
      run.files[file] = { pages: 0, ms: 0, error: messageOf(cause) };
    }
    await put(`${stem(file)}.md`, markdown);
  }
  await put("run.json", JSON.stringify(run));
});
