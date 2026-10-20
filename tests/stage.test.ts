/** What a drop stages, and what it says about what it did not.
 *
 * The rule the landing rests on: everything dropped is either staged or
 * named in `rejected`. A row a person can see is a decision they can make;
 * a file that goes missing in silence is one they cannot. */

import { strFromU8, unzipSync } from "fflate";
import { beforeEach, describe, expect, test } from "vitest";
import type * as Stage from "src/lib/stage";
import type { StageView } from "src/lib/protocol";
import { assetsDir } from "src/lib/workspace";

type Api = typeof Stage;

const worker = new Worker(new URL("./stage.worker.ts", import.meta.url), { type: "module" });
let next = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
worker.onmessage = (event: MessageEvent<{ id: number; value?: unknown; error?: string }>) => {
  const { id, value, error } = event.data;
  const call = pending.get(id);
  pending.delete(id);
  if (error === undefined) call?.resolve(value);
  else call?.reject(new Error(error));
};

function call(mod: string, fn: string, args: unknown[]): Promise<unknown> {
  const id = next++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    worker.postMessage({ id, mod, fn, args });
  });
}

/** Call a `stage.ts` export in the worker. */
function stage<K extends keyof Api>(
  fn: K,
  ...args: Parameters<Api[K]>
): Promise<Awaited<ReturnType<Api[K]>>> {
  return call("stage", fn, args) as Promise<Awaited<ReturnType<Api[K]>>>;
}

/** A dropped file: the name is its path within the drop, the way the drop
 *  zone rewrites it before the engine sees it. */
const dropped = (path: string, text = path) => new File([text], path);

const MANIFEST = JSON.stringify({ format: 1, documents: {} });

/** An emptied stage: the workspace forgotten, every loose copy taken out,
 *  and OPFS cleared under it all. */
beforeEach(async () => {
  await call("opfs", "clearWorkspace", []);
  let view = await stage("discardWorkspace");
  for (const row of view.rows) {
    for (const candidate of row.candidates) {
      view = await stage("unstage", row.docId, candidate.sha256);
    }
  }
  expect(view.rows).toEqual([]);
});

const ids = (view: StageView) => view.rows.map((r) => r.docId).sort();

describe("a workspace folder", () => {
  test("stages the PDFs under sources/", async () => {
    const { view, rejected } = await stage("stage", [
      dropped(`ws/mdgest.json`, MANIFEST),
      dropped("ws/sources/one.pdf"),
      dropped("ws/sources/deep/two.pdf"),
    ]);
    expect(rejected).toEqual([]);
    expect(view.workspace?.name).toBe("ws");
    expect(ids(view)).toEqual(["deep/two", "one"]);
  });

  test("says so when a PDF in it is outside sources/", async () => {
    const { view, rejected } = await stage("stage", [
      dropped(`ws/mdgest.json`, MANIFEST),
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
});

describe("a workspace's name", () => {
  test("is the folder it arrived as, when its manifest has none", async () => {
    await stage("stage", [dropped("ws/mdgest.json", MANIFEST), dropped("ws/sources/one.pdf")]);
    await stage("commit");
    expect(await stage("workspaceName")).toBe("ws");
  });

  test("is its manifest's own over the zip's or folder's it came in", async () => {
    // An export's zip is named for the day it was made; the manifest is
    // what says which workspace it is.
    const named = JSON.stringify({ format: 1, name: "Papers", documents: {} });
    await stage("stage", [
      dropped("papers-2026-10-20/mdgest.json", named),
      dropped("papers-2026-10-20/sources/one.pdf"),
    ]);
    await stage("commit");
    expect(await stage("workspaceName")).toBe("Papers");
  });

  test("is none for loose PDFs, until one is given and kept as cleaned", async () => {
    await stage("stage", [dropped("one.pdf")]);
    await stage("commit");
    expect(await stage("workspaceName")).toBeNull();
    expect(await stage("renameWorkspace", "  My \t papers\n")).toBe("My papers");
    expect(await stage("workspaceName")).toBe("My papers");
    await expect(stage("renameWorkspace", " \n ")).rejects.toThrow("cannot be empty");
  });

  test("goes out with an export, and comes back with it", async () => {
    await stage("stage", [dropped("one.pdf")]);
    await stage("commit");
    await stage("renameWorkspace", "Papers");
    const zip = unzipSync(await stage("exportZip", false));
    const manifest = JSON.parse(strFromU8(zip["mdgest.json"])) as { name?: string };
    expect(manifest.name).toBe("Papers");
  });

  test("set from the editor does not read to the landing as another tab's write", async () => {
    // The landing seeded the stage, and the person went to the editor
    // without committing: the stage's look at the manifest predates the
    // rename, and a commit must still go through.
    await stage("stage", [dropped("one.pdf")]);
    await stage("commit");
    await stage("stageView");
    await stage("renameWorkspace", "Papers");
    await stage("stage", [dropped("two.pdf")]);
    await stage("commit");
    expect(await stage("workspaceName")).toBe("Papers");
  });
});

describe("a document's figures, measured", () => {
  test("are every file in its assets folder, counted and summed", async () => {
    expect(await stage("assetBytes", "one")).toEqual({ files: 0, bytes: 0 });
    await call("opfs", "writeFile", [[...assetsDir("one"), "p1-i0.png"], new Uint8Array(300)]);
    await call("opfs", "writeFile", [[...assetsDir("one"), "p2-i0.png"], new Uint8Array(45)]);
    await call("opfs", "writeFile", [[...assetsDir("two"), "p1-i0.png"], new Uint8Array(9)]);
    expect(await stage("assetBytes", "one")).toEqual({ files: 2, bytes: 345 });
  });
});
