/** The hide and delete buttons on a selection (`hiding.ts`): what each
 *  offers for a mix of shown, hidden and deleted blocks, and the edit each
 *  makes, read back through `emit`. */

import { describe, expect, test } from "vitest";
import {
  ANALYSIS_FORMAT,
  READER,
  type Analysis,
  type Block,
} from "src/lib/analysis";
import { blankEdits, undo, type Edits } from "src/lib/edits";
import { emit } from "src/lib/emit";
import { actionsFor, hiding, type Action } from "src/lib/hiding";

function block(id: string): Block {
  return {
    id,
    kind: "text",
    page: 1,
    box: { x: 0, y: 0, w: 100, h: 10 },
    lines: [],
    text: `Words of ${id}.`,
    role: "para",
    level: 0,
    depth: 0,
    bold: false,
    italic: false,
    marker: "",
    size: 10,
    font: "Body",
    picture: -1,
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
      pictures: [],
      blocks: ["a", "b", "c"].map(block),
    },
  ],
};

const placed = (edits: Edits) => emit(doc, "doc.assets/", edits).blocks;

/** `edits` with `action` made to `ids`, as a button makes it. */
function act(edits: Edits, ids: string[], action: Action): Edits {
  return hiding(ids, doc, placed(edits), action)(edits);
}

describe("the buttons a selection offers", () => {
  test("all shown: Hide and Delete, over every block", () => {
    expect(actionsFor(["a", "b"], placed(blankEdits()))).toEqual({
      hide: { action: "hide", count: 2 },
      del: { action: "delete", count: 2 },
    });
  });

  test("all hidden: Show", () => {
    const edits = act(blankEdits(), ["a", "b"], "hide");
    expect(actionsFor(["a", "b"], placed(edits))?.hide?.action).toBe("show");
  });

  test("shown and hidden: Hide, which hides all", () => {
    let edits = act(blankEdits(), ["a"], "hide");
    expect(actionsFor(["a", "b"], placed(edits))?.hide?.action).toBe("hide");
    edits = act(edits, ["a", "b"], "hide");
    expect(placed(edits).a.hidden && placed(edits).b.hidden).toBe(true);
  });

  test("all deleted: Restore alone", () => {
    const edits = act(blankEdits(), ["a", "b"], "delete");
    expect(actionsFor(["a", "b"], placed(edits))).toEqual({
      hide: null,
      del: { action: "restore", count: 2 },
    });
  });

  test("deleted and shown: Delete over all, Hide over the written one", () => {
    const edits = act(blankEdits(), ["a"], "delete");
    expect(actionsFor(["a", "b"], placed(edits))).toEqual({
      hide: { action: "hide", count: 1 },
      del: { action: "delete", count: 2 },
    });
  });

  test("nothing placed: no buttons", () => {
    expect(actionsFor(["zz"], placed(blankEdits()))).toBeNull();
  });
});

describe("the edit a button makes", () => {
  test("hide writes a comment, show writes the block again", () => {
    const hidden = act(blankEdits(), ["b"], "hide");
    expect(emit(doc, "doc.assets/", hidden).text).toContain(
      "<!-- Words of b. -->",
    );
    const shown = act(hidden, ["b"], "show");
    expect(emit(doc, "doc.assets/", shown).text).toBe(
      emit(doc, "doc.assets/", blankEdits()).text,
    );
  });

  test("hide leaves a deleted block deleted", () => {
    const edits = act(act(blankEdits(), ["a"], "delete"), ["a", "b"], "hide");
    expect(placed(edits).a.deleted).toBe(true);
    expect(placed(edits).b.hidden).toBe(true);
  });

  test("delete takes a hidden block out; restore brings it back shown", () => {
    const deleted = act(act(blankEdits(), ["a"], "hide"), ["a"], "delete");
    expect(placed(deleted).a).toMatchObject({ deleted: true, hidden: false });
    const restored = act(deleted, ["a"], "restore");
    expect(placed(restored).a).toMatchObject({ deleted: false, hidden: false });
  });

  test("one press is one undo step, and one that changes nothing is none", () => {
    const edits = act(blankEdits(), ["a", "b", "c"], "hide");
    expect(edits.undo).toHaveLength(1);
    expect(placed(undo(edits)).a.hidden).toBe(false);
    expect(act(edits, ["a"], "hide")).toBe(edits);
  });
});
