/** The upload file-type policy: what a drop keeps and what it throws away. */

import { describe, expect, test } from "vitest";
import { isJunk, isManifest, isPdf, isZip } from "src/lib/upload";

describe("types", () => {
  test("match on extension, any case", () => {
    expect(isPdf("a/b.pdf")).toBe(true);
    expect(isPdf("B.PDF")).toBe(true);
    expect(isPdf("b.pdf.txt")).toBe(false);
    expect(isZip("export.ZIP")).toBe(true);
    expect(isZip("export.zip.pdf")).toBe(false);
  });

  test("a manifest is one by name, at any depth", () => {
    expect(isManifest("mdgest.json")).toBe(true);
    expect(isManifest("export/mdgest.json")).toBe(true);
    expect(isManifest("not-mdgest.json")).toBe(false);
  });
});

describe("isJunk", () => {
  test("drops desktop metadata", () => {
    expect(isJunk(".DS_Store")).toBe(true);
    expect(isJunk("scans/.DS_Store")).toBe(true);
    expect(isJunk("scans/Thumbs.db")).toBe(true);
  });

  test("drops anything under __MACOSX or a dot-folder", () => {
    expect(isJunk("__MACOSX/scan.pdf")).toBe(true);
    expect(isJunk("export/__MACOSX/._scan.pdf")).toBe(true);
    expect(isJunk(".mdgest/doc.pdf/analysis.json")).toBe(true);
    expect(isJunk("export/.git/HEAD")).toBe(true);
  });

  test("keeps a dot-file itself, and everything ordinary", () => {
    expect(isJunk(".hidden.pdf")).toBe(false);
    expect(isJunk("scans/.hidden.pdf")).toBe(false);
    expect(isJunk("manuals/hydraulics/valves.pdf")).toBe(false);
  });
});
