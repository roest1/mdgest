/** Page furniture -- printed page numbers, repeated headers and footers:
 *  what counts as each, and what each setting writes. */

import { describe, expect, test } from "vitest";
import {
  ANALYSIS_FORMAT,
  READER,
  type Analysis,
  type Block,
} from "src/lib/analysis";
import {
  blankEdits,
  checkEdits,
  setFurniture,
  undo,
  type Edits,
} from "src/lib/edits";
import { emit } from "src/lib/emit";
import {
  countFurniture,
  headersFooters,
  label,
  wording,
} from "src/lib/furniture";

/** A text block at height `y` of an 800-high page. */
function block(
  id: string,
  text: string,
  y: number,
  marker = "",
  page = 1,
): Block {
  return {
    id,
    kind: "text",
    page,
    box: { x: 280, y, w: 40, h: 10 },
    lines: [],
    text,
    role: marker ? "numbered" : "para",
    level: 0,
    depth: 0,
    bold: false,
    italic: false,
    marker,
    size: 10,
    font: "Body",
    picture: -1,
  };
}

function analysis(blocks: Block[]): Analysis {
  return {
    format: ANALYSIS_FORMAT,
    reader: READER,
    bodySize: 10,
    pages: [{ n: 1, width: 600, height: 800, lines: [], pictures: [], blocks }],
  };
}

const doc = analysis([
  block("p1b0", "Body text.", 300),
  block("p1b1", "4", 400), // a bare number in the body: not a page number
  block("p1b2", "Page 12 of 40", 770),
]);

describe("label", () => {
  test.each([
    ["12", "12"],
    ["iv", "iv"],
    ["Page 12", "12"],
    ["12 of 40", "12"],
    ["- 12 -", "12"],
    ["p. 7", "7"],
  ])("%s prints %s", (text, n) => expect(label(text)).toBe(n));

  test.each([
    ["xii", "xii"],
    ["xl", "xl"],
    ["lxxxix", "lxxxix"],
    ["iv of xx", "iv"],
  ])("%s prints %s", (text, n) => expect(label(text)).toBe(n));

  // Each of these is a well-formed numeral of the full range, and none is
  // a number a page bears: a margin line printing one is a word.
  test.each([
    "civil",
    "did",
    "mill",
    "Chapter 3",
    "12 apples",
    "MIX",
    "DIV",
    "CIV",
    "MI",
    "DI",
    "CI",
    "D.",
    "M",
    "C",
    "D",
  ])("%s is not one", (text) => expect(label(text)).toBeNull());
});

describe("page numbers", () => {
  const withSetting = (p: "keep" | "hide" | "delete"): Edits =>
    setFurniture(blankEdits(), "page_numbers", p);

  test("only a number in the margin band counts", () => {
    expect(countFurniture(doc).page_numbers).toBe(1);
  });

  test("keep leaves it as text", () => {
    expect(emit(doc, "a/", withSetting("keep")).text).toContain(
      "Page 12 of 40",
    );
  });

  test("hide writes the number it prints as a comment, still numbered", () => {
    const md = emit(doc, "a/", withSetting("hide"));
    expect(md.text).toContain("<!-- page 12 -->");
    expect(md.text).not.toContain("Page 12 of 40");
    expect(md.blocks.p1b2).toMatchObject({ hidden: true, n: 3 });
  });

  test("delete takes it out, and the body's bare 4 stays", () => {
    const md = emit(doc, "a/", withSetting("delete"));
    expect(md.text).not.toContain("Page 12");
    expect(md.blocks.p1b2).toMatchObject({ deleted: true, n: 0 });
    expect(md.blocks.p1b1.deleted).toBe(false);
  });

  test("a block deleted by hand stays deleted under hide", () => {
    const edits = setFurniture(
      { ...blankEdits(), blocks: { p1b2: { deleted: true } } },
      "page_numbers",
      "hide",
    );
    expect(emit(doc, "a/", edits).blocks.p1b2.deleted).toBe(true);
  });

  test("is one undo step, and keep is stored as nothing", () => {
    const hidden = withSetting("hide");
    expect(hidden.page_numbers).toBe("hide");
    const back = undo(hidden);
    expect(back.page_numbers).toBeUndefined();
    expect(withSetting("keep")).toEqual(blankEdits());
  });

  test("a setting the editor does not know is refused", () => {
    expect(() =>
      checkEdits({ ...blankEdits(), page_numbers: "mark" }, "its edits.json"),
    ).toThrow(/page_numbers/);
  });
});

/** Three pages: a running header and footer on each, a section title
 *  printed in the body of two, and a one-off line in the margin of one. */
function threePages(): Analysis {
  const page = (n: number, blocks: Block[]) => ({
    n,
    width: 600,
    height: 800,
    lines: [],
    pictures: [],
    blocks,
  });
  return {
    format: ANALYSIS_FORMAT,
    reader: READER,
    bodySize: 10,
    pages: [1, 2, 3].map((n) =>
      page(n, [
        block(`p${n}b0`, "Annual Report 2024", 20, "", n),
        block(`p${n}b1`, n < 3 ? "Methods" : "Results", 300, "", n),
        block(`p${n}b2`, `Body text on page ${n}.`, 400, "", n),
        ...(n === 1 ? [block("p1b5", "Draft for review", 760, "", 1)] : []),
        block(`p${n}b3`, `Chapter ${n} — Findings`, 770, "", n),
        block(`p${n}b4`, `${n}`, 785, "", n),
      ]),
    ),
  };
}

describe("headers and footers", () => {
  const doc3 = threePages();
  const found = headersFooters(doc3);

  test("wording wildcards numbers, ignores case and spacing, needs a letter", () => {
    expect(wording("Chapter 2  —  FINDINGS")).toBe(
      wording("chapter 3 — findings"),
    );
    expect(wording("- 12 -")).toBe("");
  });

  test("a wording in the margin of several pages is one; the body never is", () => {
    expect([...found].sort()).toEqual(
      ["p1b0", "p1b3", "p2b0", "p2b3", "p3b0", "p3b3"].sort(),
    );
  });

  test("a margin line printed once, and the page numbers, are not", () => {
    expect(found.has("p1b5")).toBe(false);
    expect(found.has("p1b4")).toBe(false);
    expect(countFurniture(doc3)).toEqual({
      page_numbers: 3,
      headers_footers: 6,
    });
  });

  test("hide comments each one, delete takes it out, the body stays", () => {
    const hidden = emit(
      doc3,
      "a/",
      setFurniture(blankEdits(), "headers_footers", "hide"),
    );
    expect(hidden.text).toContain("<!-- Annual Report 2024 -->");
    expect(hidden.text).toMatch(/^Methods$/m);
    const deleted = emit(
      doc3,
      "a/",
      setFurniture(blankEdits(), "headers_footers", "delete"),
    );
    expect(deleted.text).not.toContain("Annual Report");
    expect(deleted.text).not.toContain("Findings");
    expect(deleted.text).toContain("Draft for review");
    expect(deleted.text).toMatch(/^1$/m);
  });

  test("the two settings are separate, and undo takes back one at a time", () => {
    const both = setFurniture(
      setFurniture(blankEdits(), "page_numbers", "delete"),
      "headers_footers",
      "hide",
    );
    const back = undo(both);
    expect(back.headers_footers).toBeUndefined();
    expect(back.page_numbers).toBe("delete");
  });
});
