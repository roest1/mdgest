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
import { blankEdits, type BlockEdit, type Edits } from "src/lib/edits";
import { emit } from "src/lib/emit";
import { measure } from "src/lib/measure";

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

const withEdits = (blocks: Record<string, BlockEdit>): Edits => ({
  ...blankEdits(),
  blocks,
});

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
  const shown = { hidden: false, deleted: false };
  expect(md.blocks).toEqual({
    p1b0: { id: "p1b0", page: 1, n: 1, from: 1, to: 1, ...shown },
    p1b1: { id: "p1b1", page: 1, n: 2, from: 3, to: 3, ...shown },
    p1b2: { id: "p1b2", page: 1, n: 3, from: 4, to: 4, ...shown },
    p2i0: { id: "p2i0", page: 2, n: 1, from: 8, to: 8, ...shown },
    p2b0: { id: "p2b0", page: 2, n: 2, from: 10, to: 10, ...shown },
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

test("a figure's path is a destination markdown reads whole", () => {
  const md = emit(
    { ...doc, pages: [page(1, [block("p1i0", "", "image")], 1)] },
    "My Report (v2).assets/",
  );
  expect(md.text).toBe(
    "![page 1 figure 1](My%20Report%20%28v2%29.assets/p1-i0.png)\n",
  );
});

test("a hidden block is a comment on its line, numbered on with the rest", () => {
  const md = emit(
    doc,
    "doc.assets/",
    withEdits({
      p1b0: { hidden: true },
      p1b2: { hidden: true },
      p1b3: { hidden: true },
    }),
  );
  // A heading's comment is the heading line; a list item's is indented into
  // the item before it, so the list goes on past it.
  expect(md.text).toBe(
    [
      "<!-- # Pumps -->",
      "",
      "1. Grease them.",
      "   <!-- 1. Log it. -->",
      "",
      "---",
      "",
      "![page 2 figure 1](doc.assets/p2-i0.png)",
      "",
      "Done.",
      "",
    ].join("\n"),
  );
  expect(md.blocks.p1b0).toEqual({
    id: "p1b0",
    page: 1,
    n: 1,
    from: 1,
    to: 1,
    hidden: true,
    deleted: false,
  });
  expect(md.blocks.p1b1).toMatchObject({ n: 2, from: 3, hidden: false });
  expect(md.blocks.p1b2).toMatchObject({ n: 3, from: 4, to: 4, hidden: true });
  // Hidden by hand, not by a setting.
  expect(md.blocks.p1b0.furniture).toBeUndefined();
  // A hidden block with no words is written nowhere, like a shown one.
  expect(md.blocks.p1b3).toBeUndefined();
  expect(md.order).toEqual(["p1b0", "p1b1", "p1b2", "p2i0", "p2b0"]);
  expect(md.lines.map((l) => l.block)).toEqual([
    "p1b0",
    null,
    "p1b1",
    "p1b2",
    null,
    null,
    null,
    "p2i0",
    null,
    "p2b0",
  ]);
});

test("every hidden block is one comment line, as the document properties count them", () => {
  const tricky: Analysis = {
    ...doc,
    pages: [
      ...doc.pages,
      page(3, [
        block("p3b0", "Flow --> out, then <!-- back"),
        block("p3b1", "<!-- typed at the start of a line, and shown."),
        block("p3b2", "After."),
      ]),
    ],
  };
  // A <!-- the page prints is escaped: left as typed at a line's start, it
  // would open a comment that runs to the end of the file.
  const none = emit(tricky, "doc.assets/");
  expect(measure(none.text).commentLines).toBe(0);
  // A heading, a list item indented into the one before, a figure, and a
  // paragraph whose own --> would end its comment early if left as typed.
  const hidden = ["p1b0", "p1b2", "p2i0", "p3b0"];
  const md = emit(
    tricky,
    "doc.assets/",
    withEdits(Object.fromEntries(hidden.map((id) => [id, { hidden: true }]))),
  );
  expect(measure(md.text).commentLines).toBe(hidden.length);
  // And the lines counted are the hidden blocks' own.
  const counted = md.text
    .split("\n")
    .flatMap((line, i) => (measure(line).commentLines ? [i + 1] : []));
  expect(counted).toEqual(hidden.map((id) => md.blocks[id].from));
});

test("a deleted block is written nowhere, gives up its number, and keeps its place in the order", () => {
  const md = emit(
    doc,
    "doc.assets/",
    withEdits({ p1b1: { deleted: true }, p1b3: { deleted: true } }),
  );
  expect(md.text).toBe(
    [
      "# Pumps",
      "",
      "1. Log it.",
      "",
      "---",
      "",
      "![page 2 figure 1](doc.assets/p2-i0.png)",
      "",
      "Done.",
      "",
    ].join("\n"),
  );
  expect(md.blocks.p1b1).toEqual({
    id: "p1b1",
    page: 1,
    n: 0,
    from: 0,
    to: 0,
    hidden: false,
    deleted: true,
  });
  // The blocks after it count on without it, and the list counts from 1.
  expect(md.blocks.p1b2).toMatchObject({ n: 2, from: 3, deleted: false });
  expect(md.order).toEqual(["p1b0", "p1b1", "p1b2", "p2i0", "p2b0"]);
  expect(md.lines.some((l) => l.block === "p1b1")).toBe(false);
  // Deleted or not, a block with no words is in neither map.
  expect(md.blocks.p1b3).toBeUndefined();
});

test("a hidden figure and heading are commented as they would be written: path encoded, closing # escaped", () => {
  const md = emit(
    {
      ...doc,
      pages: [
        page(
          1,
          [block("p1b0", "Pump No. #", "heading"), block("p1i0", "", "image")],
          1,
        ),
      ],
    },
    "My Report (v2).assets/",
    withEdits({ p1b0: { hidden: true }, p1i0: { hidden: true } }),
  );
  expect(md.text).toBe(
    [
      "<!-- # Pump No. \\# -->",
      "",
      "<!-- ![page 1 figure 1](My%20Report%20%28v2%29.assets/p1-i0.png) -->",
      "",
    ].join("\n"),
  );
  expect(md.blocks.p1i0).toMatchObject({ n: 2, from: 3, hidden: true });
});

test("a hidden figure whose picture was not kept is written nowhere, like a shown one", () => {
  const md = emit(
    { ...doc, pages: [page(1, [block("p1i0", "", "image")], 0)] },
    "doc.assets/",
    withEdits({ p1i0: { hidden: true } }),
  );
  expect(md.text).toBe("\n");
  expect(md.blocks).toEqual({});
});

/** A page of a heading, a two-item list and a paragraph, and a page after. */
const quotable: Analysis = {
  format: ANALYSIS_FORMAT,
  reader: READER,
  bodySize: 10,
  pages: [
    page(1, [
      block("p1b0", "Pumps", "heading"),
      block("p1b1", "Grease them.", "numbered"),
      block("p1b2", "Log it.", "numbered"),
      block("p1b3", "Then rest."),
    ]),
    page(2, [block("p2b0", "Done.")]),
  ],
};
const quoting = (blocks: Record<string, BlockEdit>) =>
  emit(quotable, "doc.assets/", withEdits(blocks)).text;

test("quoted blocks next to each other are one quote, a list in it whole", () => {
  expect(
    quoting({
      p1b1: { quote: true },
      p1b2: { quote: true },
      p1b3: { quote: true },
    }),
  ).toBe(
    [
      "# Pumps",
      "",
      "> 1. Grease them.",
      "> 2. Log it.",
      ">",
      "> Then rest.",
      "",
      "---",
      "",
      "Done.",
      "",
    ].join("\n"),
  );
});

test("a list going out of a quote is a new list, counted from 1", () => {
  expect(quoting({ p1b0: { quote: true }, p1b1: { quote: true } })).toBe(
    [
      "> # Pumps",
      ">",
      "> 1. Grease them.",
      "",
      "1. Log it.",
      "",
      "Then rest.",
      "",
      "---",
      "",
      "Done.",
      "",
    ].join("\n"),
  );
});

test("a page's rule ends a quote: quoted blocks either side are two", () => {
  const text = quoting({ p1b3: { quote: true }, p2b0: { quote: true } });
  expect(text).toContain("> Then rest.\n\n---\n\n> Done.\n");
});

test("a hidden quoted block is its comment, quoted, and counted as one", () => {
  const text = quoting({
    p1b1: { quote: true, hidden: true },
    p1b2: { quote: true },
  });
  expect(text).toContain("> <!-- 1. Grease them. -->\n>\n> 1. Log it.\n");
  expect(measure(text).commentLines).toBe(1);
});
