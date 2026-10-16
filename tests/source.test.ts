/** Editing a block from its markdown: what a written line says, and the
 *  edits writing over one block's lines makes. */

import { describe, expect, test } from "vitest";
import { ANALYSIS_FORMAT, READER, type Analysis, type Block, type Line } from "src/lib/analysis";
import { blankEdits, join, undo, type Edits } from "src/lib/edits";
import { emit } from "src/lib/emit";
import { editSource, readLine } from "src/lib/source";

function line(text: string, y: number): Line {
  return { text, box: { x: 100, y, w: text.length * 5, h: 10 }, size: 10, bold: false, italic: false, font: "Body" };
}

function doc(): Analysis {
  const lines = [
    line("Introduction", 100),
    line("The ofﬁce is open daily.", 120),
    line("Costs exclude underfunded • Scans cost on average", 140),
    line("Second paragraph.", 160),
  ];
  const block = (id: string, li: number, text: string, role: Block["role"] = "para"): Block => ({
    id,
    kind: "text",
    page: 1,
    box: lines[li].box,
    lines: [li],
    text,
    role,
    level: role === "heading" ? 2 : 0,
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
          block("p1b0", 0, "Introduction", "heading"),
          block("p1b1", 1, "The ofﬁce is open daily."),
          block("p1b2", 2, "Costs exclude underfunded • Scans cost on average"),
          block("p1b3", 3, "Second paragraph."),
        ],
      },
    ],
  };
}

const read = doc();

/** Write `written` over block `id`'s lines as they stand in `edits`. */
function write(edits: Edits, id: string, written: string) {
  const md = emit(read, "a/", edits);
  const at = md.blocks[id];
  const was = md.lines.slice(at.from - 1, at.to).map((l) => l.text).join("\n");
  return editSource(read, edits, id, was, written);
}

const ok = (r: ReturnType<typeof write>): Edits => {
  if ("problem" in r) throw new Error(r.problem);
  return r.edits;
};

describe("readLine", () => {
  test.each([
    ["## Title", { role: "heading", level: 2, text: "Title" }],
    ["  - item", { role: "bullet", indent: 2, text: "item" }],
    ["3. item", { role: "numbered", text: "item" }],
    ["***both***", { bold: true, italic: true, text: "both" }],
    ["> quoted", { quote: true, text: "quoted" }],
    ["<!-- gone -- > here -->", { hidden: true, text: "gone --> here" }],
    ["[Read more](https://x.org)", { text: "Read more" }],
    ["2024\\. was \\*good\\*", { text: "2024. was *good*" }],
  ])("%s", (source, said) => expect(readLine(source)).toMatchObject(said));
});

describe("one line", () => {
  test("markup changes the shape, and is one undo step", () => {
    const edits = ok(write(blankEdits(), "p1b3", "### Second paragraph."));
    expect(edits.blocks.p1b3).toEqual({ role: "heading", level: 3 });
    expect(undo(edits).blocks).toEqual({});
  });

  test("changed words are a correction, and the page's words undo it", () => {
    const fixed = ok(write(blankEdits(), "p1b1", "The office is open daily."));
    expect(fixed.blocks.p1b1).toEqual({ text: "The office is open daily." });
    expect(emit(read, "a/", fixed).blocks.p1b1.corrected).toBe(true);
    const back = ok(write(fixed, "p1b1", "The ofﬁce is open daily."));
    expect(back.blocks.p1b1).toBeUndefined();
  });

  test("a comment hides it, nothing deletes it", () => {
    expect(ok(write(blankEdits(), "p1b3", "<!-- Second paragraph. -->")).blocks.p1b3).toEqual({ hidden: true });
    expect(ok(write(blankEdits(), "p1b3", "  ")).blocks.p1b3).toEqual({ deleted: true });
  });

  test("the same line written again changes nothing", () => {
    const edits = blankEdits();
    expect(ok(write(edits, "p1b3", "Second paragraph."))).toBe(edits);
  });
});

describe("new lines divide", () => {
  test("between its words, with a printed bullet going to the piece it opens", () => {
    const edits = ok(write(blankEdits(), "p1b2", "Costs exclude underfunded\n- Scans cost on average"));
    expect(edits.cuts).toEqual({ p1b2: [3] });
    const md = emit(read, "a/", edits);
    expect(md.text).toContain("Costs exclude underfunded\n\n- Scans cost on average");
    expect(undo(edits).cuts).toBeUndefined();
  });

  test("markup on a new piece shapes it", () => {
    const edits = ok(write(blankEdits(), "p1b2", "## Costs exclude underfunded\n- Scans cost on average"));
    expect(edits.blocks.p1b2).toMatchObject({ role: "heading", level: 2 });
  });

  test("a later piece divides at its own words: the marker it opens with counts, as the cuts count it", () => {
    const edits = ok(write(blankEdits(), "p1b2", "Costs exclude underfunded\n- Scans cost on average"));
    const next = ok(write(edits, "p1b2c3", "- Scans cost\n- on average"));
    expect(next.cuts).toEqual({ p1b2: [3, 6] });
    expect(emit(read, "a/", next).text).toContain("Costs exclude underfunded\n\n- Scans cost\n- on average");
  });

  test("dividing and rewording at once is refused", () => {
    expect(write(blankEdits(), "p1b2", "Costs exclude\nScans cost a lot")).toHaveProperty("problem");
  });

  test("a joined block is divided from the page", () => {
    const joined = join(blankEdits(), ["p1b1", "p1b3"]);
    expect(write(joined, "p1b1", "The ofﬁce is open daily.\nSecond paragraph.")).toHaveProperty("problem");
  });
});
