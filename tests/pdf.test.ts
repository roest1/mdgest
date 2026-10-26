/** pdf.js as `pdf.ts` sets it up: one worker for every document, what
 *  letting one document go leaves for the next, and what is read out of a
 *  document besides its pages. */

import { expect, test, vi } from "vitest";
import {
  openPdf,
  readOutline,
  readProperties,
  resolve,
  targetTop,
} from "src/lib/pdf";
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

test("an outline or a description pdf.js cannot read is read as none", async () => {
  const task = openPdf(pdfOf([LETTER], { info: { Title: "Pump manual" } }));
  const doc = await task.promise;
  const first = await doc.getPage(1);
  const broken = Object.create(doc, {
    getOutline: { value: () => Promise.reject(new Error("bad /Outlines")) },
    getMetadata: { value: () => Promise.reject(new Error("bad XMP")) },
  }) as typeof doc;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(await readOutline(broken)).toEqual([]);
  const properties = await readProperties(broken, "a.pdf", 1000, first);
  expect(properties).toMatchObject({
    fileName: "a.pdf",
    title: null,
    pages: 1,
  });
  expect(warn).toHaveBeenCalledTimes(2);
  warn.mockRestore();
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
  expect(await resolve(doc, outline[0].dest)).toEqual({
    page: 2,
    left: null,
    top: null,
  });
  expect(await resolve(doc, outline[1].dest)).toEqual({
    page: 3,
    left: null,
    top: 400,
  });
  // Somewhere the document does not go.
  expect(await resolve(doc, null)).toBeNull();
  expect(await resolve(doc, [99, { name: "Fit" }])).toBeNull();
  await task.destroy();
});

test("a target's place down the page follows the page's /Rotate", async () => {
  const at = { page: 1, left: 100, top: 400 };
  const down = async (rotate: number) => {
    const task = openPdf(pdfOf([LETTER], { rotate }));
    const page = await (await task.promise).getPage(1);
    const y = targetTop(page, 1, at);
    const none = targetTop(page, 1, { page: 1, left: null, top: null });
    await task.destroy();
    return [y, none];
  };
  // Upright, the height counts from the bottom; upturned, from the top.
  expect(await down(0)).toEqual([792 - 400, 0]);
  expect(await down(180)).toEqual([400, 0]);
  // A quarter turn: the left edge runs down the screen.
  expect(await down(90)).toEqual([100, 0]);
  expect(await down(270)).toEqual([612 - 100, 0]);
});
