/** Editing the whole markdown as text: what a changed draft makes of the
 *  edits, run by run. */

import { describe, expect, test } from "vitest";
import { ANALYSIS_FORMAT, READER, type Analysis, type Block, type Line } from "src/lib/analysis";
import { diffLines, editDistance } from "src/lib/diff";
import { applyDraft } from "src/lib/draft";
import { addInsert, blankEdits, setFurniture, undo, type Edits } from "src/lib/edits";
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

describe("editDistance", () => {
  /** The plain table, a cell at a time: what the bit-parallel count must equal. */
  function slow(x: string, y: string): number {
    let row = Array.from({ length: y.length + 1 }, (_, j) => j);
    for (let i = 1; i <= x.length; i++) {
      const next = [i];
      for (let j = 1; j <= y.length; j++) {
        next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      }
      row = next;
    }
    return row[y.length];
  }

  test("counts the same edits as the plain table, across block boundaries", () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const str = (len: number, alpha: number) => Array.from({ length: len }, () => String.fromCharCode(97 + rnd(alpha))).join("");
    for (let t = 0; t < 600; t++) {
      const len = [0, 1, 31, 32, 33, 63, 64, 65, 100, 300][rnd(10)];
      const x = str(rnd(len + 1), 1 + rnd(4));
      const y = rnd(2) ? str(rnd(len + 1), 1 + rnd(4)) : x.slice(0, rnd(x.length + 1)) + str(rnd(5), 3) + x.slice(rnd(x.length + 1));
      expect(editDistance(x, y), `${JSON.stringify(x)} vs ${JSON.stringify(y)}`).toBe(slow(x, y));
    }
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
  });
});

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

  test("every word it changes is reported for review; markup alone is not", () => {
    const typo = ok(edit(blankEdits(), (s) => s.replace("Second paragraph here.", "Second paragraasdph here.")));
    expect(typo.corrected).toEqual([
      { id: "p1b2", page: 1, n: 3, was: "Second paragraph here.", now: "Second paragraasdph here." },
    ]);
    const gone = ok(edit(blankEdits(), (s) => s.replace("Third one.", "")));
    expect(gone.deleted).toEqual([{ id: "p1b3", page: 1, n: 4, was: "Third one." }]);
    const markup = ok(edit(blankEdits(), (s) => s.replace("Third one.", "## Third one.")));
    expect([markup.corrected, markup.deleted, markup.inserted]).toEqual([[], [], []]);
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

/** One page of `texts`, each a block of `role`; the first a heading. */
function page(texts: [string, Block["role"]][]): Analysis {
  const lines: Line[] = texts.map(([text], i) => ({
    text,
    box: { x: 100, y: 200 + i * 20, w: 200, h: 10 },
    size: 10,
    bold: false,
    italic: false,
    font: "Body",
  }));
  const blocks = texts.map(([text, role], i): Block => ({
    id: `p1b${i}`,
    kind: "text",
    page: 1,
    box: lines[i].box,
    lines: [i],
    text,
    role,
    level: role === "heading" ? 1 : 0,
    depth: 0,
    bold: false,
    italic: false,
    marker: "",
    size: 10,
    font: "Body",
    picture: -1,
  }));
  return { format: ANALYSIS_FORMAT, reader: READER, bodySize: 10, pages: [{ n: 1, width: 600, height: 800, lines, pictures: [], blocks }] };
}

/** `change` made to the source of `a` with `edits`. */
function on(a: Analysis, edits: Edits, change: (s: string) => string) {
  const md = emit(a, "a/", edits);
  const r = applyDraft(a, edits, md, change(md.text));
  if ("problems" in r) throw new Error(r.problems.map((p) => p.problem).join("; "));
  return r;
}

describe("what the review found", () => {
  test("a typo in a one-word block corrects it, never deletes it", () => {
    const a = page([["Teh", "heading"], ["Body.", "para"]]);
    const r = on(a, blankEdits(), (s) => s.replace("# Teh", "# The"));
    expect(r.edits.blocks.p1b0).toEqual({ text: "The" });
    expect(r.edits.inserts).toBeUndefined();
  });

  test("a typo of a few characters in a short list item corrects it", () => {
    const a = page([["Intro", "heading"], ["nested", "numbered"], ["second", "numbered"]]);
    const r = on(a, blankEdits(), (s) => s.replace("1. nested", "1. nestedd"));
    expect(r.edits.blocks.p1b1).toEqual({ text: "nestedd" });
    expect(emit(a, "a/", r.edits).text).toContain("2. second");
  });

  test("markup written inside a comment is read as markup", () => {
    const a = page([["Intro", "heading"], ["Body.", "para"]]);
    const r = on(a, blankEdits(), (s) => s.replace("# Intro", "<!-- # Intro -->"));
    expect(r.edits.blocks.p1b0).toEqual({ hidden: true });
  });

  test("taking the comment off a hidden list item shows it, still an item", () => {
    const a = page([["Intro", "heading"], ["one", "bullet"], ["two", "bullet"]]);
    const hidden = { ...blankEdits(), blocks: { p1b2: { hidden: true } } };
    const r = on(a, hidden, (s) => s.replace(/<!-- (- )?two -->/, "two"));
    expect(r.edits.blocks.p1b2).toBeUndefined();
  });

  test("emphasis on part of a line is refused, not kept as asterisks", () => {
    const a = page([["Intro", "heading"], ["Some word here.", "para"]]);
    const md = emit(a, "a/", blankEdits());
    const r = applyDraft(a, blankEdits(), md, md.text.replace("Some word here.", "Some *word* here."));
    expect(r).toHaveProperty("problems");
  });

  test("two lines edited across the rule between pages insert no `---`", () => {
    const a = doc();
    const two: Analysis = {
      ...a,
      pages: [a.pages[0], { ...a.pages[0], n: 2, blocks: a.pages[0].blocks.map((b) => ({ ...b, id: b.id.replace("p1", "p2"), page: 2 })) }],
    };
    const r = on(two, blankEdits(), (s) => s.replace("Third one.\n\n---\n\n# Title", "Third one, edited.\n\n---\n\n# Title, edited"));
    expect(r.edits.inserts).toBeUndefined();
    expect(r.inserted).toEqual([]);
  });

  test("text added on both sides of the rule between pages is two inserts, each on its page", () => {
    const a = doc();
    const two: Analysis = {
      ...a,
      pages: [a.pages[0], { ...a.pages[0], n: 2, blocks: a.pages[0].blocks.map((b) => ({ ...b, id: b.id.replace("p1", "p2"), page: 2 })) }],
    };
    const r = on(two, blankEdits(), (s) =>
      s.replace("Third one.\n\n---\n\n# Title", "Third one.\nNEW ON ONE\n\n---\n\nNEW ON TWO\n# Title"),
    );
    expect(r.edits.inserts).toEqual([
      { id: expect.any(String), page: 1, after: "p1b3", text: "NEW ON ONE" },
      { id: expect.any(String), page: 2, after: null, text: "NEW ON TWO" },
    ]);
    expect(emit(two, "a/", r.edits).text).toContain("Third one.\n\nNEW ON ONE\n\n---\n\nNEW ON TWO\n\n# Title");
  });

  test("text added after the rule, past a block rewritten before it, is on the later page", () => {
    const a = doc();
    const two: Analysis = {
      ...a,
      pages: [a.pages[0], { ...a.pages[0], n: 2, blocks: a.pages[0].blocks.map((b) => ({ ...b, id: b.id.replace("p1", "p2"), page: 2 })) }],
    };
    const r = on(two, blankEdits(), (s) => s.replace("Third one.\n\n---\n\n# Title", "Third one, edited.\n\n---\n\nNEW ON TWO\n# Title"));
    expect(r.edits.blocks.p1b3?.text).toBe("Third one, edited.");
    expect(r.edits.inserts).toEqual([{ id: expect.any(String), page: 2, after: null, text: "NEW ON TWO" }]);
  });

  test("inserted text ending in `---` is not taken for the rule between pages", () => {
    const a = doc();
    const two: Analysis = {
      ...a,
      pages: [a.pages[0], { ...a.pages[0], n: 2, blocks: a.pages[0].blocks.map((b) => ({ ...b, id: b.id.replace("p1", "p2"), page: 2 })) }],
    };
    const withInsert = addInsert(blankEdits(), 1, "p1b3", "Note\n\n---");
    const md = emit(two, "a/", withInsert);
    expect(md.text).toContain("Third one.\n\nNote\n\n---\n\n---\n\n# Title");
    expect(md.lines.filter((l) => l.block === "i1").map((l) => l.page)).toEqual([1, 1, 1]);
    const r = ok(applyDraft(two, withInsert, md, md.text.replace("---\n\n---\n\n# Title", "---\n\n---\n\nNEW\n# Title")));
    expect(r.edits.inserts).toEqual([
      { id: "i1", page: 1, after: "p1b3", text: "Note\n\n---" },
      { id: expect.any(String), page: 2, after: null, text: "NEW" },
    ]);
    expect(emit(two, "a/", r.edits).text).toContain("Note\n\n---\n\n---\n\nNEW\n\n# Title");
  });

  test("paragraphs written on both sides of an unchanged blank line are one insert", () => {
    const r = on(read, blankEdits(), (s) =>
      s.replace("First paragraph here.\n\nSecond", "First paragraph here.\nA.\n\nB.\nSecond"),
    );
    expect(r.edits.inserts).toEqual([{ id: "i1", page: 1, after: "p1b1", text: "A.\n\nB." }]);
    expect(r.inserted).toEqual(["A.\n\nB."]);
  });

  test("a break inside a page is not the rule between pages", () => {
    const r = on(read, { ...blankEdits(), blocks: { p1b2: { break_after: "page" } } }, (s) =>
      s.replace("Second paragraph here.\n\n---\n\nThird one.", "Second paragraph here.\n\n---\n\nNEW\nThird one."),
    );
    expect(r.edits.inserts).toEqual([{ id: expect.any(String), page: 1, after: "p1b2", text: "NEW" }]);
  });

  test("every block of a long run reworded is every block corrected", () => {
    const texts = Array.from({ length: 300 }, (_, i) => `Paragraph ${i} says a few words about pump ${i % 7} and gasket ${i % 5}.`);
    const long = page(texts.map((t) => [t, "para"]));
    const r = on(long, blankEdits(), (s) => s.replaceAll(".\n", ", revised.\n"));
    expect(r.corrected).toHaveLength(300);
    expect(r.inserted).toEqual([]);
    expect(r.deleted).toEqual([]);
  });

  test("a corrected block is not joined: its words would be lost", () => {
    const corrected = { ...blankEdits(), blocks: { p1b2: { text: "Second paragraph, here." } } };
    const r = on(read, corrected, (s) => s.replace("First paragraph here.\n\nSecond paragraph, here.", "First paragraph here. Second paragraph, here."));
    expect(r.edits.joins).toEqual({});
    expect(emit(read, "a/", r.edits).text).toContain("Second paragraph, here.");
  });

  test("on a tie, a line goes to the earlier block", () => {
    const a = page([["Steps", "heading"], ["Step one", "numbered"], ["Step two", "numbered"]]);
    const r = on(a, blankEdits(), (s) => s.replace("1. Step one\n2. Step two", "1. Step 1"));
    expect(r.edits.blocks.p1b1).toEqual({ text: "Step 1" });
    expect(r.edits.blocks.p1b2).toEqual({ deleted: true });
  });

  test("a line typed inside inserted text stays inside it", () => {
    const withInsert = addInsert(blankEdits(), 1, "p1b1", "line one\nline two");
    const r = on(read, withInsert, (s) => s.replace("line one\nline two", "line one\nMIDDLE\nline two"));
    expect(r.edits.inserts).toEqual([{ id: "i1", page: 1, after: "p1b1", text: "line one\nMIDDLE\nline two" }]);
  });

  test("text written above inserted text comes back above it", () => {
    const withInsert = addInsert(blankEdits(), 1, "p1b1", "EXISTING");
    const r = on(read, withInsert, (s) => s.replace("EXISTING", "BRAND NEW\n\nEXISTING"));
    expect(r.edits.inserts?.map((i) => i.text)).toEqual(["BRAND NEW", "EXISTING"]);
    const out = emit(read, "a/", r.edits).text;
    expect(out).toContain("BRAND NEW\n\nEXISTING");
  });

  test("text written below inserted text comes back below it", () => {
    const withInsert = addInsert(blankEdits(), 1, "p1b1", "EXISTING");
    const r = on(read, withInsert, (s) => s.replace("EXISTING", "EXISTING\n\nBRAND NEW"));
    expect(r.edits.inserts?.map((i) => i.text)).toEqual(["EXISTING", "BRAND NEW"]);
    expect(emit(read, "a/", r.edits).text).toContain("EXISTING\n\nBRAND NEW");
  });

  test("text written around inserted text keeps the order it was written in", () => {
    const withInsert = addInsert(blankEdits(), 1, "p1b1", "MIDDLE");
    const r = on(read, withInsert, (s) => s.replace("MIDDLE", "TOP\n\nMIDDLE\n\nBOTTOM"));
    expect(r.edits.inserts?.map((i) => i.text)).toEqual(["TOP", "MIDDLE", "BOTTOM"]);
    expect(emit(read, "a/", r.edits).text).toContain("TOP\n\nMIDDLE\n\nBOTTOM");
  });

  test("a page number hidden by the setting is left alone, and its line refused", () => {
    const a = page([["Intro", "heading"], ["Body.", "para"], ["12", "para"]]);
    a.pages[0].blocks[2].box = { x: 280, y: 780, w: 10, h: 10 };
    const set = setFurniture(blankEdits(), "page_numbers", "hide");
    const same = on(a, set, (s) => s.replace("<!-- page 12 -->", "<!-- page 12 --> "));
    expect(same.edits).toBe(set);
    const md = emit(a, "a/", set);
    expect(applyDraft(a, set, md, md.text.replace("<!-- page 12 -->", "page 12"))).toHaveProperty("problems");
  });
});

