/** What a drop stages, what committing writes, and what each says about
 *  what it did not do.
 *
 * The rule the landing rests on: everything dropped is either staged or
 * named in `rejected`. A row a person can see is a decision they can make;
 * a file that goes missing in silence is one they cannot.
 *
 * `stage.ts` keeps its state in module scope, so each test gets a worker of
 * its own: the one way to start from nothing seen and nothing staged, even
 * after a test that leaves the stage deliberately stale. */

import { strToU8, zipSync } from "fflate";
import { beforeEach, describe, expect, test } from "vitest";
import type * as Opfs from "src/lib/opfs";
import type { StageView } from "src/lib/protocol";
import type * as Stage from "src/lib/stage";
import { MAX_MANIFEST } from "src/lib/limits";
import { MANIFEST as MANIFEST_NAME } from "src/lib/workspace";

type StageApi = typeof Stage;
type OpfsApi = typeof Opfs;

let worker: Worker | null = null;
let next = 0;
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

function spawn(): Worker {
  const w = new Worker(new URL("./stage.worker.ts", import.meta.url), {
    type: "module",
  });
  w.onmessage = (
    event: MessageEvent<{ id: number; value?: unknown; error?: string }>,
  ) => {
    const { id, value, error } = event.data;
    const call = pending.get(id);
    pending.delete(id);
    if (error === undefined) call?.resolve(value);
    else call?.reject(new Error(error));
  };
  return w;
}

function call(mod: string, fn: string, args: unknown[]): Promise<unknown> {
  const id = next++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker!.postMessage({ id, mod, fn, args });
  });
}

/** Call a `stage.ts` export in the worker. */
function stage<K extends keyof StageApi>(
  fn: K,
  ...args: Parameters<StageApi[K]>
): Promise<Awaited<ReturnType<StageApi[K]>>> {
  return call("stage", fn, args) as Promise<Awaited<ReturnType<StageApi[K]>>>;
}

/** Call an `opfs.ts` export in the same worker: what is on disk under the
 *  stage, and what another tab would write beside it. */
function opfs<K extends keyof OpfsApi>(
  fn: K,
  ...args: Parameters<OpfsApi[K]>
): Promise<Awaited<ReturnType<OpfsApi[K]>>> {
  return call("opfs", fn, args) as Promise<Awaited<ReturnType<OpfsApi[K]>>>;
}

/** A dropped file: the name is its path within the drop, the way the drop
 *  zone rewrites it before the engine sees it. */
const dropped = (path: string, text = path) => new File([text], path);

/** A zip of `files`, each entry's text its own name, dropped as `name`. */
const zipped = (name: string, files: Record<string, string>) =>
  new File(
    [
      zipSync(
        Object.fromEntries(
          Object.entries(files).map(([path, text]) => [path, strToU8(text)]),
        ),
      ),
    ],
    name,
  );

const manifest = (documents: Record<string, unknown> = {}, name?: string) =>
  JSON.stringify({ format: 1, ...(name ? { name } : {}), documents });
const EMPTY = manifest();

const sha = (text: string) => opfs("sha256", new TextEncoder().encode(text));

const ids = (view: StageView) => view.rows.map((r) => r.docId).sort();
const statuses = (view: StageView) =>
  Object.fromEntries(view.rows.map((r) => [r.docId, r.status]));
const row = (view: StageView, docId: string) =>
  view.rows.find((r) => r.docId === docId)!;
const stored = async () => {
  const text = await opfs("manifestText");
  return text === null
    ? null
    : (JSON.parse(text) as {
        name?: string;
        documents: Record<string, { sha256?: string }>;
      });
};

beforeEach(async () => {
  worker?.terminate();
  pending.clear();
  worker = spawn();
  await opfs("clearWorkspace");
});

describe("loose files", () => {
  test("take their ids from their paths, folders kept", async () => {
    const { view, rejected } = await stage("stage", [
      dropped("Manuals/Hydraulics/Scan 1.PDF"),
      dropped("b.pdf"),
    ]);
    expect(rejected).toEqual([]);
    expect(view.workspace).toBeNull();
    expect(ids(view)).toEqual(["Manuals/Hydraulics/scan-1", "b"]);
    expect(statuses(view)).toEqual({
      "Manuals/Hydraulics/scan-1": "new",
      b: "new",
    });
    expect(row(view, "b").candidates).toEqual([
      { sha256: await sha("b.pdf"), name: "b.pdf", bytes: 5, from: "loose" },
    ]);
  });

  test("junk is left out without a word", async () => {
    const { view, rejected } = await stage("stage", [
      dropped(".DS_Store"),
      dropped("__MACOSX/._a.pdf"),
      dropped("a.pdf"),
    ]);
    expect(rejected).toEqual([]);
    expect(ids(view)).toEqual(["a"]);
  });

  test("the same bytes dropped again under one id are one copy, and said", async () => {
    await stage("stage", [dropped("a.pdf")]);
    const { view, rejected } = await stage("stage", [dropped("a.pdf")]);
    expect(rejected).toEqual(["a.pdf is already staged."]);
    expect(row(view, "a").candidates).toHaveLength(1);
  });

  test("the same bytes under two ids make the later one a duplicate", async () => {
    const { view } = await stage("stage", [
      dropped("a.pdf", "same"),
      dropped("b.pdf", "same"),
    ]);
    expect(statuses(view)).toEqual({ a: "new", b: "duplicate" });
  });

  test("two different files for one id are a conflict", async () => {
    const { view, rejected } = await stage("stage", [
      dropped("a.pdf", "x"),
      dropped("A.PDF", "y"),
    ]);
    expect(rejected).toEqual([]);
    expect(statuses(view)).toEqual({ a: "conflict" });
    expect(row(view, "a").candidates.map((c) => c.name)).toEqual([
      "a.pdf",
      "A.PDF",
    ]);
  });

  test("keep settles a conflict, and taking the kept copy out reopens it", async () => {
    const { view } = await stage("stage", [
      dropped("a.pdf", "x"),
      dropped("A.PDF", "y"),
    ]);
    const y = await sha("y");
    const kept = await stage("keep", "a", y);
    expect(statuses(kept)).toEqual({ a: "new" });
    expect(row(kept, "a").candidates.map((c) => c.name)).toEqual(["A.PDF"]);
    expect(view.rows).toHaveLength(1);

    const back = await stage("unstage", "a", y);
    expect(row(back, "a").candidates.map((c) => c.name)).toEqual(["a.pdf"]);
    expect(statuses(back)).toEqual({ a: "new" });
  });

  test("rename moves one copy to a name of its own, so both stage", async () => {
    await stage("stage", [
      dropped("a.pdf", "x"),
      dropped("A.PDF", "y"),
      dropped("b.pdf"),
    ]);
    const y = await sha("y");
    await expect(stage("renameCandidate", "a", y, "a")).rejects.toThrow(
      "is the name it already has",
    );
    await expect(stage("renameCandidate", "a", y, "  ")).rejects.toThrow(
      "Give it a name",
    );
    await expect(stage("renameCandidate", "a", y, "b")).rejects.toThrow(
      "b is already taken",
    );
    await expect(stage("renameCandidate", "a", y, "---")).rejects.toThrow(
      "a letter or a digit",
    );
    const view = await stage("renameCandidate", "a", y, "A 2.pdf");
    expect(statuses(view)).toEqual({ a: "new", "a-2": "new", b: "new" });
    expect(row(view, "a-2").candidates[0].name).toBe("A.PDF");
  });

  test("an id keep left nothing set aside under is free to rename onto", async () => {
    const { view } = await stage("stage", [dropped("c.pdf")]);
    const [{ sha256: c }] = row(view, "c").candidates;
    await stage("keep", "c", c);
    await stage("unstage", "c", c);
    await stage("stage", [dropped("a.pdf", "x"), dropped("A.PDF", "y")]);
    const renamed = await stage("renameCandidate", "a", await sha("y"), "c");
    expect(statuses(renamed)).toEqual({ a: "new", c: "new" });
  });

  test("unstage takes one copy out, and the last one takes its row", async () => {
    const { view } = await stage("stage", [dropped("a.pdf")]);
    const [{ sha256 }] = row(view, "a").candidates;
    expect(ids(await stage("unstage", "a", "not-a-hash"))).toEqual(["a"]);
    expect(ids(await stage("unstage", "a", sha256))).toEqual([]);
  });
});

describe("a workspace folder", () => {
  test("stages the PDFs under sources/", async () => {
    const { view, rejected } = await stage("stage", [
      dropped(`ws/${MANIFEST_NAME}`, EMPTY),
      dropped("ws/sources/one.pdf"),
      dropped("ws/sources/deep/two.pdf"),
    ]);
    expect(rejected).toEqual([]);
    expect(view.workspace).toEqual({ name: "ws", origin: "upload", listed: 0 });
    expect(ids(view)).toEqual(["deep/two", "one"]);
    expect(row(view, "one").candidates[0].from).toBe("workspace");
  });

  test("says so when a PDF in it is outside sources/", async () => {
    const { view, rejected } = await stage("stage", [
      dropped(`ws/${MANIFEST_NAME}`, EMPTY),
      dropped("ws/sources/one.pdf"),
      dropped("ws/stray.pdf"),
      dropped("ws/markdown/also.pdf"),
    ]);
    // Neither pass takes them -- this one wants `sources/`, and the loose
    // pass sees them as the workspace's -- so the listing would be short by
    // two with nothing to say why.
    expect(ids(view)).toEqual(["one"]);
    expect(rejected).toEqual([
      "ws/stray.pdf was not staged: a workspace's documents are the ones under sources/.",
      "ws/markdown/also.pdf was not staged: a workspace's documents are the ones under sources/.",
    ]);
  });

  test("says so when a PDF has no name to be a document under", async () => {
    const { view, rejected } = await stage("stage", [
      dropped(`ws/${MANIFEST_NAME}`, EMPTY),
      dropped("ws/sources/.pdf"),
      dropped("ws/sources/one.pdf"),
    ]);
    expect(ids(view)).toEqual(["one"]);
    expect(rejected).toEqual([
      "ws/sources/.pdf was not staged: it has no name to be a document under.",
    ]);
  });

  test("is named for its folder when its manifest has none, and by its manifest otherwise", async () => {
    await stage("stage", [
      dropped(`ws/${MANIFEST_NAME}`, EMPTY),
      dropped("ws/sources/one.pdf"),
    ]);
    await stage("commit");
    expect((await stored())?.name).toBe("ws");

    await opfs("clearWorkspace");
    // An export's zip is named for the day it was made; the manifest is
    // what says which workspace it is.
    await stage("stage", [
      dropped(`papers-2026-10-20/${MANIFEST_NAME}`, manifest({}, "Papers")),
      dropped("papers-2026-10-20/sources/one.pdf"),
    ]);
    await stage("commit");
    expect((await stored())?.name).toBe("Papers");

    await opfs("clearWorkspace");
    await stage("stage", [dropped("one.pdf")]);
    await stage("commit");
    expect((await stored())?.name).toBeUndefined();
  });

  test("a manifest that cannot be read takes its workspace out of the drop", async () => {
    const big = new File(
      [new Uint8Array(MAX_MANIFEST + 1)],
      `ws/${MANIFEST_NAME}`,
    );
    const { view, rejected } = await stage("stage", [
      big,
      dropped("ws/sources/one.pdf"),
      dropped(`bad/${MANIFEST_NAME}`, "{"),
      dropped("bad/sources/two.pdf"),
      dropped("loose.pdf"),
    ]);
    expect(rejected).toEqual([
      expect.stringMatching(
        /^ws was not staged: its mdgest\.json is .* over the 16 MB a manifest can be\.$/,
      ),
      "bad was not staged: its mdgest.json is not valid JSON.",
    ]);
    expect(view.workspace).toBeNull();
    expect(ids(view)).toEqual(["loose"]);
  });

  test("one workspace at a time", async () => {
    const first = await stage("stage", [
      dropped(`a/${MANIFEST_NAME}`, EMPTY),
      dropped("a/sources/one.pdf"),
      dropped(`b/${MANIFEST_NAME}`, EMPTY),
      dropped("b/sources/two.pdf"),
    ]);
    expect(first.rejected).toEqual([
      "One workspace at a time: b was not staged, since a came in the same drop.",
    ]);
    expect(first.view.workspace?.name).toBe("a");

    const second = await stage("stage", [
      dropped(`c/${MANIFEST_NAME}`, EMPTY),
      dropped("c/sources/three.pdf"),
    ]);
    expect(second.rejected).toEqual([
      "One workspace at a time: c was not staged. Discard a first.",
    ]);
    expect(ids(second.view)).toEqual(["one"]);

    const cleared = await stage("discardWorkspace");
    expect(cleared.workspace).toBeNull();
    expect(cleared.rows).toEqual([]);
    const third = await stage("stage", [
      dropped(`c/${MANIFEST_NAME}`, EMPTY),
      dropped("c/sources/three.pdf"),
    ]);
    expect(third.rejected).toEqual([]);
    expect(third.view.workspace?.name).toBe("c");
  });

  test("batches stage in the order they were dropped", async () => {
    const first = await stage("stage", [
      dropped(`a/${MANIFEST_NAME}`, EMPTY),
      dropped("a/sources/one.pdf"),
      zipped("b.zip", { [MANIFEST_NAME]: EMPTY, "sources/two.pdf": "two" }),
    ]);
    expect(first.rejected).toEqual([
      "One workspace at a time: b was not staged, since a came in the same drop.",
    ]);
    await stage("discardWorkspace");
    const second = await stage("stage", [
      zipped("z.zip", { "x.pdf": "same" }),
      dropped("y.pdf", "same"),
    ]);
    expect(statuses(second.view)).toEqual({ x: "new", y: "duplicate" });
  });

  test("loose PDFs join it", async () => {
    const { view } = await stage("stage", [
      dropped(`ws/${MANIFEST_NAME}`, EMPTY),
      dropped("ws/sources/one.pdf"),
      dropped("x.pdf"),
    ]);
    expect(statuses(view)).toEqual({ one: "new", x: "new" });
    expect(row(view, "x").candidates[0].from).toBe("loose");
    // Discarding the workspace keeps them.
    expect(ids(await stage("discardWorkspace"))).toEqual(["x"]);
  });

  test("a document its manifest lists with no file is missing", async () => {
    const { view } = await stage("stage", [
      dropped(
        `ws/${MANIFEST_NAME}`,
        manifest({ gone: { sha256: "0".repeat(64) } }),
      ),
      dropped("ws/sources/one.pdf"),
    ]);
    expect(view.workspace?.listed).toBe(1);
    expect(statuses(view)).toEqual({ gone: "missing", one: "new" });
    expect(row(view, "gone").candidates).toEqual([]);
  });

  test("a listed document is unchanged with its hash, revised with other bytes", async () => {
    const listed = manifest({
      one: { sha256: await sha("one") },
      two: { sha256: await sha("two") },
      three: {},
    });
    const { view } = await stage("stage", [
      dropped(`ws/${MANIFEST_NAME}`, listed),
      dropped("ws/sources/one.pdf", "one"),
      dropped("ws/sources/two.pdf", "changed"),
      // An entry an export left unhashed lists whatever arrives with it.
      dropped("ws/sources/three.pdf", "three"),
    ]);
    expect(statuses(view)).toEqual({
      one: "unchanged",
      two: "revised",
      three: "unchanged",
    });
  });
});

describe("a zip", () => {
  test("stages its PDFs as a drop of its folder would", async () => {
    const { view, rejected } = await stage("stage", [
      zipped("drop.zip", {
        "a.pdf": "a",
        "deep/b.pdf": "b",
        "notes.txt": "no",
        "__MACOSX/._a.pdf": "junk",
      }),
    ]);
    expect(rejected).toEqual([]);
    expect(view.workspace).toBeNull();
    expect(ids(view)).toEqual(["a", "deep/b"]);
    expect(row(view, "deep/b").candidates[0]).toMatchObject({
      name: "deep/b.pdf",
      bytes: 1,
      from: "loose",
    });
  });

  test("with a manifest is a workspace named for the archive", async () => {
    const { view } = await stage("stage", [
      zipped("drop.zip", { [MANIFEST_NAME]: EMPTY, "sources/a.pdf": "a" }),
    ]);
    expect(view.workspace).toEqual({
      name: "drop",
      origin: "upload",
      listed: 0,
    });
    expect(ids(view)).toEqual(["a"]);
    await stage("commit");
    expect((await stored())?.name).toBe("drop");
  });

  test("that is not one takes only itself out of the drop", async () => {
    const { view, rejected } = await stage("stage", [
      new File(["not a zip"], "bad.zip"),
      dropped("a.pdf"),
    ]);
    expect(rejected).toEqual([
      expect.stringMatching(/^bad\.zip was not staged: /),
    ]);
    expect(ids(view)).toEqual(["a"]);
  });
});

describe("commit", () => {
  test("writes the sources and a manifest with their hashes, and the next look continues them", async () => {
    await stage("stage", [dropped("a.pdf"), dropped("deep/b.pdf")]);
    expect(await stage("commit")).toEqual({ docs: ["a", "deep/b"] });
    expect(await stage("docs")).toEqual(["a", "deep/b"]);
    expect(await opfs("readText", ["sources", "deep", "b.pdf"])).toBe(
      "deep/b.pdf",
    );
    expect((await stored())?.documents).toEqual({
      a: { sha256: await sha("a.pdf") },
      "deep/b": { sha256: await sha("deep/b.pdf") },
    });

    const view = await stage("stageView");
    expect(view.unreadable).toBeNull();
    expect(view.workspace).toEqual({
      name: null,
      origin: "browser",
      listed: 2,
    });
    expect(statuses(view)).toEqual({ a: "unchanged", "deep/b": "unchanged" });
    expect(row(view, "deep/b").candidates).toEqual([
      {
        sha256: await sha("deep/b.pdf"),
        name: "deep/b.pdf",
        bytes: 10,
        from: "browser",
      },
    ]);
  });

  test("is refused while a conflict stands, and with nothing staged", async () => {
    await expect(stage("commit")).rejects.toThrow("Nothing staged.");
    await stage("stage", [dropped("a.pdf", "x"), dropped("A.PDF", "y")]);
    await expect(stage("commit")).rejects.toThrow(
      "1 conflict to resolve first.",
    );
  });

  test("adds loose files to the browser's workspace in place", async () => {
    await stage("stage", [dropped("a.pdf")]);
    await stage("commit");
    await stage("stageView");
    const { view } = await stage("stage", [dropped("b.pdf")]);
    expect(statuses(view)).toEqual({ a: "unchanged", b: "new" });
    expect(await stage("commit")).toEqual({ docs: ["a", "b"] });
    expect(Object.keys((await stored())!.documents).sort()).toEqual(["a", "b"]);
  });

  test("replaces a revised source and drops what was derived from it", async () => {
    const v1 = await sha("v1");
    await stage("stage", [
      dropped(
        `ws/${MANIFEST_NAME}`,
        manifest({
          a: { sha256: v1, edits: { blocks: [] }, done: true, note: "kept" },
        }),
      ),
      dropped("ws/sources/a.pdf", "v1"),
    ]);
    await stage("commit");
    await stage("stageView");
    await opfs("writeText", [".mdgest", "a.pdf", "analysis.json"], "{}");
    await opfs("writeText", ["markdown", "a.md"], "# a");

    // The browser's copy and the new one meet as a conflict; keeping the new
    // one is what makes the row revised.
    const { view } = await stage("stage", [dropped("a.pdf", "v2")]);
    expect(statuses(view)).toEqual({ a: "conflict" });
    expect(row(view, "a").candidates.map((c) => c.from)).toEqual([
      "browser",
      "loose",
    ]);
    const v2 = await sha("v2");
    expect(statuses(await stage("keep", "a", v2))).toEqual({ a: "revised" });

    await stage("commit");
    expect(await opfs("readText", ["sources", "a.pdf"])).toBe("v2");
    // Decisions made on v1's blocks do not survive beside v2's hash; what
    // else the entry carried does.
    expect((await stored())?.documents.a).toEqual({ sha256: v2, note: "kept" });
    expect(await opfs("walk", [".mdgest"])).toEqual([]);
    expect(await opfs("walk", ["markdown"])).toEqual([]);
  });

  test("keeps the entry of a document that is missing", async () => {
    const gone = { sha256: "0".repeat(64), note: "kept as it came" };
    await stage("stage", [
      dropped(`ws/${MANIFEST_NAME}`, manifest({ gone })),
      dropped("ws/sources/one.pdf"),
    ]);
    expect(await stage("commit")).toEqual({ docs: ["one"] });
    expect((await stored())?.documents.gone).toEqual(gone);
    expect(statuses(await stage("stageView"))).toEqual({
      gone: "missing",
      one: "unchanged",
    });
  });

  test("refuses when another tab wrote since this page looked", async () => {
    await stage("stage", [dropped("a.pdf")]);
    await stage("commit");
    await stage("stageView");
    await opfs("writeManifest", JSON.parse(manifest({}, "elsewhere")));
    await stage("stage", [dropped("b.pdf")]);
    await expect(stage("commit")).rejects.toThrow(
      "changed since this page listed it",
    );
    // Nothing of this page's went down.
    expect(await opfs("docs")).toEqual(["a"]);
    expect((await stored())?.name).toBe("elsewhere");
  });
});

describe("the browser's workspace", () => {
  test("its documents cannot be taken out or renamed here", async () => {
    await stage("stage", [dropped("a.pdf")]);
    await stage("commit");
    const view = await stage("stageView");
    const [{ sha256 }] = row(view, "a").candidates;
    await expect(stage("unstage", "a", sha256)).rejects.toThrow(
      "removed in the editor",
    );
    await expect(stage("renameCandidate", "a", sha256, "b")).rejects.toThrow(
      "renamed in the editor",
    );
  });

  test("refuses an uploaded workspace until it is discarded", async () => {
    await stage("stage", [dropped("a.pdf")]);
    await stage("commit");
    await stage("stageView");
    const { rejected } = await stage("stage", [
      dropped(`ws/${MANIFEST_NAME}`, EMPTY),
      dropped("ws/sources/one.pdf"),
    ]);
    expect(rejected).toEqual([
      "One workspace at a time: ws was not staged. Discard the workspace still in this browser first.",
    ]);
  });

  test("discarding it empties the browser and keeps loose copies staged", async () => {
    await stage("stage", [dropped("a.pdf")]);
    await stage("commit");
    await stage("stageView");
    await stage("stage", [dropped("b.pdf")]);
    const view = await stage("discardWorkspace");
    expect(view.workspace).toBeNull();
    expect(ids(view)).toEqual(["b"]);
    expect(await opfs("docs")).toEqual([]);
    expect(await opfs("manifestText")).toBeNull();
  });

  test("one that cannot be read is said, and nothing stages beside it until it is discarded", async () => {
    await opfs("writeText", [MANIFEST_NAME], "{");
    const view = await stage("stageView");
    expect(view.workspace).toBeNull();
    expect(view.unreadable).toBe(
      "The workspace in this browser could not be opened: its mdgest.json is not valid JSON.",
    );
    await expect(stage("stage", [dropped("a.pdf")])).rejects.toThrow(
      "Discard it before adding anything.",
    );
    await expect(stage("commit")).rejects.toThrow("could not be opened");

    const after = await stage("discardWorkspace");
    expect(after.unreadable).toBeNull();
    expect(await opfs("manifestText")).toBeNull();
    expect(ids((await stage("stage", [dropped("a.pdf")])).view)).toEqual(["a"]);
  });

  test("one written before manifests existed still lists, and gets its hashes written", async () => {
    await opfs("writeSource", "a", new TextEncoder().encode("bytes").buffer);
    const view = await stage("stageView");
    expect(view.workspace).toEqual({
      name: null,
      origin: "browser",
      listed: 1,
    });
    expect(row(view, "a").candidates).toEqual([
      { sha256: await sha("bytes"), name: "a.pdf", bytes: 5, from: "browser" },
    ]);
    expect((await stored())?.documents.a.sha256).toBe(await sha("bytes"));
  });

  test("sweep drops what a write cut short left behind", async () => {
    await opfs("writeText", [".tmp", "orphan"], "{");
    await stage("sweep");
    expect(await opfs("walk", [".tmp"])).toEqual([]);
  });
});
