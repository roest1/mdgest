/** Where things live in a workspace, and what a name is allowed to be. */

import { describe, expect, test } from "vitest";
import {
  assetsDir,
  assetsPrefix,
  basename,
  byCodePoint,
  cacheDir,
  cleanId,
  cleanName,
  cleanPath,
  cleanSegment,
  copyManifest,
  docIdFor,
  emptyManifest,
  FIGURE_NAME,
  figureName,
  isDocId,
  isRecord,
  markdownPath,
  parseManifest,
  renamedId,
  slug,
  sourcePath,
  stem,
} from "src/lib/workspace";

describe("cleanSegment", () => {
  test("keeps letters of any script, digits, and . _ space -", () => {
    expect(cleanSegment("报告 2024_v1.final")).toBe("报告 2024_v1.final");
  });

  test("turns everything else into one dash", () => {
    expect(cleanSegment("a/b\\c:d*e?f")).toBe("a-b-c-d-e-f");
    expect(cleanSegment("a!!!b")).toBe("a-b");
    expect(cleanSegment("///")).toBe("-");
  });

  test("normalizes to NFC so one name is one id", () => {
    expect(cleanSegment("café")).toBe("café");
  });

  test("trims leading and trailing dots and spaces", () => {
    expect(cleanSegment("  ..name..  ")).toBe("name");
  });

  test("falls back to untitled when nothing is left", () => {
    expect(cleanSegment("")).toBe("untitled");
    expect(cleanSegment("...")).toBe("untitled");
  });

  test("cuts to 248 UTF-8 bytes, never inside a character", () => {
    const ascii = cleanSegment("a".repeat(300));
    expect(ascii).toHaveLength(248);
    // Three bytes each: 82 fit in 246, and the 83rd would cross the cap.
    const wide = cleanSegment("報".repeat(100));
    expect(wide).toBe("報".repeat(82));
  });
});

describe("cleanPath and cleanId", () => {
  test("a folder never ends the way a document's paths do", () => {
    expect(cleanPath("pumps.pdf/intake.assets/x.md")).toBe(
      "pumps-pdf/intake-assets/x-md",
    );
  });

  test("but an id's last name keeps its dots", () => {
    expect(cleanId("pumps.pdf/notes.v2")).toBe("pumps-pdf/notes.v2");
  });

  test("drops traversal and empty names rather than refusing them", () => {
    expect(cleanId("../a//./b/../c")).toBe("a/b/c");
    expect(cleanId("a\\b\\c")).toBe("a/b/c");
  });

  test("is empty for a path with no names", () => {
    expect(cleanId("")).toBe("");
    expect(cleanId("./..")).toBe("");
  });

  test("is idempotent", () => {
    const once = cleanId("..//A b.pdf/c:d");
    expect(cleanId(once)).toBe(once);
  });
});

describe("slug, basename, stem", () => {
  test("slug lowercases and hyphenates in any script", () => {
    expect(slug("Scan 1 (Final)")).toBe("scan-1-final");
    expect(slug("Übersicht Q3")).toBe("übersicht-q3");
    expect(slug("---")).toBe("doc");
  });

  test("basename is the last name, stem drops one extension", () => {
    expect(basename("a/b/c.pdf")).toBe("c.pdf");
    expect(basename("c.pdf")).toBe("c.pdf");
    expect(stem("a/b/c.tar.pdf")).toBe("c.tar");
    expect(stem(".hidden")).toBe(".hidden");
    expect(stem("noext")).toBe("noext");
  });
});

describe("isDocId", () => {
  test("accepts what cleaning leaves alone, and nothing else", () => {
    expect(isDocId("manuals/hydraulics/scan-1")).toBe(true);
    expect(isDocId("报告/2024")).toBe(true);
    expect(isDocId("")).toBe(false);
    expect(isDocId("a/../b")).toBe(false);
    expect(isDocId("a//b")).toBe(false);
    expect(isDocId("x.pdf/y")).toBe(false);
    expect(isDocId("a:b")).toBe(false);
    expect(isDocId(" a")).toBe(false);
  });
});

describe("byCodePoint", () => {
  test("orders by code point, the same on every machine", () => {
    expect(["b", "B", "a", "ä"].sort(byCodePoint)).toEqual([
      "B",
      "a",
      "b",
      "ä",
    ]);
    expect(byCodePoint("a", "a")).toBe(0);
  });

  test("orders astral characters by code point, not UTF-16 unit", () => {
    expect(["😀", "\uff01", "a"].sort(byCodePoint)).toEqual([
      "a",
      "\uff01",
      "😀",
    ]);
    expect(byCodePoint("a", "ab")).toBe(-1);
    expect(byCodePoint("😀", "😀")).toBe(0);
  });
});

describe("a document's places", () => {
  test("each hangs off its id with the layout's suffix", () => {
    expect(sourcePath("a/b")).toEqual(["sources", "a", "b.pdf"]);
    expect(markdownPath("a/b")).toEqual(["markdown", "a", "b.md"]);
    expect(assetsDir("a/b")).toEqual(["markdown", "a", "b.assets"]);
    expect(assetsPrefix("a/b")).toBe("b.assets/");
    expect(cacheDir("a/b")).toEqual([".mdgest", "a", "b.pdf"]);
  });

  test("refuse anything that is not an id", () => {
    expect(() => sourcePath("")).toThrow("not a document id");
    expect(() => cacheDir("a/../b")).toThrow("not a document id");
  });

  test("a figure's name is one FIGURE_NAME reads back", () => {
    const name = figureName(3, 12);
    expect(name).toBe("p3-i12.png");
    expect(FIGURE_NAME.test(name)).toBe(true);
    expect(FIGURE_NAME.test("../p3-i12.png")).toBe(false);
  });
});

describe("docIdFor", () => {
  test("keeps the folders a file arrived in and slugs its stem", () => {
    expect(docIdFor("manuals/Hydraulics/Scan 1.PDF")).toBe(
      "manuals/Hydraulics/scan-1",
    );
  });

  test("puts the file under the folder it is given", () => {
    expect(docIdFor("scan.pdf", "invoices")).toBe("invoices/scan");
    expect(docIdFor("a/scan.pdf", "invoices/2024")).toBe(
      "invoices/2024/a/scan",
    );
  });

  test("cleans traversal out of both parts", () => {
    expect(docIdFor("../../etc/passwd.pdf", "..")).toBe("etc/passwd");
  });
});

describe("renamedId", () => {
  test("lands in the document's own folder, through the same rules", () => {
    expect(renamedId("invoices/a", "B Copy")).toBe("invoices/b-copy");
    expect(renamedId("a", "b")).toBe("b");
  });

  test("takes an optional .pdf and nothing else for an extension", () => {
    expect(renamedId("x/a", "b.pdf")).toBe("x/b");
    expect(renamedId("x/a", "b.PDF")).toBe("x/b");
    expect(renamedId("x/a", "v2.1")).toBe("x/v2-1");
  });

  test("gives no id for a name with no letter or digit", () => {
    expect(renamedId("a/b", ".")).toBe("");
    expect(renamedId("a/b", "..")).toBe("");
    expect(renamedId("a/b", "...pdf")).toBe("");
    expect(renamedId("a/b", "---")).toBe("");
    expect(renamedId("a", "/")).toBe("");
  });

  test("treats a separator as punctuation, never as a folder", () => {
    expect(renamedId("invoices/a", "x/y")).toBe("invoices/x-y");
    expect(renamedId("invoices/a", "x\\y")).toBe("invoices/x-y");
    expect(renamedId("invoices/a", "../y")).toBe("invoices/y");
  });

  test("gives no id for an empty name", () => {
    expect(renamedId("a/b", "")).toBe("");
    expect(renamedId("a/b", "   ")).toBe("");
    expect(renamedId("a/b", ".pdf")).toBe("");
    expect(renamedId("a/b", " .PDF ")).toBe("");
  });
});

describe("cleanName", () => {
  test("collapses whitespace and control characters", () => {
    expect(cleanName("  My\t\nWorkspace \u0007 ")).toBe("My Workspace");
  });

  test("is null when nothing is left", () => {
    expect(cleanName("")).toBeNull();
    expect(cleanName(" \u0000 ")).toBeNull();
    expect(cleanName("\u200b")).toBeNull();
    expect(cleanName("a\u202eb")).toBe("a b");
    expect(cleanName("👨\u200d👩\u200d👧")).toBe("👨\u200d👩\u200d👧");
  });

  test("keeps the non-joiner Persian and Indic spelling needs", () => {
    expect(cleanName("نامه\u200cها")).toBe("نامه\u200cها");
    expect(cleanName("क\u200cष")).toBe("क\u200cष");
  });

  test("drops a joiner that is not between two visible characters", () => {
    expect(cleanName("\u200d")).toBeNull();
    expect(cleanName("\u200d\u200c\u200d")).toBeNull();
    expect(cleanName("\u200dabc\u200c")).toBe("abc");
    expect(cleanName("a\u200d \u200cb")).toBe("a b");
    expect(cleanName("a \u200d\u200c b")).toBe("a b");
  });

  test("keeps 80 code points, not 80 UTF-16 units", () => {
    const emoji = "😀".repeat(100);
    expect(cleanName(emoji)).toBe("😀".repeat(80));
  });

  test("cuts between graphemes, never inside one", () => {
    const family = "👨\u200d👩\u200d👧";
    expect(cleanName("a".repeat(79) + family)).toBe("a".repeat(79) + family);
    expect(cleanName("a".repeat(80) + family)).toBe("a".repeat(80));
    // A base and its combining mark, where NFC has no composed form.
    expect(cleanName("a".repeat(79) + "क\u093f")).toBe(
      "a".repeat(79) + "क\u093f",
    );
    expect(cleanName("a".repeat(80) + "क\u093f")).toBe("a".repeat(80));
  });
});

describe("manifests", () => {
  test("are made with no prototype, so __proto__ is an ordinary id", () => {
    const m = emptyManifest();
    expect(Object.getPrototypeOf(m.documents)).toBeNull();
    m.documents["__proto__"] = { sha256: "a".repeat(64) };
    expect("__proto__" in m.documents).toBe(true);
    expect(Object.getPrototypeOf(m.documents)).toBeNull();
    expect("constructor" in m.documents).toBe(false);
  });

  test("copy shares entries but not the map", () => {
    const m = emptyManifest();
    m.documents.a = { sha256: "a".repeat(64) };
    const copy = copyManifest(m);
    copy.documents.b = {};
    expect("b" in m.documents).toBe(false);
    expect(copy.documents.a).toBe(m.documents.a);
    expect(Object.getPrototypeOf(copy.documents)).toBeNull();
  });
});

describe("parseManifest", () => {
  const good = { format: 1, documents: { "a/b": { sha256: "0".repeat(64) } } };

  test("reads a manifest and copies its documents off the prototype", () => {
    const m = parseManifest(JSON.stringify(good));
    expect(m.format).toBe(1);
    expect(m.documents["a/b"]?.sha256).toBe("0".repeat(64));
    expect(Object.getPrototypeOf(m.documents)).toBeNull();
    expect(m.name).toBeUndefined();
  });

  test("keeps what it does not read", () => {
    const m = parseManifest(
      JSON.stringify({
        ...good,
        rules: { x: 1 },
        documents: { a: { edits: 1 } },
      }),
    );
    expect(m.rules).toEqual({ x: 1 });
    expect(m.documents.a).toEqual({ edits: 1 });
  });

  test("cleans a name and drops one that is not a string", () => {
    expect(
      parseManifest(JSON.stringify({ ...good, name: "  A  B " })).name,
    ).toBe("A B");
    expect(
      parseManifest(JSON.stringify({ ...good, name: 7 })).name,
    ).toBeUndefined();
    expect(
      parseManifest(JSON.stringify({ ...good, name: "  " })).name,
    ).toBeUndefined();
  });

  test.each([
    ["{", "is not valid JSON"],
    ["[]", "is not a JSON object"],
    ['{"format":2,"documents":{}}', "newer version"],
    ['{"format":0,"documents":{}}', "not in a format this version reads"],
    ['{"format":1}', "has no documents map"],
    ['{"format":1,"documents":{"a/../b":{}}}', "not a document id"],
    ['{"format":1,"documents":{"":{}}}', "not a document id"],
    ['{"format":1,"documents":{"a":1}}', "not an object"],
    ['{"format":1,"documents":{"a":{"sha256":"xyz"}}}', "not a SHA-256"],
  ])("refuses %s", (text, reason) => {
    expect(() => parseManifest(text)).toThrow(reason);
    expect(() => parseManifest(text)).toThrow(/^its mdgest\.json /);
  });
});

describe("isRecord", () => {
  test("is a plain object and nothing else", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });
});
