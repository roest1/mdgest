/** The upload file-type policy: what a drop keeps and what it throws away. */

import { describe, expect, test } from "vitest";
import {
  isJunk,
  isManifest,
  isPdf,
  isZip,
  relativeTo,
  under,
  workspaceRoots,
} from "src/lib/upload";

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
    // The same sidecar beside its file, as a USB stick or Windows leaves it.
    expect(isJunk("._scan.pdf")).toBe(true);
    expect(isJunk("export/sources/._scan.pdf")).toBe(true);
    expect(isJunk(".mdgest/doc.pdf/analysis.json")).toBe(true);
    expect(isJunk("export/.git/HEAD")).toBe(true);
  });

  test("keeps a dot-file itself, and everything ordinary", () => {
    expect(isJunk(".x/.x")).toBe(true);
    expect(isJunk("export/.mdgest/.mdgest")).toBe(true);
    expect(isJunk(".hidden.pdf")).toBe(false);
    expect(isJunk("scans/.hidden.pdf")).toBe(false);
    expect(isJunk("manuals/hydraulics/valves.pdf")).toBe(false);
  });
});

describe("workspaceRoots", () => {
  test("is the root when the manifest is at the top of the drop", () => {
    expect(workspaceRoots(["mdgest.json", "sources/a.pdf"])).toEqual([""]);
  });

  test("is the folder when an export was dropped or zipped whole", () => {
    expect(workspaceRoots(["ws/mdgest.json", "ws/sources/a.pdf"])).toEqual([
      "ws",
    ]);
  });

  test("finds every export one level down, once each", () => {
    expect(
      workspaceRoots([
        "a/mdgest.json",
        "a/sources/x.pdf",
        "b/mdgest.json",
        "b/mdgest.json",
      ]),
    ).toEqual(["a", "b"]);
  });

  test("does not take the root workspace's own folders for exports", () => {
    expect(
      workspaceRoots([
        "mdgest.json",
        "sources/mdgest.json",
        "markdown/mdgest.json",
      ]),
    ).toEqual([""]);
    // Without a root manifest those folders are just folders.
    expect(workspaceRoots(["sources/mdgest.json"])).toEqual(["sources"]);
  });

  test("looks no deeper than one folder", () => {
    expect(workspaceRoots(["x/y/mdgest.json", "loose.pdf"])).toEqual([]);
    expect(workspaceRoots(["/mdgest.json", "/sources/a.pdf"])).toEqual([]);
  });
});

describe("under and relativeTo", () => {
  test("the root holds everything and takes nothing off", () => {
    expect(under("a/b.pdf", "")).toBe(true);
    expect(relativeTo("a/b.pdf", "")).toBe("a/b.pdf");
  });

  test("a folder holds only paths below it, by whole name", () => {
    expect(under("ws/sources/a.pdf", "ws")).toBe(true);
    expect(under("ws", "ws")).toBe(false);
    expect(under("wsx/a.pdf", "ws")).toBe(false);
    expect(relativeTo("ws/sources/a.pdf", "ws")).toBe("sources/a.pdf");
  });
});
