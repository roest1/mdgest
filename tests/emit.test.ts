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
import {
  apply,
  blankEdits,
  redo,
  revertToOriginal,
  setFurniture,
  setLine,
  undo,
  type BlockEdit,
  type Change,
  type Edits,
} from "src/lib/edits";
import { emit } from "src/lib/emit";
import { measure } from "src/lib/measure";
import { repeatedLines } from "src/lib/furniture";

function block(
  id: string,
  text: string,
  role: Role = "para",
  marker = role === "numbered" ? "1." : "",
): Block {
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
    marker,
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
      block("p1b2", "Log it.", "numbered", "2."),
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
    // A list item says how deep it was written, and the item before it.
    p1b1: {
      id: "p1b1",
      page: 1,
      n: 2,
      from: 3,
      to: 3,
      ...shown,
      item: { depth: 0, after: null },
    },
    p1b2: {
      id: "p1b2",
      page: 1,
      n: 3,
      from: 4,
      to: 4,
      ...shown,
      item: { depth: 0, after: "p1b1" },
    },
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
      "   <!-- 2. Log it. -->",
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
      block("p1b2", "Log it.", "numbered", "2."),
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

test("a list going out of a quote is a new list, from the number it printed", () => {
  expect(quoting({ p1b0: { quote: true }, p1b1: { quote: true } })).toBe(
    [
      "> # Pumps",
      ">",
      "> 1. Grease them.",
      "",
      "2. Log it.",
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
  expect(text).toContain("> <!-- 1. Grease them. -->\n>\n> 2. Log it.\n");
  expect(measure(text).commentLines).toBe(1);
});

test("a list item is written no deeper than one under the item before it", () => {
  // Asked deeper than markdown can nest: the first item at 2, the second
  // at 3. Written at 0 and 1, and said so, so indent goes by what shows.
  const md = emit(
    doc,
    "doc.assets/",
    withEdits({ p1b1: { depth: 2 }, p1b2: { depth: 3 } }),
  );
  expect(md.text).toContain("1. Grease them.\n   2. Log it.\n");
  expect(md.blocks.p1b1.item).toEqual({ depth: 0, after: null });
  expect(md.blocks.p1b2.item).toEqual({ depth: 1, after: "p1b1" });
  // A heading, picture or paragraph is no list item.
  expect(md.blocks.p1b0.item).toBeUndefined();
});

test("an ordered item is written as its place in the list as printed: c. is 3, iv. is 4", () => {
  const items = (role: Role, markers: string[]) =>
    emit(
      {
        ...doc,
        pages: [
          page(
            1,
            markers.map((marker, i) =>
              block(`p1b${i}`, `Item ${i}.`, role, marker),
            ),
          ),
        ],
      },
      "doc.assets/",
    ).text;
  expect(items("alpha", ["c.", "(d)"])).toBe("3. Item 0.\n4. Item 1.\n");
  expect(items("roman", ["iv.", "v)", "IX."])).toBe(
    "4. Item 0.\n5. Item 1.\n9) Item 2.\n",
  );
  // A marker that says no place, as on a block made an item by hand, is
  // counted on from the item before.
  expect(items("numbered", ["7.", ""])).toBe("7. Item 0.\n8. Item 1.\n");
});

// ---- a page at a time ------------------------------------------------------

/** Six pages of headings, lists and paragraphs, each with a running footer
 *  and its number: something on every page for each edit to change. */
function book(): Analysis {
  return {
    format: ANALYSIS_FORMAT,
    reader: READER,
    bodySize: 10,
    pages: Array.from({ length: 6 }, (_, i) => {
      const n = i + 1;
      const at = (b: Block, y: number) => ({ ...b, box: { ...b.box, y } });
      return page(n, [
        at(block(`p${n}b0`, `Part ${n}`, "heading"), 100),
        at(block(`p${n}b1`, "First.", "numbered", "1."), 200),
        at(block(`p${n}b2`, "Second.", "numbered", "2."), 220),
        at(block(`p${n}b3`, "A point.", "bullet"), 240),
        at(block(`p${n}b4`, `Some text on page ${n}.`), 300),
        at(block(`p${n}b5`, "Field Manual"), 760),
        at(block(`p${n}b6`, String(n)), 775),
      ]);
    }),
  };
}

test("a page an edit does not change is not written again: its lines and its blocks are the ones it had", () => {
  const doc = book();
  const before = emit(doc, "doc.assets/", blankEdits());
  const page1 = before.lines.filter((l) => l.page === 1);
  // A block on the last page hidden: no page moves, the rest are as they were.
  const hidden = emit(
    doc,
    "doc.assets/",
    withEdits({ p6b4: { hidden: true } }),
  );
  expect(hidden.lines.filter((l) => l.page === 1)).toEqual(page1);
  hidden.lines
    .filter((l) => l.page === 1)
    .forEach((l, i) => expect(l).toBe(page1[i]));
  expect(hidden.blocks.p3b4).toBe(before.blocks.p3b4);
  expect(hidden.blocks.p6b4).not.toBe(before.blocks.p6b4);
  // A block on the first page deleted: every page after it moves up its
  // line, placed anew, and says what it said.
  const deleted = emit(
    doc,
    "doc.assets/",
    withEdits({ p1b4: { deleted: true } }),
  );
  const moved = before.blocks.p3b4.from - deleted.blocks.p3b4.from;
  expect(moved).toBeGreaterThan(0);
  expect(deleted.lines[deleted.blocks.p3b4.from - 1].text).toBe(
    before.lines[before.blocks.p3b4.from - 1].text,
  );
});

test("written a page at a time through a run of edits, the markdown is what a fresh read writes", () => {
  const doc = book();
  const ids = doc.pages.flatMap((p) => p.blocks);
  const lines = repeatedLines(doc);
  expect(lines.length).toBeGreaterThan(0);
  let seed = 7;
  const rand = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const changes: (() => Change)[] = [
    () => ({ hidden: rand() < 0.7 }),
    () => ({ deleted: rand() < 0.7 }),
    () => ({ quote: rand() < 0.6 }),
    () => ({ role: pick(["para", "heading", "bullet", "numbered"] as const) }),
    () => ({ depth: Math.floor(rand() * 3) }),
    () => ({ bold: rand() < 0.5 }),
  ];
  let edits = blankEdits();
  for (let step = 0; step < 300; step++) {
    const r = rand();
    if (r < 0.08)
      edits = setFurniture(
        edits,
        pick(["page_numbers", "headers_footers"] as const),
        pick(["keep", "hide", "delete"] as const),
      );
    else if (r < 0.14)
      edits = setLine(
        edits,
        pick(lines).key,
        pick(["keep", "hide", "delete"] as const),
      );
    else if (r < 0.24) edits = rand() < 0.6 ? undo(edits) : redo(edits);
    else if (r < 0.26) edits = revertToOriginal(edits);
    else {
      const at = Math.floor(rand() * ids.length);
      const change = pick(changes)();
      edits = apply(
        edits,
        ids.slice(at, at + 1 + Math.floor(rand() * 9)),
        () => change,
      );
    }
    // A copy of the read is another read: nothing of it written yet.
    expect(emit(doc, "doc.assets/", edits)).toEqual(
      emit(structuredClone(doc), "doc.assets/", edits),
    );
  }
  // And edits read back from `edits.json`: the same, in new objects.
  const back = JSON.parse(JSON.stringify(edits)) as Edits;
  expect(emit(doc, "doc.assets/", back)).toEqual(
    emit(structuredClone(doc), "doc.assets/", edits),
  );
});
