/** The fidelity check (`fidelity.ts`) on analyses made by hand: what it
 *  counts as carried, what it leaves out of what a page should carry, and
 *  that what it reads of the markdown is the rendered text. That every
 *  reader case carries all its words is `reader.test.ts`'s to check. */

import { expect, test } from "vitest";
import {
  ANALYSIS_FORMAT,
  READER,
  type Analysis,
  type Block,
  type Role,
} from "src/lib/analysis";
import { blankEdits, type BlockEdit, type Edits } from "src/lib/edits";
import { emit } from "src/lib/emit";
import { fidelity } from "src/lib/fidelity";

function block(
  id: string,
  text: string,
  role: Role = "para",
  extra: Partial<Block> = {},
): Block {
  return {
    id,
    kind: role === "image" ? "image" : "text",
    page: 1,
    box: { x: 72, y: 100, w: 400, h: 10 },
    lines: [],
    text,
    role,
    level: role === "heading" ? 1 : 0,
    depth: 0,
    bold: false,
    italic: false,
    marker: "",
    size: 10,
    font: "Body",
    picture: role === "image" ? 0 : -1,
    ...extra,
  };
}

function doc(blocks: Block[], pictures = 0): Analysis {
  return {
    format: ANALYSIS_FORMAT,
    reader: READER,
    bodySize: 10,
    pages: [
      {
        n: 1,
        width: 612,
        height: 792,
        lines: [],
        pictures: Array.from({ length: pictures }, (_, i) => ({
          box: { x: 0, y: 0, w: 100, h: 100 },
          path: `p1-i${i}.png`,
          px: [100, 100] as [number, number],
        })),
        blocks,
      },
    ],
  };
}

const edited = (
  blocks: Record<string, BlockEdit>,
  more: Partial<Edits> = {},
): Edits => ({ ...blankEdits(), blocks, ...more });

function score(layer: string, analysis: Analysis, edits?: Edits) {
  return fidelity(
    [layer],
    analysis,
    emit(analysis, "doc.assets/", edits),
    edits,
  );
}

const PUMP = block("p1b0", "Grease the pump weekly.");
const LOG = block("p1b1", "Log every service.");

test("a page whose words all reach the markdown carries them all", () => {
  const scored = score(
    "Grease the pump weekly. Log every service.",
    doc([PUMP, LOG]),
  );
  expect(scored.coverage).toBe(1);
  expect(scored.expected).toBe(34);
  expect(scored.pages[0].missing).toEqual([]);
});

test("a word the reader lost is missing, and named", () => {
  const scored = score(
    "Grease the pump weekly. Log every service.",
    doc([PUMP]),
  );
  expect(scored.coverage).toBeCloseTo(19 / 34);
  expect(scored.pages[0].missing).toEqual(["log", "every", "service"]);
});

test("case, spacing and punctuation do not count, nor a hyphen rejoined", () => {
  const scored = score(
    "GREASE the pump week- ly . Log every ser vice",
    doc([PUMP, LOG]),
  );
  expect(scored.coverage).toBe(1);
  expect(scored.pages[0].missing).toEqual([]);
});

test("a deleted block's words are not expected", () => {
  const scored = score(
    "Grease the pump weekly. Log every service.",
    doc([PUMP, LOG]),
    edited({ p1b1: { deleted: true } }),
  );
  expect(scored.coverage).toBe(1);
  expect(scored.expected).toBe(19);
});

test("a hidden block's words are carried, and counted apart", () => {
  const scored = score(
    "Grease the pump weekly. Log every service.",
    doc([PUMP, LOG]),
    edited({ p1b1: { hidden: true } }),
  );
  expect(scored.coverage).toBe(1);
  expect(scored.hidden).toBe(15);
});

test("a hidden list item is read as its words, not its marker", () => {
  const item = block("p1b1", "Log every service.", "numbered", {
    marker: "a.",
  });
  const scored = score(
    "Grease the pump weekly. a. Log every service.",
    doc([PUMP, item]),
    edited({ p1b1: { hidden: true } }),
  );
  expect(scored.coverage).toBe(1);
  expect(scored.hidden).toBe(15);
});

test("a corrected block is left out on both sides", () => {
  const typo = block("p1b1", "Lgo every sevrice.");
  const scored = score(
    "Grease the pump weekly. Lgo every sevrice.",
    doc([PUMP, typo]),
    // More words than the page printed, which would cover a lost one.
    edited({ p1b1: { text: "Log every service, and grease the pump." } }),
  );
  expect(scored.expected).toBe(19);
  expect(scored.coverage).toBe(1);

  const lost = score(
    "Grease the pump weekly. Lgo every sevrice.",
    doc([typo]),
    edited({
      p1b1: { text: "Log every service, and grease the pump weekly." },
    }),
  );
  expect(lost.pages[0].missing).toEqual(["grease", "the", "pump", "weekly"]);
});

test("a page number the setting deletes is not expected; one it hides is", () => {
  const folio = block("p1b2", "7", "para", {
    box: { x: 300, y: 760, w: 6, h: 8 },
  });
  const layer = "Grease the pump weekly. Log every service. 7";
  const analysis = doc([PUMP, LOG, folio]);
  expect(score(layer, analysis).expected).toBe(35);
  const deleted = score(
    layer,
    analysis,
    edited({}, { page_numbers: "delete" }),
  );
  expect(deleted.expected).toBe(34);
  expect(deleted.coverage).toBe(1);
  const hidden = score(layer, analysis, edited({}, { page_numbers: "hide" }));
  expect(hidden.expected).toBe(35);
  expect(hidden.coverage).toBe(1);
  expect(hidden.hidden).toBe(1);
});

test("a list marker is written as the list, not expected as a word", () => {
  const items = ["c.", "d."].map((marker, i) =>
    block(`p1b${i}`, i ? "Log it." : "Grease it.", "alpha", { marker }),
  );
  const scored = score("c. Grease it. d. Log it.", doc(items));
  expect(scored.coverage).toBe(1);
  expect(scored.expected).toBe(13);
});

test("markup is not words: a figure's alt text covers no word lost", () => {
  const figure = block("p1i0", "", "image");
  const scored = score("Page figure", doc([figure], 1));
  expect(scored.carried).toBe(0);
  expect(scored.pages[0].missing).toEqual(["page", "figure"]);
});

test("a document with nothing printed has nothing to carry", () => {
  expect(score("", doc([])).coverage).toBe(1);
});

test("a numbered item's number is expected, and read off the list as drawn", () => {
  const items = ["113.", "114."].map((marker, i) =>
    block(`p1b${i}`, i ? "Log it." : "Grease it.", "numbered", { marker }),
  );
  const layer = "113. Grease it. 114. Log it.";
  expect(score(layer, doc(items)).coverage).toBe(1);
  // Written from 1, as emit did before #98, the numbers are lost.
  const renumbered = fidelity([layer], doc(items), {
    ...emit(doc(items), "doc.assets/"),
    text: "1. Grease it.\n2. Log it.\n",
    lines: [
      { text: "1. Grease it.", block: "p1b0", page: 1 },
      { text: "2. Log it.", block: "p1b1", page: 1 },
    ],
  });
  expect(renumbered.pages[0].missing).toEqual(["113", "114"]);
});
