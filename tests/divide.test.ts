/** Dividing a block: the pieces cuts make, how the markdown writes them,
 *  and how join makes them whole again. */

import { describe, expect, test } from "vitest";
import { ANALYSIS_FORMAT, READER, type Analysis, type Block, type Line } from "src/lib/analysis";
import { divideBlock, divided, wordsOf } from "src/lib/divide";
import { blankEdits, checkEdits, join, setCuts, undo } from "src/lib/edits";
import { emit } from "src/lib/emit";

function line(text: string, y: number): Line {
  return { text, box: { x: 100, y, w: text.length * 5, h: 10 }, size: 10, bold: false, italic: false, font: "Body" };
}

/** One page: a paragraph whose three printed lines are three drawn-bullet
 *  items run together, the second starting with a typed marker, and the
 *  nav bar printed on one line. */
function page(): Analysis {
  const lines = [
    line("Costs exclude underfunded", 100),
    line("• Scans cost on average", 112),
    line("Scanners cost more", 124),
    line("Introduction Projects Conclusion", 20),
  ];
  const block = (id: string, li: number[], text: string): Block => ({
    id,
    kind: "text",
    page: 1,
    box: { x: 100, y: lines[li[0]].box.y, w: 200, h: 10 * li.length },
    lines: li,
    text,
    role: "para",
    level: 0,
    depth: 0,
    bold: false,
    italic: false,
    marker: "",
    size: 10,
    font: "Body",
    picture: -1,
  });
  return {
    format: ANALYSIS_FORMAT,
    reader: READER,
    bodySize: 10,
    pages: [
      {
        n: 1,
        width: 600,
        height: 800,
        lines,
        pictures: [],
        blocks: [
          block("p1b0", [3], "Introduction Projects Conclusion"),
          block("p1b1", [0, 1, 2], "Costs exclude underfunded • Scans cost on average Scanners cost more"),
        ],
      },
    ],
  };
}

const doc = page();
const [nav, para] = doc.pages[0].blocks;

describe("words", () => {
  test("each word sits on its line, left to right", () => {
    const words = wordsOf(nav, doc.pages[0]);
    expect(words.map((w) => w.text)).toEqual(["Introduction", "Projects", "Conclusion"]);
    expect(words[0].x0).toBe(100);
    expect(words[1].x0).toBeGreaterThan(words[0].x1);
  });
});

describe("pieces", () => {
  test("a cut mid-line divides the words exactly", () => {
    const pieces = divideBlock(nav, doc.pages[0], [1, 2]);
    expect(pieces.map((p) => [p.id, p.text])).toEqual([
      ["p1b0", "Introduction"],
      ["p1b0c1", "Projects"],
      ["p1b0c2", "Conclusion"],
    ]);
    expect(pieces[1].box.x).toBeGreaterThan(pieces[0].box.x + pieces[0].box.w);
    expect(pieces[1].piece).toEqual({ of: "p1b0", from: 1, to: 2 });
  });

  test("a piece that starts with a marker is that kind of list item", () => {
    const [, second] = divideBlock(para, doc.pages[0], [3]);
    expect(second).toMatchObject({ role: "bullet", marker: "•", text: "Scans cost on average Scanners cost more" });
  });

  test("cuts outside the words are no cuts", () => {
    expect(divideBlock(nav, doc.pages[0], [0, 3, 9])).toEqual([nav]);
  });
});

describe("in the markdown", () => {
  const edits = setCuts(blankEdits(), "p1b0", [1, 2]);

  test("each piece is its own numbered block", () => {
    const md = emit(doc, "a/", edits);
    expect(md.text).toMatch(/^Introduction\n\nProjects\n\nConclusion\n/);
    expect(md.blocks.p1b0c1.n).toBe(2);
    expect(md.blocks.p1b1.n).toBe(4);
    expect(divided(doc, edits.cuts)).toBe(divided(doc, edits.cuts));
  });

  test("edits keyed to a piece apply to it", () => {
    const hidden = { ...edits, blocks: { p1b0c1: { deleted: true } } };
    expect(emit(doc, "a/", hidden).text).not.toContain("Projects");
  });

  test("dividing is one undo step", () => {
    expect(undo(edits).cuts).toBeUndefined();
  });
});

describe("join makes pieces whole again", () => {
  const edits = setCuts(blankEdits(), "p1b0", [1, 2]);

  test("neighboring pieces of one block lose the cut between them", () => {
    expect(join(edits, ["p1b0c1", "p1b0c2"]).cuts).toEqual({ p1b0: [1] });
    expect(join(edits, ["p1b0", "p1b0c1", "p1b0c2"]).cuts).toBeUndefined();
  });

  test("pieces that are not neighbors join as blocks do", () => {
    const joined = join(edits, ["p1b0", "p1b0c2"]);
    expect(joined.cuts).toEqual(edits.cuts);
    expect(joined.joins).toEqual({ p1b0c2: "p1b0" });
  });
});

test("cuts that are not word positions are refused", () => {
  expect(() => checkEdits({ ...blankEdits(), cuts: { p1b0: [0] } }, "its edits.json")).toThrow(/divides/);
  expect(checkEdits({ ...blankEdits(), cuts: { p1b0: [2] } }, "its edits.json").cuts).toEqual({ p1b0: [2] });
});
