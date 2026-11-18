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

  test("indent is for lists, and outdent once one is indented", () => {
    expect(format(["n1", "n2"])).toMatchObject({ list: true, outdent: false });
    expect(format(["n1", "a"])?.list).toBe(false);
    const deeper = press(blankEdits(), ["n2"], "indent");
    expect(format(["n1", "n2"], deeper)?.outdent).toBe(true);
    expect(press(blankEdits(), ["a"], "indent").blocks.a).toBeUndefined();
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
