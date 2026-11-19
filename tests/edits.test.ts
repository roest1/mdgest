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
  redo,
  revertToOriginal,
  setCuts,
  setFurniture,
  addInsert,
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

  test("a hidden list item is indented into the list, by its own number, and the next item keeps its own", () => {
    const list = analysis([
      block("p1b0", "one", "numbered", "1."),
      block("p1b1", "two", "numbered", "2."),
      block("p1b2", "three", "numbered", "3."),
    ]);
    const md = emit(list, "doc.assets/", withEdits({ p1b1: { hidden: true } }));
    // 3 after 1 would be shown as 2 in the list it is in: it starts its own.
    expect(md.text).toBe("1. one\n   <!-- 2. two -->\n3) three\n");
  });
});

describe("hide and delete are one choice", () => {
  test("apply stores only what is on, and setting either turns the other off", () => {
    const blocks = [doc.pages[0].blocks[1]];
    const hidden = apply(blankEdits(), blocks, () => ({ hidden: true }));
    expect(hidden.blocks.p1b1).toEqual({ hidden: true });
    // A tool that sends only its own flag, and one that turns the other off
    // itself, store the same.
    const deleted = apply(hidden, blocks, () => ({ deleted: true }));
    expect(deleted.blocks.p1b1).toEqual({ deleted: true });
    const back = apply(deleted, blocks, () => ({
      hidden: true,
      deleted: false,
    }));
    expect(back.blocks.p1b1).toEqual({ hidden: true });
    const restored = apply(back, blocks, () => ({ hidden: false }));
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
    const joined = join(blankEdits(), ["p1b0", "p1b1"]);
    expect(joined.joins).toEqual({ p1b1: "p1b0" });
    // Corrected after the join, as a correction on a head can only be: the
    // group's words, reworded.
    const corrected: Edits = {
      ...joined,
      blocks: { p1b0: { text: "A words B words-fixed" } },
    };
    const apart = unjoin(corrected, ["p1b0"]);
    expect(apart.joins).toEqual({});
    expect(apart.blocks.p1b0).toBeUndefined();
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

  test("a file of another version is refused, not read as this one", () => {
    expect(() =>
      checkEdits(
        { ...blankEdits(), version: EDITS_VERSION + 1 },
        "its edits.json",
      ),
    ).toThrow(/format this version reads/);
  });
});

describe("undo, redo and revert to original", () => {
  const hide = (edits: Edits, id: string) =>
    apply(edits, [doc.pages[0].blocks.find((b) => b.id === id)!], () => ({
      hidden: true,
    }));
  const text = (edits: Edits) => emit(doc, "a/", edits).text;
  const original = text(blankEdits());

  test("undo takes back a step and redo makes it again; a new step drops what was undone", () => {
    const one = hide(blankEdits(), "p1b1");
    const two = hide(one, "p1b2");
    const back = undo(two);
    expect(back.blocks).toEqual(one.blocks);
    expect(redo(back).blocks).toEqual(two.blocks);
    // Nothing to undo, nothing to redo: the same edits.
    expect(undo(blankEdits())).toEqual(blankEdits());
    expect(redo(two)).toBe(two);
    // A step made after an undo is a new branch: the undone one is gone.
    expect(hide(back, "p1b3").redo).toEqual([]);
  });

  test("revert takes every kind of decision back to the reader's, as one step undo takes back", () => {
    let edits = hide(blankEdits(), "p1b1");
    edits = join(edits, ["p1b2", "p1b3"]);
    edits = setCuts(edits, "p1b0", [1]);
    edits = addInsert(edits, 1, "p1b0", "Written in.");
    edits = setFurniture(edits, "page_numbers", "hide");
    const before = { ...edits, done: true, later: "a newer build's" };
    const reverted = revertToOriginal(before);
    expect(text(reverted)).toBe(original);
    expect(reverted.page_numbers).toBeUndefined();
    // Kept: what is not a decision, and the history, one step longer.
    expect(reverted.done).toBe(true);
    expect(reverted.later).toBe("a newer build's");
    expect(reverted.undo).toHaveLength(before.undo.length + 1);
    // And undone in one.
    expect(text(undo(reverted))).toBe(text(before));
    expect(undo(reverted).page_numbers).toBe("hide");
  });

  test("nothing decided is nothing to revert, history or no history", () => {
    const blank = blankEdits();
    expect(revertToOriginal(blank)).toBe(blank);
    const undone = undo(hide(blank, "p1b1"));
    expect(revertToOriginal(undone)).toBe(undone);
  });
});
