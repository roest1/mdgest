/** Hide and delete, end to end through the pure half: what `emit` writes
 *  for each, how the numbering moves, and how a version 1 file or export --
 *  whose `hidden` meant what `deleted` means now -- comes back without any
 *  hide turning into a comment. */

import { describe, expect, test } from "vitest";
import { ANALYSIS_FORMAT, READER, type Analysis, type Block, type Role } from "src/lib/analysis";
import { apply, blankEdits, checkEdits, type BlockEdit, type Edits } from "src/lib/edits";
import { emit } from "src/lib/emit";
import { assess, entryFor } from "src/lib/exchange";

/** A text block on page 1: `id` is its position, the rest the reader's call. */
function block(id: string, text: string, role: Role = "para", marker = ""): Block {
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
    expect(md.blocks.p1b2).toMatchObject({ n: 0, from: 0, to: 0, deleted: true });
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

  test("a hidden list item is indented into the list, which goes on past it", () => {
    const list = analysis([
      block("p1b0", "one", "numbered", "1."),
      block("p1b1", "two", "numbered", "2."),
      block("p1b2", "three", "numbered", "3."),
    ]);
    const md = emit(list, "doc.assets/", withEdits({ p1b1: { hidden: true } }));
    expect(md.text).toBe("1. one\n   <!-- two -->\n2. three\n");
  });
});

describe("hide and delete are one choice", () => {
  test("apply stores only what is on, and the tools turn the other off", () => {
    const blocks = [doc.pages[0].blocks[1]];
    const hidden = apply(blankEdits(), blocks, () => ({ hidden: true, deleted: false }));
    expect(hidden.blocks.p1b1).toEqual({ hidden: true });
    const deleted = apply(hidden, blocks, () => ({ deleted: true, hidden: false }));
    expect(deleted.blocks.p1b1).toEqual({ deleted: true });
    const restored = apply(deleted, blocks, () => ({ deleted: false }));
    expect(restored.blocks.p1b1).toBeUndefined();
  });
});

describe("version 1", () => {
  test("an edits.json hide is a delete, in the undo and redo steps too", () => {
    const edits = checkEdits(
      {
        version: 1,
        blocks: { p1b1: { hidden: true, bold: true } },
        joins: {},
        undo: [{ blocks: { p1b2: { hidden: true } } }],
        redo: [{ blocks: { p1b3: { hidden: false } } }],
      },
      "its edits.json",
    );
    expect(edits.version).toBe(2);
    expect(edits.blocks.p1b1).toEqual({ deleted: true, bold: true });
    expect(edits.undo[0].blocks.p1b2).toEqual({ deleted: true });
    expect(edits.redo[0].blocks.p1b3).toEqual({ deleted: false });
  });

  test("an export entry with no version is version 1", async () => {
    const { edits } = await assess({
      sha256: "0".repeat(64),
      reader: READER,
      edits: { blocks: { p1b1: { hidden: true } }, joins: {} },
    });
    expect(edits?.blocks.p1b1).toEqual({ deleted: true });
  });

  test("an export written now carries its version, and a hide stays a hide", async () => {
    const entry = entryFor("0".repeat(64), withEdits({ p1b1: { hidden: true } }), READER);
    expect(entry.edits).toMatchObject({ version: 2 });
    const { edits } = await assess(entry);
    expect(edits?.blocks.p1b1).toEqual({ hidden: true });
  });
});
