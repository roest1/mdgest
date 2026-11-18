/** The format bar on a selection (`formatting.ts`): when it is offered,
 *  which buttons are lit, and the edit each press makes, read back through
 *  `emit`. */

import { describe, expect, test } from "vitest";
import {
  ANALYSIS_FORMAT,
  READER,
  type Analysis,
  type Block,
  type Role,
} from "src/lib/analysis";
import { blankEdits, undo, type Edits } from "src/lib/edits";
import { emit } from "src/lib/emit";
import { formatFor, restyle, type Press } from "src/lib/formatting";

function block(id: string, role: Role = "para"): Block {
  return {
    id,
    kind: role === "image" ? "image" : "text",
    page: 1,
    box: { x: 0, y: 0, w: 100, h: 10 },
    lines: [],
    text: role === "image" ? "" : `Words of ${id}.`,
    role,
    level: role === "heading" ? 2 : 0,
    depth: 0,
    bold: false,
    italic: false,
    marker: role === "numbered" ? "1." : "",
    size: 10,
    font: "Body",
    picture: role === "image" ? 0 : -1,
  };
}

const doc: Analysis = {
  format: ANALYSIS_FORMAT,
  reader: READER,
  bodySize: 10,
  pages: [
    {
      n: 1,
      width: 600,
      height: 800,
      lines: [],
      pictures: [
        { box: { x: 0, y: 0, w: 10, h: 10 }, path: "p1-i0.png", px: [10, 10] },
      ],
      blocks: [
        block("h", "heading"),
        block("a"),
        block("b"),
        block("n1", "numbered"),
        block("n2", "numbered"),
        block("n3", "numbered"),
        block("pic", "image"),
      ],
    },
  ],
};

const md = (edits: Edits) => emit(doc, "doc.assets/", edits);
const format = (ids: string[], edits = blankEdits()) =>
  formatFor(ids, doc, md(edits).blocks, edits);
/** `edits` with `press` made on `ids`, as the bar makes it. */
const press = (edits: Edits, ids: string[], p: Press) =>
  restyle(ids, doc, md(edits).blocks, p)(edits);
const lit = (ids: string[], edits?: Edits) => [
  ...(format(ids, edits)?.lit ?? []),
];

describe("when the bar is offered", () => {
  test("for text, not for a picture or a mix with one", () => {
    expect(format(["a"])).not.toBeNull();
    expect(format(["pic"])).toBeNull();
    expect(format(["a", "pic"])).toBeNull();
  });

  test("deleted blocks are left out: of a mix, and all of them is none", () => {
    const gone = { ...blankEdits(), blocks: { pic: { deleted: true } } };
    expect(format(["a", "pic"], gone)).not.toBeNull();
    const all = { ...blankEdits(), blocks: { a: { deleted: true } } };
    expect(format(["a"], all)).toBeNull();
  });
});

describe("what is lit", () => {
  test("what every block is already, and nothing for a mix", () => {
    expect(lit(["a", "b"])).toEqual(["para"]);
    expect(lit(["h"])).toEqual(["h2"]);
    expect(lit(["a", "h"])).toEqual([]);
  });

  test("a heading takes no bold or italic", () => {
    expect(format(["h"])?.heading).toBe(true);
    expect(format(["a"])?.heading).toBe(false);
    const bold = press(blankEdits(), ["h"], "bold");
    expect(bold.blocks.h).toBeUndefined();
  });

  test("indent and outdent are for list items, and only when they move one", () => {
    // A paragraph has no depth to change.
    expect(format(["a"])).toMatchObject({ indent: false, outdent: false });
    expect(press(blankEdits(), ["a"], "indent")).toEqual(blankEdits());
    // The first item of a list cannot nest: there is nothing to nest under.
    expect(format(["n1"])).toMatchObject({ indent: false, outdent: false });
    // The second can, once: one level under the first, and no deeper.
    expect(format(["n2"])).toMatchObject({ indent: true, outdent: false });
    const once = press(blankEdits(), ["n2"], "indent");
    expect(md(once).blocks.n2.item).toEqual({ depth: 1, after: "n1" });
    expect(format(["n2"], once)).toMatchObject({
      indent: false,
      outdent: true,
    });
    expect(press(once, ["n2"], "indent")).toBe(once);
  });
});

describe("indenting several items", () => {
  const depths = (edits: Edits) =>
    ["n1", "n2", "n3"].map((id) => md(edits).blocks[id].item?.depth);

  test("each goes as deep as the item before it allows, as it will be", () => {
    const all = ["n1", "n2", "n3"];
    const once = press(blankEdits(), all, "indent");
    // The first stays; the others nest under it.
    expect(depths(once)).toEqual([0, 1, 1]);
    // Again: only the last has a nested item before it to go under.
    const twice = press(once, all, "indent");
    expect(depths(twice)).toEqual([0, 1, 2]);
    expect(format(all, twice)?.indent).toBe(false);
    // Outdent brings each up a level, and none past the top.
    const back = press(twice, all, "outdent");
    expect(depths(back)).toEqual([0, 0, 1]);
    expect(depths(press(back, all, "outdent"))).toEqual([0, 0, 0]);
  });

  test("what is stored is what is written, so every press shows", () => {
    // Pressed on the first item, nothing was stored that the markdown
    // could not show -- and so no press is spent undoing it later.
    const first = press(blankEdits(), ["n1"], "indent");
    expect(first.blocks.n1).toBeUndefined();
    const once = press(blankEdits(), ["n2", "n3"], "indent");
    expect(once.blocks).toEqual({ n2: { depth: 1 }, n3: { depth: 1 } });
  });
});

describe("what a press does", () => {
  test("a role is set on every block, and written", () => {
    const edits = press(blankEdits(), ["a", "b"], "h3");
    expect(md(edits).text).toContain("### Words of a.\n\n### Words of b.");
    expect(lit(["a", "b"], edits)).toEqual(["h3"]);
  });

  test("a toggle turns on unless every block has it, then off", () => {
    const one = press(blankEdits(), ["a"], "bold");
    const both = press(one, ["a", "b"], "bold");
    expect(lit(["a", "b"], both)).toEqual(["para", "bold"]);
    const off = press(both, ["a", "b"], "bold");
    expect(off.blocks.a).toBeUndefined();
    expect(off.blocks.b).toBeUndefined();
  });

  test("a list style already on every item takes them out of the list", () => {
    expect(lit(["n1", "n2"])).toEqual(["numbered"]);
    const off = press(blankEdits(), ["n1", "n2"], "numbered");
    expect(lit(["n1", "n2"], off)).toEqual(["para"]);
    expect(md(off).text).toContain("Words of n1.\n\nWords of n2.");
    // Another list style on them is a change of style, not an exit.
    const bullets = press(blankEdits(), ["n1", "n2"], "bullet");
    expect(lit(["n1", "n2"], bullets)).toEqual(["bullet"]);
    // Listed again, an item comes back at the depth it had: the reader's.
    const back = press(off, ["n1", "n2"], "numbered");
    expect(back.blocks).toEqual({});
  });

  test("quote toggles on a heading too, and is written", () => {
    const edits = press(blankEdits(), ["h", "a"], "quote");
    expect(md(edits).text).toContain("> ## Words of h.\n>\n> Words of a.");
  });

  test("one press is one undo step; one that changes nothing is none", () => {
    const blank = blankEdits();
    const edits = press(blank, ["a", "b"], "italic");
    expect(edits.undo).toHaveLength(1);
    expect(undo(edits).blocks).toEqual({});
    expect(press(blank, ["a"], "para")).toBe(blank);
    expect(press(blank, ["pic"], "h1")).toBe(blank);
  });
});
