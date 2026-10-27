/** Where each block went: the numbers and source lines `emit` hands the
 *  panes beside the markdown. What the markdown says is the reader cases'
 *  to check (`reader.test.ts`); this checks the map from blocks to it. */

import { expect, test } from "vitest";
import {
  ANALYSIS_FORMAT,
  READER,
  type Analysis,
  type Block,
  type Page,
  type Role,
} from "src/lib/analysis";
import { emit } from "src/lib/emit";

function block(id: string, text: string, role: Role = "para"): Block {
  return {
    id,
    kind: role === "image" ? "image" : "text",
    page: Number(id.slice(1, id.indexOf(role === "image" ? "i" : "b"))),
    box: { x: 0, y: 0, w: 100, h: 10 },
    lines: [],
    text,
    role,
    level: role === "heading" ? 1 : 0,
    depth: 0,
    bold: false,
    italic: false,
    marker: role === "numbered" ? "1." : "",
    size: 10,
    font: "Body",
    picture: role === "image" ? 0 : -1,
  };
}

function page(n: number, blocks: Block[], pictures = 0): Page {
  return {
    n,
    width: 612,
    height: 792,
    lines: [],
    pictures: Array.from({ length: pictures }, (_, i) => ({
      box: { x: 0, y: 0, w: 100, h: 100 },
      path: `p${n}-i${i}.png`,
      px: [100, 100],
    })),
    blocks,
  };
}

const doc: Analysis = {
  format: ANALYSIS_FORMAT,
  reader: READER,
  bodySize: 10,
  pages: [
    page(1, [
      block("p1b0", "Pumps", "heading"),
      block("p1b1", "Grease them.", "numbered"),
      block("p1b2", "Log it.", "numbered"),
      block("p1b3", "   "),
    ]),
    page(2, [block("p2i0", "", "image"), block("p2b0", "Done.")], 1),
  ],
};

test("each block is numbered on its page and placed on its line", () => {
  const md = emit(doc, "doc.assets/");
  expect(md.text).toBe(
    [
      "# Pumps",
      "",
      "1. Grease them.",
      "2. Log it.",
      "",
      "---",
      "",
      "![page 2 figure 1](doc.assets/p2-i0.png)",
      "",
      "Done.",
      "",
    ].join("\n"),
  );
  expect(md.blocks).toEqual({
    p1b0: { id: "p1b0", page: 1, n: 1, from: 1, to: 1 },
    p1b1: { id: "p1b1", page: 1, n: 2, from: 3, to: 3 },
    p1b2: { id: "p1b2", page: 1, n: 3, from: 4, to: 4 },
    p2i0: { id: "p2i0", page: 2, n: 1, from: 8, to: 8 },
    p2b0: { id: "p2b0", page: 2, n: 2, from: 10, to: 10 },
  });
  // A block with no words is written nowhere and numbered nowhere.
  expect(md.order).toEqual(["p1b0", "p1b1", "p1b2", "p2i0", "p2b0"]);
});

test("each source line names its block, and the rule is the next page's", () => {
  const { lines } = emit(doc, "doc.assets/");
  expect(lines.map((l) => [l.block, l.page])).toEqual([
    ["p1b0", 1],
    [null, 1],
    ["p1b1", 1],
    ["p1b2", 1],
    [null, 1],
    [null, 2],
    [null, 2],
    ["p2i0", 2],
    [null, 2],
    ["p2b0", 2],
  ]);
});

test("a heading keeps a # it ends with, which markdown would close it with", () => {
  const md = emit(
    { ...doc, pages: [page(1, [block("p1b0", "Pump No. #", "heading")])] },
    "doc.assets/",
  );
  expect(md.text).toBe("# Pump No. \\#\n");
});
