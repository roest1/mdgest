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

/** `buf` with one central-directory field of the entry called `name`
 *  rewritten: the general-purpose flag (offset 8) or the method (offset 10).
 *  What a zip tool writes for an encrypted or LZMA entry, without the tool. */
function patched(
  buf: ArrayBuffer,
  name: string,
  field: "flag" | "method",
  value: number,
): ArrayBuffer {
  const d = new Uint8Array(buf.slice(0));
  const want = strToU8(name);
  for (let at = 0; at + 46 <= d.length; at++) {
    if (
      d[at] !== 0x50 ||
      d[at + 1] !== 0x4b ||
      d[at + 2] !== 1 ||
      d[at + 3] !== 2
    )
      continue;
    const nameLength = d[at + 28]! | (d[at + 29]! << 8);
    const found = d.subarray(at + 46, at + 46 + nameLength);
    if (found.length !== want.length || !found.every((b, i) => b === want[i]))
      continue;
    const off = at + (field === "flag" ? 8 : 10);
    d[off] = value & 0xff;
    d[off + 1] = value >> 8;
    return d.buffer as ArrayBuffer;
  }
  throw new Error(`no central header for ${name}`);
}

/** `buf` with the end record's total-entries field (offset 10) set to
 *  `total`, leaving the on-this-disk count (offset 8) as written. The two
 *  agree in every archive a tool makes; a crafted one can say otherwise. */
function totalEntries(buf: ArrayBuffer, total: number): ArrayBuffer {
  const d = new Uint8Array(buf.slice(0));
  for (let e = d.length - 22; e >= 0; e--) {
    if (
      d[e] === 0x50 &&
      d[e + 1] === 0x4b &&
      d[e + 2] === 5 &&
      d[e + 3] === 6
    ) {
      d[e + 10] = total & 0xff;
      d[e + 11] = total >> 8;
      return d.buffer as ArrayBuffer;
    }
  }
  throw new Error("no end record");
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

  test("reads ./-prefixed and traversing names as paths", () => {
    const buf = archive({
      "./mdgest.json": "{}",
      "./sources/a.pdf": undefined,
      "sources/../b.pdf": undefined,
    });
    // `..` is dropped, not resolved -- the spelling `cleanId` gives it too.
    expect(paths(buf)).toEqual([
      "mdgest.json",
      "sources/a.pdf",
      "sources/b.pdf",
    ]);
  });

  test("leaves folder entries alone, whatever they are called", () => {
    const buf = archive({ "a.pdf/": "", "b.pdf": undefined });
    expect(paths(buf)).toEqual(["b.pdf"]);
  });

  test("refuses a password-protected entry rather than its ciphertext", () => {
    const buf = patched(
      archive({ "a.pdf": undefined, "b.pdf": undefined }),
      "b.pdf",
      "flag",
      1,
    );
    expect(() => unzip(buf)).toThrow("b.pdf, which is password-protected");
    // Its own sentence, not re-wrapped as fflate's failure to open the zip.
    expect(() => unzip(buf)).not.toThrow("could not be opened");
  });

  test("walks the directory by the count fflate uses, not the total", () => {
    // Two entries on this disk, the second encrypted, and a total that
    // claims one: fflate inflates both, so the scan has to see both.
    const buf = totalEntries(
      patched(
        archive({ "a.pdf": undefined, "b.pdf": undefined }),
        "b.pdf",
        "flag",
        1,
      ),
      1,
    );
    expect(() => unzip(buf)).toThrow("b.pdf, which is password-protected");
  });

  test("ignores a password on an entry it would not open anyway", () => {
    const buf = patched(
      archive({ "a.pdf": undefined, "notes.txt": undefined }),
      "notes.txt",
      "flag",
      1,
    );
    expect(paths(buf)).toEqual(["a.pdf"]);
  });

  test("refuses a compression method it cannot open, in its own words", () => {
    const buf = patched(archive({ "a.pdf": undefined }), "a.pdf", "method", 14);
    expect(() => unzip(buf)).toThrow("method 14");
    expect(() => unzip(buf)).not.toThrow("unknown compression type");
  });

  test("hands back each entry's bytes", () => {
    const buf = archive({ "a.pdf": "%PDF-1.7 hello" });
    const [entry] = unzip(buf);
    expect(strFromU8(entry.bytes)).toBe("%PDF-1.7 hello");
    expect(entry.bytes.buffer).toBeInstanceOf(ArrayBuffer);
  });

  test("refuses one path spelled two ways", () => {
    const buf = archive({ "a/b.pdf": undefined, "a\\b.pdf": undefined });
    expect(() => unzip(buf)).toThrow(/^it holds a\/b\.pdf more than once\.$/);
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

  test("refuses what is not an archive, in its own words", () => {
    expect(() => unzip(strToU8("not a zip").buffer as ArrayBuffer)).toThrow(
      "could not be opened as a zip archive",
    );
  });
});
