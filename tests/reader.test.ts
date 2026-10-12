/** Every reader case, through the app's own path: pdf.js opens the fixture,
 *  `readPage` reads each page, `structure` makes the blocks, and `emit`
 *  writes the markdown. Runs in a real browser, because `read.ts` draws
 *  figures into a canvas and pdf.js parses in a worker. */

import { version } from "pdfjs-dist";
import { describe, expect, test } from "vitest";
import { READ_WITH } from "src/lib/analysis";
import { emit } from "src/lib/emit";
import { openPdf } from "src/lib/pdf";
import { readPage } from "src/lib/read";
import { structure, type ReadPage } from "src/lib/structure";
import { cases } from "./cases";
import { summarize } from "./cases/case";
import { buildPdf } from "./fixtures/pdf";

async function convert(bytes: Uint8Array<ArrayBuffer>) {
  const task = openPdf(bytes);
  const pdf = await task.promise;
  try {
    const pages: ReadPage[] = [];
    for (let n = 1; n <= pdf.numPages; n++) pages.push((await readPage(await pdf.getPage(n))).page);
    const analysis = structure(pages);
    return { analysis, markdown: emit(analysis, "doc.assets/").text };
  } finally {
    await task.destroy();
  }
}

test("pdf.js is the version READER was checked against", () => {
  expect(
    version,
    `pdf.js is ${version}, READER was checked against ${READ_WITH}: see docs/storage.md, ` +
      `"pdf.js is part of the reader", before moving READ_WITH up`,
  ).toBe(READ_WITH);
});

for (const [group, list] of Object.entries(cases)) {
  describe(group, () => {
    for (const c of list) {
      const run = c.known ? test.fails : test;
      run(`${c.name}: ${c.about}`, async () => {
        const { analysis, markdown } = await convert(await buildPdf(c.pages));
        expect(summarize(analysis)).toEqual(c.blocks);
        if (c.markdown !== undefined) expect(markdown).toBe(c.markdown);
      });
    }
  });
}
