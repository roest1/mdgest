/** Making an edit (`editing.ts`): shown at once, kept after, over the real
 *  engine and OPFS as in `convert.test.ts`. */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type * as Opfs from "src/lib/opfs";
import { convert } from "src/lib/convert";
import { commitEdits, saved } from "src/lib/editing";
import type { Edits } from "src/lib/edits";
import { emit } from "src/lib/emit";
import { engine } from "src/lib/engine";
import { openPdf } from "src/lib/pdf";
import { useEditor, type Reading } from "src/lib/store";
import { assetsPrefix, cacheDir, markdownPath } from "src/lib/workspace";
import { buildPdf } from "./fixtures/pdf";
import { prose, TOP, X } from "./cases/text";
import { Client } from "./harness";

const opfs = new Client(new URL("./worker.ts", import.meta.url)).bind<
  typeof Opfs
>("opfs");

const DOC = "pumps/a";
const closers: (() => Promise<void>)[] = [];

async function discard(): Promise<void> {
  await engine.stageView();
  await engine.discardWorkspace();
}

beforeEach(discard);

afterEach(async () => {
  vi.restoreAllMocks();
  await saved(DOC);
  useEditor.setState({ readings: {}, selection: null });
  for (const close of closers.splice(0)) await close();
  await discard();
});

/** A one-page document of three paragraphs, committed, read, and in the
 *  store as a ready reading. Answers its text blocks' ids. */
async function opened(): Promise<string[]> {
  const bytes = await buildPdf([
    (pen) => pen.lines(X, TOP, prose(3), { leading: 40 }),
  ]);
  await engine.stage([new File([bytes.slice()], `${DOC}.pdf`)]);
  await engine.commit();
  const task = openPdf(bytes);
  closers.push(() => task.destroy());
  const pdf = await task.promise;
  const read = await convert(DOC, [await pdf.getPage(1)]);
  useEditor.getState().setReading(DOC, { status: "ready", ...read });
  const ids = read.analysis.pages[0].blocks.map((b) => b.id);
  // Three paragraphs, three blocks: the edits below name each.
  expect(ids).toHaveLength(3);
  return ids;
}

const shown = () =>
  useEditor.getState().readings[DOC] as Extract<Reading, { status: "ready" }>;

/** `edits` with block `id` hidden or not. */
const hide =
  (id: string, hidden = true) =>
  (edits: Edits): Edits => ({
    ...edits,
    blocks: { ...edits.blocks, [id]: { ...edits.blocks[id], hidden } },
  });

test("an edit is shown at once, and kept: its edits and the markdown they make", async () => {
  const [id] = await opened();
  commitEdits(DOC, hide(id));
  // Before anything is written.
  expect(shown().edits.blocks[id]).toEqual({ hidden: true });
  expect(shown().markdown.text).toContain(`<!-- ${prose(1)[0]} -->`);
  expect(shown().markdown).toEqual(
    emit(shown().analysis, assetsPrefix(DOC), shown().edits),
  );

  await saved(DOC);
  expect(await engine.edits(DOC)).toEqual(shown().edits);
  expect(await opfs("readText", markdownPath(DOC))).toBe(shown().markdown.text);
  expect(shown().unsaved).toBeUndefined();
});

test("an edit that changes nothing is not one", async () => {
  await opened();
  const before = shown();
  const save = vi.spyOn(engine, "saveEdits");
  commitEdits(DOC, (edits) => edits);
  expect(shown()).toBe(before);
  expect(save).not.toHaveBeenCalled();
});

test("a quick run of edits is two saves, the first and the last, and the last is what is kept", async () => {
  const ids = await opened();
  const save = vi.spyOn(engine, "saveEdits");
  commitEdits(DOC, hide(ids[0]));
  commitEdits(DOC, hide(ids[1]));
  commitEdits(DOC, hide(ids[2]));
  commitEdits(DOC, hide(ids[0], false));
  await saved(DOC);
  expect(save).toHaveBeenCalledTimes(2);
  const last = shown().edits;
  expect(save.mock.calls[1][1]).toBe(last);
  expect(await engine.edits(DOC)).toEqual(last);
  expect(await opfs("readText", markdownPath(DOC))).toBe(shown().markdown.text);
});

test("a save that fails says so on the reading, until the next one is kept", async () => {
  const [a, b] = await opened();
  vi.spyOn(engine, "saveEdits").mockRejectedValueOnce(new Error("disk full"));
  commitEdits(DOC, hide(a));
  await saved(DOC);
  expect(shown().unsaved).toBe(
    "Your last edit was not saved in this browser (disk full).",
  );
  commitEdits(DOC, hide(b));
  // Still said while the next is written: it is not kept yet.
  expect(shown().unsaved).toBeDefined();
  await saved(DOC);
  expect(shown().unsaved).toBeUndefined();
  expect(await engine.edits(DOC)).toEqual(shown().edits);
});

test("a selection is kept through an edit", async () => {
  const [a, b] = await opened();
  const { pick } = useEditor.getState();
  pick(DOC, a, { range: false, toggle: false }, "page");
  pick(DOC, b, { range: false, toggle: true }, "page");
  commitEdits(DOC, hide(a));
  expect(useEditor.getState().selection?.ids).toEqual([a, b]);
});

test("an edit to a document whose reading is not ready changes nothing", async () => {
  await opened();
  useEditor
    .getState()
    .setReading(DOC, { status: "reading", page: 0, pages: 1 });
  const save = vi.spyOn(engine, "saveEdits");
  commitEdits(DOC, hide("p1b0"));
  expect(save).not.toHaveBeenCalled();
  expect(await opfs("readText", [...cacheDir(DOC), "edits.json"])).toBeNull();
});

test("a save that lands after newer edits are shown speaks for nothing: theirs does", async () => {
  const [a, b, c] = await opened();
  /** A save held until let go, then kept -- or not: nothing is written. */
  const holds: (() => void)[] = [];
  const held = () =>
    new Promise<void>((resolve) => holds.push(() => resolve()));
  const save = vi
    .spyOn(engine, "saveEdits")
    .mockRejectedValueOnce(new Error("disk full"))
    .mockImplementationOnce(held)
    .mockImplementationOnce(held);
  commitEdits(DOC, hide(a));
  await vi.waitFor(() => expect(shown().unsaved).toBeDefined());

  commitEdits(DOC, hide(b)); // written now, and held
  commitEdits(DOC, hide(c)); // waits behind it
  await vi.waitFor(() => expect(holds).toHaveLength(1));
  holds[0]();
  // The next save starts only once the last one has settled.
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(3));
  // `b`'s edits were kept, but what is shown is `c`'s, which are not yet.
  expect(shown().unsaved).toBeDefined();
  holds[1]();
  await saved(DOC);
  expect(shown().unsaved).toBeUndefined();
});
