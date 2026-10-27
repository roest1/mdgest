/** Hide and delete, end to end through the pure half: what `emit` writes
 *  for each, how the numbering moves, and that each comes back from the
 *  file as it went in. */

import { describe, expect, test } from "vitest";
import {
  ANALYSIS_FORMAT,
  READER,
  type Analysis,
  type Block,
  type Role,
} from "src/lib/analysis";
import {
  apply,
  blankEdits,
  checkEdits,
  EDITS_VERSION,
  join,
  parseEdits,
  undo,
  unjoin,
  type BlockEdit,
  type Edits,
} from "src/lib/edits";
import { emit } from "src/lib/emit";

/** A text block on page 1: `id` is its position, the rest the reader's call. */
function block(
  id: string,
  text: string,
  role: Role = "para",
  marker = "",
): Block {
  return {
    id,
    kind: "text",
    page: 1,
    box: { x: 0, y: 0, w: 100, h: 10 },
    lines: [],
    text,
    role,
    level: role === "heading" ? 2 : 0,
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

function withEdits(blocks: Record<string, BlockEdit>): Edits {
  return { ...blankEdits(), blocks };
}

const doc = analysis([
  block("p1b0", "Title", "heading"),
  block("p1b1", "First paragraph."),
  block("p1b2", "Second paragraph."),
  block("p1b3", "Third paragraph."),
]);

describe("emit", () => {
  test("a hidden block is a comment, keeps its number and its line", () => {
    const md = emit(doc, "doc.assets/", withEdits({ p1b2: { hidden: true } }));
    expect(md.text).toContain("<!-- Second paragraph. -->");
    expect(md.text).not.toMatch(/^Second paragraph\.$/m);
    const at = md.blocks.p1b2;
    expect(at).toMatchObject({ n: 3, hidden: true, deleted: false });
    expect(md.lines[at.from - 1].text).toBe("<!-- Second paragraph. -->");
    expect(md.blocks.p1b3.n).toBe(4);
  });

  test("a deleted block writes nothing and gives up its number", () => {
    const md = emit(doc, "doc.assets/", withEdits({ p1b2: { deleted: true } }));
    expect(md.text).not.toContain("Second paragraph.");
    expect(md.blocks.p1b2).toMatchObject({
      n: 0,
      from: 0,
      to: 0,
      deleted: true,
    });
    expect(md.blocks.p1b3.n).toBe(3);
  });

  test("a comment cannot be closed early by the words inside it", () => {
    const md = emit(
      analysis([block("p1b0", "a --> b")]),
      "doc.assets/",
      withEdits({ p1b0: { hidden: true } }),
    );
    expect(md.text.trim()).toBe("<!-- a -- > b -->");
  });

  test("a page break set on a block stays when the block is hidden", () => {
    const edits = withEdits({
      p1b1: { hidden: true, break_after: "page" },
      p1b3: { hidden: true, break_before: "page" },
    });
    expect(emit(doc, "a/", edits).text).toBe(
      [
        "## Title",
        "",
        "<!-- First paragraph. -->",
        "",
        "---",
        "",
        "Second paragraph.",
        "",
        "---",
        "",
        "<!-- Third paragraph. -->",
        "",
      ].join("\n"),
    );
  });

  test("a hidden list item is indented into the list, which goes on past it", () => {
    const list = analysis([
      block("p1b0", "one", "numbered", "1."),
      block("p1b1", "two", "numbered", "2."),
      block("p1b2", "three", "numbered", "3."),
    ]);
    const md = emit(list, "doc.assets/", withEdits({ p1b1: { hidden: true } }));
    expect(md.text).toBe("1. one\n   <!-- 1. two -->\n2. three\n");
  });
});

describe("hide and delete are one choice", () => {
  test("apply stores only what is on, and the tools turn the other off", () => {
    const blocks = [doc.pages[0].blocks[1]];
    const hidden = apply(blankEdits(), blocks, () => ({
      hidden: true,
      deleted: false,
    }));
    expect(hidden.blocks.p1b1).toEqual({ hidden: true });
    const deleted = apply(hidden, blocks, () => ({
      deleted: true,
      hidden: false,
    }));
    expect(deleted.blocks.p1b1).toEqual({ deleted: true });
    const restored = apply(deleted, blocks, () => ({ deleted: false }));
    expect(restored.blocks.p1b1).toBeUndefined();
  });
});

describe("edits.json", () => {
  test("a hide and a delete come back from the file as they went in", () => {
    const blocks = [block("p1b1", "One."), block("p1b2", "Two.")];
    const hidden = apply(blankEdits(), [blocks[0]], () => ({ hidden: true }));
    const both = apply(hidden, [blocks[1]], () => ({ deleted: true }));
    const back = parseEdits(JSON.stringify(both));
    expect(back.version).toBe(EDITS_VERSION);
    expect(back.blocks).toEqual({
      p1b1: { hidden: true },
      p1b2: { deleted: true },
    });
    expect(undo(back).blocks).toEqual({ p1b1: { hidden: true } });
  });
});

describe("join", () => {
  test("joining nothing leaves the edits as they are", () => {
    const edits = blankEdits();
    expect(join(edits, [])).toBe(edits);
  });
});

describe("unjoin", () => {
  test("a correction written over a joined block comes off with the join", () => {
    const read = analysis([block("p1b0", "A words"), block("p1b1", "B words")]);
    const joined = join(blankEdits(), ["p1b0", "p1b1"]);
    // Corrected after the join, as a correction on a head can only be: the
    // group's words, reworded.
    const corrected: Edits = {
      ...joined,
      blocks: { p1b0: { text: "A words B words-fixed" } },
    };
    expect(emit(read, "a/", corrected).text).toBe("A words B words-fixed\n");
    const apart = unjoin(corrected, ["p1b0"]);
    expect(apart.joins).toEqual({});
    expect(apart.blocks.p1b0).toBeUndefined();
    expect(emit(read, "a/", apart).text).toBe("A words\n\nB words\n");
    expect(undo(apart).blocks.p1b0?.text).toBe("A words B words-fixed");
  });
});

describe("checkEdits", () => {
  test("an undo or redo step that cannot be put back is left out", () => {
    const edits = checkEdits(
      {
        version: EDITS_VERSION,
        blocks: {},
        joins: {},
        undo: [
          {},
          { blocks: { p1b1: { bold: true } } },
          { blocks: { p1b1: { role: "nope" } } },
          "step",
        ],
        redo: [
          null,
          { blocks: { p1b2: { deleted: true } }, cuts: { p1b2: [0] } },
        ],
      },
      "its edits.json",
    );
    expect(edits.undo).toEqual([{ blocks: { p1b1: { bold: true } } }]);
    expect(edits.redo).toEqual([]);
    expect(undo(edits).blocks).toEqual({ p1b1: { bold: true } });
  });
});
