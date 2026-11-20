/** Getting a document read over the real engine: read off its pages the
 *  first time and kept, answered from the cache after, and read again when
 *  what is cached cannot be used.
 *
 * As in `editor.test.ts`, nothing is mocked between the page and OPFS. The
 * workspace is committed through the engine, and the browser's copy of it
 * discarded before and after each test, so each starts from nothing.
 *
 * A reading of the one-page document takes about a second on a machine held
 * to two cores, which is `vi.waitFor`'s whole default, so a poll for the
 * write going out failed on every slow run. Every poll here has `WAIT`: a
 * budget on the order of the test's own, not a guess at how long the work
 * takes, and short of the test's so that what did not come is named. */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type * as Opfs from "src/lib/opfs";
import { READER, type Analysis } from "src/lib/analysis";
import {
  CANCELED,
  convert,
  ensureRead,
  forgetReading,
  readAgain,
  readDone,
} from "src/lib/convert";
import { commitEdits, saved } from "src/lib/editing";
import { blankEdits, type Edits } from "src/lib/edits";
import { emit } from "src/lib/emit";
import { engine } from "src/lib/engine";
import { openPdf, type PDFPageProxy } from "src/lib/pdf";
import { useEditor, type Reading } from "src/lib/store";
import { assetsPrefix, cacheDir, markdownPath } from "src/lib/workspace";
import { buildPdf } from "./fixtures/pdf";
import { prose, TOP, X } from "./cases/text";
import { Client } from "./harness";

/** Writes beside the engine, into the same OPFS, the way another tab would. */
const opfs = new Client(new URL("./worker.ts", import.meta.url)).bind<
  typeof Opfs
>("opfs");

const closers: (() => Promise<void>)[] = [];

/** How long a poll may take: well past the work on a slow machine, short
 *  of the test's own 15 s, so a failure says what never came. */
const WAIT = { timeout: 10_000 };

/** The browser's workspace, staged on a first look and discarded, which
 *  empties OPFS. */
async function discard(): Promise<void> {
  await engine.stageView();
  await engine.discardWorkspace();
}

// Before as well as after: test files share one OPFS, and one that runs
// earlier, like `stage.test.ts`, may leave a workspace of its own behind.
beforeEach(discard);

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  await discard();
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
  const { release, spy, written } = holdWrite();
  try {
    done = false;
    const job = convert("pumps/a", pages);
    void readDone("pumps/a").then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled(), WAIT);
    expect(done).toBe(true);
    expect(written()).toBe(0);
    release();
    expect((await job).markdown.text).toBe(MARKDOWN);
  } finally {
    // Let go whatever a failed assertion left held, so one failure does
    // not strand a reading of `pumps/a` for every test after it.
    release();
    forgetReading("pumps/a");
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
 *  does -- or, the first time, throwing `cause` instead. `written()` is
 *  how many writes have gone through to the engine. */
function holdWrite(cause?: Error) {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const write = engine.convert.bind(engine);
  let first = true;
  let writes = 0;
  const spy = vi
    .spyOn(engine, "convert")
    .mockImplementation(async (...args) => {
      await held;
      if (cause && first) {
        first = false;
        throw cause;
      }
      writes += 1;
      return write(...args);
    });
  return { release, spy, written: () => writes };
}

test("a reading given up under its write ends as given up, and is cached", async () => {
  const pages = await committed();
  const { release, spy } = holdWrite();
  try {
    const job = convert("pumps/a", pages);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled(), WAIT);
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
    release();
    forgetReading("pumps/a");
    spy.mockRestore();
  }
});

test("what a given-up reading ends with is not shown over the next one's", async () => {
  const pages = await committed();
  const { release, spy } = holdWrite(new Error("disk full"));
  const readings = useEditor.getState;
  try {
    ensureRead("pumps/a", pages);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled(), WAIT);
    // The tab closed under the write, and the document opened again before
    // the write came back -- failed. That failure is the first reading's.
    forgetReading("pumps/a");
    expect(readings().readings["pumps/a"]).toBeUndefined();
    ensureRead("pumps/a", pages);
    expect(readings().readings["pumps/a"]?.status).toBe("reading");
    release();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2), WAIT);
    expect(readings().readings["pumps/a"]?.status).not.toBe("failed");
    await vi.waitFor(
      () => expect(readings().readings["pumps/a"]?.status).toBe("ready"),
      WAIT,
    );
  } finally {
    release();
    forgetReading("pumps/a");
    spy.mockRestore();
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

// ---- edits ----------------------------------------------------------------

/** `analysis`'s first text block hidden: edits a person might make. */
function hiding(analysis: Analysis): Edits {
  const id = analysis.pages[0].blocks.find((b) => b.kind === "text")!.id;
  return { ...blankEdits(), blocks: { [id]: { hidden: true } } };
}
const HIDDEN = `<!-- ${prose(1)[0]} -->`;

test("edits are kept beside the read, and the next reading comes with them", async () => {
  const pages = await committed();
  const first = await convert("pumps/a", pages);
  expect(first.edits).toEqual(blankEdits());
  expect(await engine.edits("pumps/a")).toBeNull();

  const edits = hiding(first.analysis);
  const markdown = emit(first.analysis, assetsPrefix("pumps/a"), edits).text;
  await engine.saveEdits("pumps/a", edits, markdown);
  expect(await engine.edits("pumps/a")).toEqual(edits);
  expect(await opfs("readText", markdownPath("pumps/a"))).toBe(markdown);

  const again = await convert("pumps/a", pages);
  expect(again.edits).toEqual(edits);
  expect(again.markdown.text).toBe(markdown);
  expect(again.markdown.text).toContain(HIDDEN);
});

test("a document read again keeps its edits, and writes its markdown with them", async () => {
  const pages = await committed();
  const first = await convert("pumps/a", pages);
  const edits = hiding(first.analysis);
  await engine.saveEdits(
    "pumps/a",
    edits,
    emit(first.analysis, assetsPrefix("pumps/a"), edits).text,
  );
  // An analysis that cannot be used is read again, edits and all.
  await opfs("writeText", [...cacheDir("pumps/a"), "analysis.json"], "{");
  let read = 0;
  const again = await convert("pumps/a", pages, () => read++);
  expect(read).toBe(1);
  expect(again.edits).toEqual(edits);
  expect(await opfs("readText", markdownPath("pumps/a"))).toContain(HIDDEN);
});

test("an analysis an older reader made is kept, not read again, while there are edits on it", async () => {
  const pages = await committed();
  const first = await convert("pumps/a", pages);
  const edits = hiding(first.analysis);
  await engine.saveEdits(
    "pumps/a",
    edits,
    emit(first.analysis, assetsPrefix("pumps/a"), edits).text,
  );
  const older = { ...first.analysis, reader: READER - 1 };
  await opfs(
    "writeText",
    [...cacheDir("pumps/a"), "analysis.json"],
    JSON.stringify(older),
  );
  let read = 0;
  const again = await convert("pumps/a", pages, () => read++);
  expect(read).toBe(0);
  expect(again.analysis.reader).toBe(READER - 1);
  expect(again.markdown.text).toContain(HIDDEN);
});

/** `pumps/a` read, `hiding` saved on it, and its analysis made out to be an
 *  older reader's: a document its edits hold on an old read. */
async function heldOnOlderRead(pages: PDFPageProxy[]): Promise<Edits> {
  const first = await convert("pumps/a", pages);
  const edits = hiding(first.analysis);
  await engine.saveEdits(
    "pumps/a",
    edits,
    emit(first.analysis, assetsPrefix("pumps/a"), edits).text,
  );
  await opfs(
    "writeText",
    [...cacheDir("pumps/a"), "analysis.json"],
    JSON.stringify({ ...first.analysis, reader: READER - 1 }),
  );
  return edits;
}

type Shown = Extract<Reading, { status: "ready" }>;
const shownAs = () => useEditor.getState().readings["pumps/a"];

/** Until the store shows `pumps/a` as `status`. */
const until = (status: Reading["status"]) =>
  vi.waitFor(() => expect(shownAs()?.status).toBe(status), WAIT);

test("read again on a person's ask: off its pages, by the current reader, its edits gone and its selection let go", async () => {
  const pages = await committed();
  await heldOnOlderRead(pages);
  const state = useEditor.getState;
  try {
    ensureRead("pumps/a", pages);
    await until("ready");
    const old = shownAs() as Shown;
    expect(old.analysis.reader).toBe(READER - 1);
    expect(old.markdown.text).toContain(HIDDEN);
    const block = old.analysis.pages[0].blocks[0].id;
    state().pick("pumps/a", block, { range: false, toggle: false }, "page");
    expect(state().selection?.ids).toEqual([block]);

    // Asked: the store tells the pane holding the pages, which reads them.
    // Nothing else moves until it does.
    const asked = state().rereads["pumps/a"] ?? 0;
    readAgain("pumps/a");
    expect(state().rereads["pumps/a"]).toBe(asked + 1);
    expect(shownAs()).toBe(old);
    ensureRead("pumps/a", pages);
    expect(shownAs()?.status).toBe("reading");
    expect(state().selection).toBeNull();
    // Joined, to count the pages it reads.
    let read = 0;
    await convert("pumps/a", pages, () => read++);
    await until("ready");
    expect(read).toBe(1);

    const now = shownAs() as Shown;
    expect(now.analysis.reader).toBe(READER);
    expect(now.edits).toEqual(blankEdits());
    expect(now.markdown.text).toBe(MARKDOWN);
    // And so it is kept: the next opening is from the cache, as it is.
    expect(await engine.edits("pumps/a")).toBeNull();
    expect((await engine.analysis("pumps/a"))?.reader).toBe(READER);
    expect(await opfs("readText", markdownPath("pumps/a"))).toBe(MARKDOWN);
  } finally {
    forgetReading("pumps/a");
  }
});

test("a read again is written down after the edits' last save, which would put them back", async () => {
  const pages = await committed();
  await heldOnOlderRead(pages);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const save = engine.saveEdits.bind(engine);
  const saving = vi
    .spyOn(engine, "saveEdits")
    .mockImplementation(async (...args) => {
      await held;
      return save(...args);
    });
  const writing = vi.spyOn(engine, "convert");
  try {
    ensureRead("pumps/a", pages);
    await until("ready");
    // An edit, its save held on the way; then the ask.
    commitEdits("pumps/a", (edits) => ({ ...edits, page_numbers: "hide" }));
    readAgain("pumps/a");
    ensureRead("pumps/a", pages);
    // The pages are read, and the write waits on the save.
    await vi.waitFor(
      () => expect((shownAs() as { page?: number })?.page).toBe(1),
      WAIT,
    );
    expect(writing.mock.calls.length).toBe(0);
    release();
    await saved("pumps/a");
    await until("ready");
    expect(writing.mock.calls.length).toBe(1);
    expect(await engine.edits("pumps/a")).toBeNull();
    expect((shownAs() as Shown).edits).toEqual(blankEdits());
  } finally {
    release();
    forgetReading("pumps/a");
    saving.mockRestore();
    writing.mockRestore();
  }
});

test("a read again that fails says so, and leaves the old read and its edits as they were", async () => {
  const pages = await committed();
  const edits = await heldOnOlderRead(pages);
  const { release, spy } = holdWrite(new Error("disk full"));
  release();
  try {
    ensureRead("pumps/a", pages);
    await until("ready");
    readAgain("pumps/a");
    ensureRead("pumps/a", pages);
    await until("failed");
    expect(shownAs()).toMatchObject({ problem: /disk full/ });
    expect(await engine.edits("pumps/a")).toEqual(edits);
    expect((await engine.analysis("pumps/a"))?.reader).toBe(READER - 1);
    expect(await opfs("readText", markdownPath("pumps/a"))).toContain(HIDDEN);
  } finally {
    forgetReading("pumps/a");
    spy.mockRestore();
  }
});

test("the tab closed before the pages are read again takes the ask back", async () => {
  const pages = await committed();
  const edits = await heldOnOlderRead(pages);
  readAgain("pumps/a");
  forgetReading("pumps/a");
  let read = 0;
  const again = await convert("pumps/a", pages, () => read++);
  expect(read).toBe(0);
  expect(again.analysis.reader).toBe(READER - 1);
  expect(again.edits).toEqual(edits);
});

test("an edits.json that does not read fails the reading with what is wrong with it", async () => {
  const pages = await committed();
  await convert("pumps/a", pages);
  await opfs("writeText", [...cacheDir("pumps/a"), "edits.json"], "{");
  await expect(convert("pumps/a", pages)).rejects.toThrow(
    "its edits.json is not valid JSON.",
  );
  // And the file is left as it was, for a person to see to.
  expect(await opfs("readText", [...cacheDir("pumps/a"), "edits.json"])).toBe(
    "{",
  );
});

test("edits are refused for a document not read yet", async () => {
  await committed();
  await expect(
    engine.saveEdits("pumps/a", blankEdits(), "text\n"),
  ).rejects.toThrow("pumps/a has not been read, so there is nothing to edit.");
  expect(await engine.edits("pumps/a")).toBeNull();
});
