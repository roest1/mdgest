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
import { buildPdf, Pen } from "./fixtures/pdf";

async function read(bytes: Uint8Array<ArrayBuffer>) {
  const task = openPdf(bytes);
  const pdf = await task.promise;
  try {
    const pages: ReadPage[] = [];
    for (let n = 1; n <= pdf.numPages; n++)
      pages.push((await readPage(await pdf.getPage(n))).page);
    return structure(pages);
  } finally {
    await task.destroy();
  }
}

test("pdf.js is the version READER was made with", () => {
  expect(
    version,
    `pdf.js is ${version}, READER was made with ${READ_WITH}: bump READER in ` +
      `src/lib/analysis.ts and set READ_WITH to ${version}, together`,
  ).toBe(READ_WITH);
});

test("the pen sets a run after a raised one back on the baseline", () => {
  const pen = new Pen();
  pen.text(72, 100, "E = mc");
  pen.then(0, "2", { size: 6, rise: 3 });
  pen.then(1, "and more");
  expect(pen.ops.map((op) => op.kind === "text" && op.y)).toEqual([
    100, 97, 100,
  ]);
});

for (const [group, list] of Object.entries(cases)) {
  describe(group, () => {
    for (const c of list) {
      const run = c.known ? test.fails : test;
      run(`${c.name}: ${c.about}`, async () => {
        const analysis = await read(await buildPdf(c.pages));
        expect(summarize(analysis)).toEqual(c.blocks);
        if (c.markdown !== undefined)
          expect(emit(analysis, "doc.assets/").text).toBe(c.markdown);
      });
    }
  });
}
