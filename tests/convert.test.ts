/** Getting a document read over the real engine: read off its pages the
 *  first time and kept, answered from the cache after, and read again when
 *  what is cached cannot be used.
 *
 * As in `editor.test.ts`, nothing is mocked between the page and OPFS. The
 * workspace is committed through the engine, and the browser's copy of it
 * discarded after each test, so the next starts from nothing. */

import { afterEach, expect, test, vi } from "vitest";
import type * as Opfs from "src/lib/opfs";
import { READER } from "src/lib/analysis";
import {
  CANCELED,
  convert,
  ensureRead,
  forgetReading,
  readDone,
} from "src/lib/convert";
import { engine } from "src/lib/engine";
import { openPdf, type PDFPageProxy } from "src/lib/pdf";
import { useEditor } from "src/lib/store";
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

test("two asks at once are one reading, and both hear its pages", async () => {
  const pages = await committed();
  const heard: string[] = [];
  const a = convert("pumps/a", pages, () => heard.push("a"));
  const b = convert("pumps/a", pages, () => heard.push("b"));
  expect(a).toBe(b);
  expect((await a).markdown.text).toBe(MARKDOWN);
  expect(heard.sort()).toEqual(["a", "b"]);
});

test("an ask from another opening of the document joins the reading", async () => {
  const pages = await committed();
  // The document opened again while the first reading was still going --
  // its tab switched away from and back -- is other pages, but the first
  // reading's own stay open until it is done, so it stands for both.
  const task = openPdf(await buildPdf([(pen) => pen.text(X, TOP, "x")]));
  closers.push(() => task.destroy());
  const other = [await (await task.promise).getPage(1)];
  const first = convert("pumps/a", pages);
  const second = convert("pumps/a", other);
  expect(second).toBe(first);
  expect((await second).markdown.text).toBe(MARKDOWN);
});

test("a reading is off its pages once the last is read, before it is written down", async () => {
  const pages = await committed();
  let done = false;
  void readDone("pumps/a").then(() => (done = true));
  await Promise.resolve();
  expect(done).toBe(true); // No reading: done at once.

  // The write held, the way the workspace lock would hold it under another
  // tab's commit: the pages are not needed for it, and are let go before.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let written = false;
  const write = engine.convert.bind(engine);
  const spy = vi
    .spyOn(engine, "convert")
    .mockImplementation(async (...args) => {
      await held;
      written = true;
      return write(...args);
    });
  try {
    done = false;
    const job = convert("pumps/a", pages);
    void readDone("pumps/a").then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    await Promise.resolve();
    expect(done).toBe(true);
    expect(written).toBe(false);
    release();
    expect((await job).markdown.text).toBe(MARKDOWN);
  } finally {
    spy.mockRestore();
  }
});

test("a reading that ends before its last page is off them when it ends", async () => {
  const pages = await committed();
  const spy = vi
    .spyOn(engine, "analysis")
    .mockRejectedValue(new Error("the engine is down"));
  try {
    const job = convert("pumps/a", pages);
    let done = false;
    void readDone("pumps/a").then(() => (done = true));
    await expect(job).rejects.toThrow("the engine is down");
    await new Promise((r) => setTimeout(r));
    expect(done).toBe(true);
  } finally {
    spy.mockRestore();
  }
});

/** `engine.convert` held until `release` is called, then doing what it
 *  does -- or, the first time, throwing `cause` instead. */
function holdWrite(cause?: Error) {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const write = engine.convert.bind(engine);
  let first = true;
  const spy = vi
    .spyOn(engine, "convert")
    .mockImplementation(async (...args) => {
      await held;
      if (cause && first) {
        first = false;
        throw cause;
      }
      return write(...args);
    });
  return { release, spy };
}

test("a reading given up under its write ends as given up, and is cached", async () => {
  const pages = await committed();
  const { release, spy } = holdWrite();
  try {
    const job = convert("pumps/a", pages);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    forgetReading("pumps/a");
    release();
    await expect(job).rejects.toHaveProperty("name", CANCELED);
    // The write had gone out, so the next reading is from the cache.
    expect(await engine.analysis("pumps/a")).not.toBeNull();
    let read = 0;
    const again = await convert("pumps/a", pages, () => read++);
    expect(read).toBe(0);
    expect(again.markdown.text).toBe(MARKDOWN);
  } finally {
    spy.mockRestore();
  }
});

test("what a given-up reading ends with is not shown over the next one's", async () => {
  const pages = await committed();
  const { release, spy } = holdWrite(new Error("disk full"));
  const readings = useEditor.getState;
  try {
    ensureRead("pumps/a", pages);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    // The tab closed under the write, and the document opened again before
    // the write came back -- failed. That failure is the first reading's.
    forgetReading("pumps/a");
    expect(readings().readings["pumps/a"]).toBeUndefined();
    ensureRead("pumps/a", pages);
    expect(readings().readings["pumps/a"]?.status).toBe("reading");
    release();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(readings().readings["pumps/a"]?.status).not.toBe("failed");
    await vi.waitFor(() =>
      expect(readings().readings["pumps/a"]?.status).toBe("ready"),
    );
  } finally {
    spy.mockRestore();
    forgetReading("pumps/a");
  }
});

test("an analysis this build cannot use is read again, not shown", async () => {
  const pages = await committed();
  await opfs("writeText", [...cacheDir("pumps/a"), "analysis.json"], "{");
  let read = 0;
  const { markdown } = await convert("pumps/a", pages, () => read++);
  expect(read).toBe(1);
  expect(markdown.text).toBe(MARKDOWN);
});

test("an analysis an older reader made is read again", async () => {
  const pages = await committed();
  const first = await convert("pumps/a", pages);
  const older = { ...first.analysis, reader: READER - 1 };
  await opfs(
    "writeText",
    [...cacheDir("pumps/a"), "analysis.json"],
    JSON.stringify(older),
  );
  let read = 0;
  const again = await convert("pumps/a", pages, () => read++);
  expect(read).toBe(1);
  expect(again.analysis.reader).toBe(READER);
  expect((await engine.analysis("pumps/a"))?.reader).toBe(READER);
});
