/** pdf.js as `pdf.ts` sets it up: one worker for every document, and what
 *  letting one document go leaves for the next. */

import { expect, test } from "vitest";
import { openPdf } from "src/lib/pdf";
import { pdfOf } from "./harness";

const LETTER: [number, number] = [612, 792];

test("a document opens while the last one is still being let go of", async () => {
  const first = openPdf(pdfOf(LETTER));
  await first.promise;
  // Not awaited: the pane's cleanup cannot wait, and the next tab, or the
  // same pane remounted, opens straight after.
  const going = first.destroy();
  const next = openPdf(pdfOf(LETTER, LETTER));
  expect((await next.promise).numPages).toBe(2);
  await going;
  await next.destroy();
});

test("the bytes are handed to pdf.js, not copied", async () => {
  const bytes = pdfOf(LETTER);
  const task = openPdf(bytes);
  await task.promise;
  expect(bytes.byteLength).toBe(0);
  await task.destroy();
});
