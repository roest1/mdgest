/** Getting a document read over the real engine: read off its pages the
 *  first time and kept, answered from the cache after, and read again when
 *  what is cached cannot be used.
 *
 * As in `editor.test.ts`, nothing is mocked between the page and OPFS. The
 * workspace is committed through the engine, and the browser's copy of it
 * discarded after each test, so the next starts from nothing. */

import { afterEach, expect, test } from "vitest";
import type * as Opfs from "src/lib/opfs";
import { convert } from "src/lib/convert";
import { engine } from "src/lib/engine";
import { openPdf, type PDFPageProxy } from "src/lib/pdf";
import { cacheDir } from "src/lib/workspace";
import { buildPdf } from "./fixtures/pdf";
import { prose, TOP, X } from "./cases/text";
import { Client } from "./harness";

/** Writes beside the engine, into the same OPFS, the way another tab would. */
const opfs = new Client(new URL("./worker.ts", import.meta.url)).bind<
  typeof Opfs
>("opfs");

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  await engine.stageView();
  await engine.discardWorkspace();
});

/** A one-page document of a paragraph and a picture, committed as
 *  `pumps/a`, and its pages as pdf.js opens them. */
async function committed(): Promise<PDFPageProxy[]> {
  const bytes = await buildPdf([
    (pen) => {
      pen.text(X, TOP, prose(1)[0]);
      pen.image(X, TOP + 40, 200, 120, [100, 60]);
    },
  ]);
  await engine.stage([new File([bytes.slice()], "pumps/a.pdf")]);
  await engine.commit();
  const task = openPdf(bytes);
  closers.push(() => task.destroy());
  const pdf = await task.promise;
  return [await pdf.getPage(1)];
}

const MARKDOWN = `${prose(1)[0]}\n\n![page 1 figure 1](a.assets/p1-i0.png)\n`;

test("a document is read off its pages once, and kept", async () => {
  const pages = await committed();
  const heard: number[][] = [];
  const first = await convert("pumps/a", pages, (n, of) => heard.push([n, of]));
  expect(heard).toEqual([[1, 1]]);
  expect(first.markdown.text).toBe(MARKDOWN);
  expect(await engine.analysis("pumps/a")).toEqual(first.analysis);
  const png = await engine.asset("pumps/a", "p1-i0.png");
  expect([...png!.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]); // "PNG"

  const again = await convert("pumps/a", pages, () => heard.push([0, 0]));
  expect(heard).toEqual([[1, 1]]);
  expect(again).toEqual(first);
});

test("two asks at once are one reading", async () => {
  const pages = await committed();
  const [a, b] = [convert("pumps/a", pages), convert("pumps/a", pages)];
  expect(a).toBe(b);
  expect((await a).markdown.text).toBe(MARKDOWN);
});

test("an analysis this build cannot use is read again, not shown", async () => {
  const pages = await committed();
  await opfs("writeText", [...cacheDir("pumps/a"), "analysis.json"], "{");
  let read = 0;
  const { markdown } = await convert("pumps/a", pages, () => read++);
  expect(read).toBe(1);
  expect(markdown.text).toBe(MARKDOWN);
});
