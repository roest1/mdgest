/** A zip upload opened into the shape a dropped folder arrives in: PDFs and
 *  manifests, by path, with everything else left in the archive. */

import { strFromU8, strToU8, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { MAX_ENTRIES } from "src/lib/limits";
import { unzip } from "src/lib/unzip";

/** An archive of `files`, each entry's text its own name unless given. */
function archive(files: Record<string, string | undefined>): ArrayBuffer {
  const entries = Object.fromEntries(
    Object.entries(files).map(([name, text]) => [name, strToU8(text ?? name)]),
  );
  const zipped = zipSync(entries);
  return zipped.buffer.slice(
    zipped.byteOffset,
    zipped.byteOffset + zipped.byteLength,
  ) as ArrayBuffer;
}

const paths = (buf: ArrayBuffer) =>
  unzip(buf)
    .map((e) => e.path)
    .sort();

describe("unzip", () => {
  test("keeps PDFs and manifests and leaves everything else", () => {
    const buf = archive({
      "mdgest.json": "{}",
      "sources/a.pdf": undefined,
      "sources/deep/b.PDF": undefined,
      "markdown/a.md": undefined,
      "markdown/a.assets/p1-i1.png": undefined,
      "notes.txt": undefined,
    });
    expect(paths(buf)).toEqual([
      "mdgest.json",
      "sources/a.pdf",
      "sources/deep/b.PDF",
    ]);
  });

  test("drops junk the zip tool put there", () => {
    const buf = archive({
      "__MACOSX/._a.pdf": undefined,
      "sources/.DS_Store": undefined,
      ".mdgest/a.pdf/analysis.json": undefined,
      "a.pdf": undefined,
    });
    expect(paths(buf)).toEqual(["a.pdf"]);
  });

  test("reads backslashed and leading-slash names as paths", () => {
    const buf = archive({
      "ws\\mdgest.json": "{}",
      "/ws/sources/a.pdf": undefined,
    });
    expect(paths(buf)).toEqual(["ws/mdgest.json", "ws/sources/a.pdf"]);
  });

  test("hands back each entry's bytes", () => {
    const buf = archive({ "a.pdf": "%PDF-1.7 hello" });
    const [entry] = unzip(buf);
    expect(strFromU8(entry.bytes)).toBe("%PDF-1.7 hello");
    expect(entry.bytes.buffer).toBeInstanceOf(ArrayBuffer);
  });

  test("refuses one path spelled two ways", () => {
    const buf = archive({ "a/b.pdf": undefined, "a\\b.pdf": undefined });
    expect(() => unzip(buf)).toThrow("more than once");
  });

  test("refuses more files than one archive may hold, before inflating", () => {
    const files: Record<string, undefined> = {};
    for (let i = 0; i <= MAX_ENTRIES; i++) files[`p/${i}.pdf`] = undefined;
    expect(() => unzip(archive(files))).toThrow("more than the");
  });

  test("counts only what it would inflate against that cap", () => {
    const files: Record<string, undefined> = {};
    for (let i = 0; i <= MAX_ENTRIES; i++) files[`m/${i}.png`] = undefined;
    files["a.pdf"] = undefined;
    expect(paths(archive(files))).toEqual(["a.pdf"]);
  });

  test("refuses what is not an archive", () => {
    expect(() => unzip(strToU8("not a zip").buffer as ArrayBuffer)).toThrow();
  });
});
