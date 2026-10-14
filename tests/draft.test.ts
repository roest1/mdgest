/** Editing the whole markdown as text: what a changed draft makes of the
 *  edits, run by run. */

import { describe, expect, test } from "vitest";
import { ANALYSIS_FORMAT, READER, type Analysis, type Block, type Line } from "src/lib/analysis";
import { diffLines } from "src/lib/diff";
import { applyDraft } from "src/lib/draft";
import { blankEdits, undo, type Edits } from "src/lib/edits";
import { emit } from "src/lib/emit";

function doc(): Analysis {
  const texts = ["Title", "First paragraph here.", "Second paragraph here.", "Third one."];
  const lines: Line[] = texts.map((text, i) => ({
    text,
    box: { x: 100, y: 100 + i * 20, w: 200, h: 10 },
    size: 10,
    bold: false,
    italic: false,
    font: "Body",
  }));
  const block = (i: number): Block => ({
    id: `p1b${i}`,
    kind: "text",
    page: 1,
    box: lines[i].box,
    lines: [i],
    text: texts[i],
    role: i === 0 ? "heading" : "para",
    level: i === 0 ? 1 : 0,
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
    pages: [{ n: 1, width: 600, height: 800, lines, pictures: [], blocks: texts.map((_, i) => block(i)) }],
  };
}

const read = doc();

/** The draft `change` makes of the source `edits` write. */
function edit(edits: Edits, change: (source: string) => string) {
  const md = emit(read, "a/", edits);
  return applyDraft(read, edits, md, change(md.text));
}
function ok(r: ReturnType<typeof edit>) {
  if ("problems" in r) throw new Error(r.problems.map((p) => p.problem).join("; "));
  return r;
}
const text = (edits: Edits) => emit(read, "a/", edits).text;

describe("diffLines", () => {
  test("finds each changed run between matched lines", () => {
    expect(diffLines(["a", "b", "c", "d"], ["a", "x", "c", "d", "e"])).toEqual([
      { a0: 1, a1: 2, b0: 1, b1: 2 },
      { a0: 4, a1: 4, b0: 4, b1: 5 },
    ]);
  });
});

describe("a draft", () => {
  test("unchanged changes nothing", () => {
    const edits = blankEdits();
    expect(ok(edit(edits, (s) => s)).edits).toBe(edits);
  });

  test("a typo fixed is a correction on the block, not inserted text", () => {
    const r = ok(edit(blankEdits(), (s) => s.replace("Second paragraph here.", "Second paragraph, here.")));
    expect(r.edits.blocks.p1b2).toEqual({ text: "Second paragraph, here." });
    expect(r.inserted).toEqual([]);
  });

  test("new lines between blocks are inserted text, after the block before them", () => {
    const r = ok(edit(blankEdits(), (s) => s.replace("First paragraph here.\n", "First paragraph here.\n\nMy own note.\n")));
    expect(r.edits.inserts).toEqual([{ id: "i1", page: 1, after: "p1b1", text: "My own note." }]);
    expect(r.inserted).toEqual(["My own note."]);
    const md = emit(read, "a/", r.edits);
    expect(md.text).toContain("First paragraph here.\n\nMy own note.\n\nSecond paragraph here.");
    expect(md.blocks.i1).toMatchObject({ inserted: true, n: 0 });
  });

  test("inserted text is edited and taken out like any other line", () => {
    const added = ok(edit(blankEdits(), (s) => `${s}\nAt the end.\n`)).edits;
    const reworded = ok(edit(added, (s) => s.replace("At the end.", "At the very end."))).edits;
    expect(reworded.inserts?.[0].text).toBe("At the very end.");
    const gone = ok(edit(reworded, (s) => s.replace("\nAt the very end.", ""))).edits;
    expect(gone.inserts).toBeUndefined();
  });

  test("a line removed deletes its block", () => {
    expect(ok(edit(blankEdits(), (s) => s.replace("Third one.", ""))).edits.blocks.p1b3).toEqual({ deleted: true });
  });

  test("the break between two blocks removed joins them", () => {
    const r = ok(edit(blankEdits(), (s) => s.replace("here.\n\nSecond", "here. Second")));
    expect(r.edits.joins).toEqual({ p1b2: "p1b1" });
    expect(text(r.edits)).toContain("First paragraph here. Second paragraph here.");
  });

  test("a new line inside a block divides it", () => {
    const r = ok(edit(blankEdits(), (s) => s.replace("First paragraph here.", "First paragraph\nhere.")));
    expect(r.edits.cuts).toEqual({ p1b1: [2] });
  });

  test("a block reworded with a line after it: the correction, then inserted text", () => {
    const r = ok(edit(blankEdits(), (s) => s.replace("Third one.", "Third one, fixed.\nAnd a line of mine.")));
    expect(r.edits.blocks.p1b3).toEqual({ text: "Third one, fixed." });
    expect(r.edits.inserts?.[0]).toMatchObject({ after: "p1b3", text: "And a line of mine." });
  });

  test("blocks replaced by words of their own: removed, and the new words inserted", () => {
    const r = ok(edit(blankEdits(), (s) => s.replace("First paragraph here.\n\nSecond paragraph here.", "Both, rewritten.")));
    expect(r.edits.blocks).toEqual({ p1b1: { deleted: true }, p1b2: { deleted: true } });
    expect(r.inserted).toEqual(["Both, rewritten."]);
  });

  test("lines are paired with blocks by their words, not their place", () => {
    // A new paragraph, the block after it reworded and the next two joined,
    // all in one changed run: each line goes to the block it is.
    const r = ok(
      edit(blankEdits(), (s) =>
        s
          .replace("# Title\n", "# Title\n\nA note of my own.\n")
          .replace("First paragraph here.", "First paragraph here, 2021.")
          .replace("Second paragraph here.\n\nThird one.", "Second paragraph here. Third one."),
      ),
    );
    expect(r.edits.inserts).toEqual([{ id: "i1", page: 1, after: "p1b0", text: "A note of my own." }]);
    expect(r.edits.blocks).toEqual({ p1b1: { text: "First paragraph here, 2021." } });
    expect(r.edits.joins).toEqual({ p1b3: "p1b2" });
  });

  test("everything a draft changes is one undo step", () => {
    const r = ok(
      edit(blankEdits(), (s) =>
        s.replace("# Title", "## Title").replace("Third one.", "").replace("Second paragraph here.", "Second paragraph, here."),
      ),
    );
    expect(Object.keys(r.edits.blocks).sort()).toEqual(["p1b0", "p1b2", "p1b3"]);
    expect(undo(r.edits).blocks).toEqual({});
  });
});
