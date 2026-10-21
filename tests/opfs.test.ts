/** The workspace's file layer against a real OPFS: what this code decides
 *  -- truncation, what counts as a document, what a removal may touch --
 *  not whether the browser can store a file.
 *
 * The test runner's origin is not the app's, so this OPFS is its own; each
 * test starts from an emptied workspace. */

import { beforeEach, describe, expect, test } from "vitest";
import type * as Opfs from "src/lib/opfs";

type Api = typeof Opfs;

const worker = new Worker(new URL("./opfs.worker.ts", import.meta.url), {
  type: "module",
});
let next = 0;
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();
worker.onmessage = (
  event: MessageEvent<{ id: number; value?: unknown; error?: string }>,
) => {
  const { id, value, error } = event.data;
  const call = pending.get(id);
  pending.delete(id);
  if (error === undefined) call?.resolve(value);
  else call?.reject(new Error(error));
};

/** Post one call to the worker and wait for its answer. */
function call(fn: string, args: unknown[]): Promise<unknown> {
  const id = next++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, fn, args });
  });
}

/** Call an `opfs.ts` export in the worker. */
function opfs<K extends keyof Api>(
  fn: K,
  ...args: Parameters<Api[K]>
): Promise<Awaited<ReturnType<Api[K]>>> {
  return call(fn, args) as Promise<Awaited<ReturnType<Api[K]>>>;
}

/** Call one of the worker's own hooks on `move`: see `opfs.worker.ts`. */
function harness(fn: "moves"): Promise<number>;
function harness(fn: "refuseMoves", on: boolean): Promise<void>;
function harness(fn: string, ...args: unknown[]): Promise<unknown> {
  return call(fn, args);
}

const bytes = (text: string) => new TextEncoder().encode(text);

beforeEach(async () => {
  await opfs("clearWorkspace");
});

describe("files", () => {
  test("a shorter write replaces a longer file whole, leaving none of its tail", async () => {
    await opfs(
      "writeText",
      ["markdown", "pumps.md"],
      '{"blocks": {"p1b0": {"role": "heading"}}}',
    );
    await opfs("writeText", ["markdown", "pumps.md"], "{}");
    expect(await opfs("readText", ["markdown", "pumps.md"])).toBe("{}");
    expect(await opfs("size", ["markdown", "pumps.md"])).toBe(2);
  });

  test("a replacing write moves the new bytes in whole and leaves no temp behind", async () => {
    const edits = [".mdgest", "pumps.pdf", "edits.json"];
    const before = await harness("moves");
    await opfs("writeText", edits, '{"blocks": {"p1b0": {"role": "heading"}}}');
    await opfs("writeText", edits, "{}");
    // Both by the move, the one way that is never torn, and not the fallback.
    expect(await harness("moves")).toBe(before + 2);
    expect(await opfs("readText", edits)).toBe("{}");
    expect(await opfs("size", edits)).toBe(2);
    expect(await opfs("walk", [".tmp"])).toEqual([]);
  });

  test("the manifest is written by a replacing write", async () => {
    const before = await harness("moves");
    await opfs("writeManifest", { format: 1, documents: {} } as Parameters<
      Api["writeManifest"]
    >[0]);
    expect(await harness("moves")).toBe(before + 1);
  });

  test("replacing writes made together each move in whole: none shares another's temp", async () => {
    const edits = [".mdgest", "pumps.pdf", "edits.json"];
    const texts = [
      "{}",
      '{"done": true}',
      '{"blocks": {}}',
      '{"blocks": {"p1b0": {}}}',
    ];
    const before = await harness("moves");
    await Promise.all(texts.map((text) => opfs("writeText", edits, text)));
    expect(await harness("moves")).toBe(before + texts.length);
    expect(texts).toContain(await opfs("readText", edits));
    expect(await opfs("walk", [".tmp"])).toEqual([]);
  });

  test("where the move is refused, the write still lands, in place, and its temp is dropped", async () => {
    const edits = [".mdgest", "pumps.pdf", "edits.json"];
    await opfs("writeText", edits, '{"blocks": {"p1b0": {"role": "heading"}}}');
    await harness("refuseMoves", true);
    try {
      await opfs("writeText", edits, "{}");
    } finally {
      await harness("refuseMoves", false);
    }
    expect(await opfs("readText", edits)).toBe("{}");
    expect(await opfs("walk", [".tmp"])).toEqual([]);
  });

  test("a write cut short before its move leaves the target as it was, and clearTemp drops only the temp", async () => {
    // What a tab closed mid-write leaves: the temp, never moved.
    await opfs(
      "writeText",
      [".mdgest", "pumps.pdf", "edits.json"],
      '{"done": true}',
    );
    await opfs("writeFile", [".tmp", "0b5f6c1e-orphan"], bytes("{"));
    expect(await opfs("readText", [".mdgest", "pumps.pdf", "edits.json"])).toBe(
      '{"done": true}',
    );

    await opfs("clearTemp");
    expect(await opfs("walk", [])).toEqual([".mdgest/pumps.pdf/edits.json"]);
  });

  test("a file that is not there reads as null, and has no size", async () => {
    expect(await opfs("readFile", ["markdown", "missing.md"])).toBeNull();
    expect(await opfs("readText", ["no-such-folder", "missing.md"])).toBeNull();
    expect(await opfs("size", ["markdown", "missing.md"])).toBeNull();
  });

  test("removing what is not there is not an error", async () => {
    await expect(
      opfs("remove", ["markdown", "missing.md"]),
    ).resolves.toBeUndefined();
    await expect(
      opfs("remove", ["no-such-folder", "missing.md"], true),
    ).resolves.toBeUndefined();
  });

  test("walk lists every file below a folder, depth first, by code point", async () => {
    for (const path of ["b.txt", "a/z.txt", "a/b/c.txt", "B.txt", "a-1.txt"]) {
      await opfs("writeText", ["markdown", ...path.split("/")], path);
    }
    expect(await opfs("walk", ["markdown"])).toEqual([
      "B.txt",
      "a/b/c.txt",
      "a/z.txt",
      "a-1.txt",
      "b.txt",
    ]);
  });

  test("sha256 is the lowercase hex of the digest", async () => {
    expect(await opfs("sha256", bytes("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("documents", () => {
  test("the document listing is the .pdf files in sources/ under valid ids, sorted by code point", async () => {
    for (const path of [
      "pumps.pdf",
      "pumps-2.pdf",
      "manuals/intake.pdf",
      "notes.txt",
      "pumps#1.pdf",
      "README",
    ]) {
      await opfs("writeFile", ["sources", ...path.split("/")], bytes("%PDF"));
    }
    // `pumps` before `pumps-2`, though `pumps-2.pdf` sorts before `pumps.pdf`.
    expect(await opfs("docs")).toEqual(["manuals/intake", "pumps", "pumps-2"]);
  });

  test("removeDerived drops a document's cache, markdown and figures, keeps its PDF, and touches no other document", async () => {
    // `pumps/intake` lives inside a folder named like `pumps`: the suffixes
    // are what keep one document's removal out of the other's files.
    for (const id of ["pumps", "pumps/intake"]) {
      const parts = id.split("/");
      const dir = parts.slice(0, -1);
      const name = parts.at(-1)!;
      await opfs(
        "writeFile",
        ["sources", ...dir, `${name}.pdf`],
        bytes("%PDF"),
      );
      await opfs(
        "writeText",
        [".mdgest", ...dir, `${name}.pdf`, "analysis.json"],
        "{}",
      );
      await opfs(
        "writeText",
        [".mdgest", ...dir, `${name}.pdf`, "edits.json"],
        "{}",
      );
      await opfs("writeText", ["markdown", ...dir, `${name}.md`], "# Pumps");
      await opfs(
        "writeFile",
        ["markdown", ...dir, `${name}.assets`, "p1-i0.png"],
        bytes("png"),
      );
    }
    const intake = [
      ".mdgest/pumps/intake.pdf/analysis.json",
      ".mdgest/pumps/intake.pdf/edits.json",
      "markdown/pumps/intake.assets/p1-i0.png",
      "markdown/pumps/intake.md",
      "sources/pumps/intake.pdf",
    ];

    await opfs("removeDerived", "pumps");

    const left = [
      ...(await opfs("walk", [".mdgest"])).map((p) => `.mdgest/${p}`),
      ...(await opfs("walk", ["markdown"])).map((p) => `markdown/${p}`),
      ...(await opfs("walk", ["sources"])).map((p) => `sources/${p}`),
    ];
    expect(left.sort()).toEqual([...intake, "sources/pumps.pdf"].sort());
  });

  test("an id that is not one never becomes a path: nothing is removed", async () => {
    await opfs("writeText", [".mdgest", "pumps.pdf", "edits.json"], "{}");
    for (const bad of ["", "../pumps", "pumps/", "a//b"]) {
      await expect(opfs("removeDerived", bad)).rejects.toThrow(
        /is not a document id/,
      );
    }
    expect(await opfs("walk", [".mdgest"])).toEqual(["pumps.pdf/edits.json"]);
  });

  test("clearing the workspace leaves it empty and still listable", async () => {
    await opfs("writeFile", ["sources", "pumps.pdf"], bytes("%PDF"));
    await opfs("writeManifest", { format: 1, documents: {} } as Parameters<
      Api["writeManifest"]
    >[0]);
    await opfs("clearWorkspace");
    expect(await opfs("docs")).toEqual([]);
    expect(await opfs("manifestText")).toBeNull();
    expect(await opfs("walk", [])).toEqual([]);
  });
});
