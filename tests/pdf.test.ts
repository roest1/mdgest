/** pdf.js as `pdf.ts` sets it up: one worker for every document, what
 *  letting one document go leaves for the next, and what is read out of a
 *  document besides its pages. */

import { expect, test } from "vitest";
import { openPdf, readOutline, readProperties, resolve } from "src/lib/pdf";
import { pdfOf } from "./harness";

const LETTER: [number, number] = [612, 792];

test("a document opens while the last one is still being let go of", async () => {
  const first = openPdf(pdfOf([LETTER]));
  await first.promise;
  // Not awaited: the pane's cleanup cannot wait, and the next tab, or the
  // same pane remounted, opens straight after.
  const going = first.destroy();
  const next = openPdf(pdfOf([LETTER, LETTER]));
  expect((await next.promise).numPages).toBe(2);
  await going;
  await next.destroy();
});

test("the bytes are handed to pdf.js, not copied", async () => {
  const bytes = pdfOf([LETTER]);
  const task = openPdf(bytes);
  await task.promise;
  expect(bytes.byteLength).toBe(0);
  await task.destroy();
});

test("properties are what the file says, beside what is known of it", async () => {
  const bytes = pdfOf([[792, 612], LETTER], {
    info: { Title: "  Pump manual ", Author: "Acme", Keywords: "" },
  });
  const size = bytes.byteLength;
  const task = openPdf(bytes);
  const doc = await task.promise;
  const properties = await readProperties(
    doc,
    "pumps.pdf",
    size,
    await doc.getPage(1),
  );
  expect(properties).toMatchObject({
    fileName: "pumps.pdf",
    bytes: size,
    // Trimmed, and a blank field is no field.
    title: "Pump manual",
    author: "Acme",
    keywords: null,
    created: null,
    pages: 2,
    // The first page's, as it is shown.
    pageSize: { width: 792, height: 612 },
    fastWebView: false,
  });
  await task.destroy();
});

test("an outline entry resolves to its page, and the height it names", async () => {
  const task = openPdf(
    pdfOf([LETTER, LETTER, LETTER], {
      outline: [
        { title: "Intake", page: 2 },
        { title: "Outlet (rear)", page: 3, top: 400 },
      ],
    }),
  );
  const doc = await task.promise;
  const outline = await readOutline(doc);
  expect(outline.map((n) => n.title)).toEqual(["Intake", "Outlet (rear)"]);
  expect(await resolve(doc, outline[0].dest)).toEqual({ page: 2, top: null });
  expect(await resolve(doc, outline[1].dest)).toEqual({ page: 3, top: 400 });
  // Somewhere the document does not go.
  expect(await resolve(doc, null)).toBeNull();
  expect(await resolve(doc, [99, { name: "Fit" }])).toBeNull();
  await task.destroy();
});
