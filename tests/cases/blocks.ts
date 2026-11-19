/** Where one block ends and the next begins, and the order blocks are read
 *  in.
 *
 * Lines continue a block when they are close below it (within 1.1 × the
 * line height), overlap it across, share its size and weight, and do not
 * start left of its first line. Columns are read down before across. All
 * the prose here has a capital and a descender on every line, so each line's
 * ink is 9.2pt tall and a 1.1 × gap is 10.12pt. */

import { LEADING, PARAGRAPH, widthOf, type Pen } from "../fixtures/pdf";
import type { Case } from "./case";
import { joined, prose, TOP, X } from "./text";

/** Lines narrow enough for two columns, each with an ascender and a descender. */
const LEFT = [
  ["Pumps are inspected yearly by", "the facility engineering group."],
  ["Spare gaskets are kept in the", "supply room by the loading dock."],
];
const RIGHT = [
  ["Any reading outside the posted", "range is reported the same day."],
  ["Grease the pump bearings every", "quarter with the lithium type."],
];

/** A line set one run per word, `space` points between them, the way some
 *  PDFs store justified type. Returns where the line ends. */
function wordRuns(pen: Pen, x: number, y: number, text: string, space: number) {
  const [first, ...rest] = text.split(" ");
  pen.text(x, y, first);
  for (const word of rest) pen.then(space, word);
  return x + widthOf(text.replaceAll(" ", "")) + space * rest.length;
}

/** Wider than the space the reader always joins at (0.6 × 9.2pt, 5.5pt),
 *  as loose justified type sets them; and a gutter wider than that, still
 *  narrower than the widest space a line may hold (2.5 × 10pt). */
const LOOSE = 7;
const NARROW_GUTTER = 12;
/** Two lines of a column, the second ending in a reference. */
const MANUAL = ["Spare gaskets are listed in", "the supply manual (Fig."];

export const blocks: Case[] = [
  {
    name: "blocks-wrapped-paragraph",
    about: "Lines set at the paragraph's leading are one paragraph.",
    pages: [(pen) => pen.lines(X, TOP, prose(4))],
    blocks: [`p ${joined(prose(4))}`],
    markdown: `${joined(prose(4))}\n`,
  },
  {
    name: "blocks-gap-threshold",
    about:
      "Baselines 19pt apart leave a 9.8pt gap and continue the paragraph; 20pt apart leave 10.8pt, over 1.1 × 9.2, and start a new one.",
    pages: [
      (pen) => {
        pen.lines(X, TOP, prose(2, 0), { leading: 19 });
        pen.text(X, TOP + 19 + 20, prose(1, 2)[0]);
      },
    ],
    blocks: [`p ${joined(prose(2, 0))}`, `p ${prose(1, 2)[0]}`],
  },
  {
    name: "blocks-size-change",
    about:
      "A line 0.6pt larger than the one above continues it; 0.7pt larger starts a new block.",
    pages: [
      (pen) => {
        pen.text(X, TOP, prose(1, 0)[0]);
        pen.text(X, TOP + LEADING, prose(1, 1)[0], { size: 10.6 });
        pen.text(X, TOP + 3 * LEADING, prose(1, 2)[0]);
        pen.text(X, TOP + 4 * LEADING, prose(1, 3)[0], { size: 10.7 });
        // Enough 10pt text that 10pt stays the body size.
        pen.lines(X, TOP + 6 * LEADING, prose(4, 4), { leading: PARAGRAPH });
      },
    ],
    blocks: [
      `p ${joined(prose(2, 0))}`,
      `p ${prose(1, 2)[0]}`,
      `p ${prose(1, 3)[0]}`,
      ...prose(4, 4).map((l) => `p ${l}`),
    ],
  },
  {
    name: "blocks-weight-change",
    about:
      "A bold line under a regular one starts a new block, even at the paragraph's leading.",
    pages: [
      (pen) => {
        pen.text(X, TOP, prose(1, 0)[0]);
        pen.text(X, TOP + LEADING, prose(1, 1)[0], { face: "bold" });
        pen.lines(X, TOP + 3 * LEADING, prose(4, 2));
      },
    ],
    blocks: [
      `p ${prose(1, 0)[0]}`,
      `p ${prose(1, 1)[0]}`,
      `p ${joined(prose(4, 2))}`,
    ],
  },
  {
    name: "blocks-hanging-indent",
    about:
      "A paragraph whose later lines are indented (a hanging indent) is one paragraph.",
    pages: [
      (pen) => {
        pen.text(X, TOP, prose(1, 0)[0]);
        pen.lines(X + 18, TOP + LEADING, prose(2, 1));
      },
    ],
    blocks: [`p ${joined(prose(3, 0))}`],
  },
  {
    name: "blocks-outdent-threshold",
    about:
      "A line starting 8pt left of the paragraph's first line continues it; 9pt left -- past 0.9 × 9.2 -- starts a new block.",
    pages: [
      (pen) => {
        pen.text(X + 8, TOP, prose(1, 0)[0]);
        pen.text(X, TOP + LEADING, prose(1, 1)[0]);
        pen.text(X + 9, TOP + 3 * LEADING, prose(1, 2)[0]);
        pen.text(X, TOP + 4 * LEADING, prose(1, 3)[0]);
      },
    ],
    blocks: [
      `p ${joined(prose(2, 0))}`,
      `p ${prose(1, 2)[0]}`,
      `p ${prose(1, 3)[0]}`,
    ],
  },
  {
    name: "blocks-first-line-indent",
    about:
      "Paragraphs marked only by an indented first line, with no space between them -- the way books and papers are set -- are each one paragraph.",
    pages: [
      (pen) => {
        pen.text(X + 18, TOP, prose(1, 0)[0]);
        pen.lines(X, TOP + LEADING, prose(2, 1));
        pen.text(X + 18, TOP + 3 * LEADING, prose(1, 3)[0]);
        pen.lines(X, TOP + 4 * LEADING, prose(2, 4));
      },
    ],
    blocks: [`p ${joined(prose(3, 0))}`, `p ${joined(prose(3, 3))}`],
    known:
      "A continuation may not start left of a block's first line, so the indented first line stands alone, and the next paragraph's indented first line -- right of the block's new first line -- is taken as a continuation.",
  },
  {
    name: "blocks-two-columns",
    about:
      "Two columns are read down the left, then the right -- even where their paragraph breaks line up across.",
    pages: [
      (pen) => {
        pen.lines(X, TOP, LEFT[0]);
        pen.lines(X, TOP + LEADING + PARAGRAPH, LEFT[1]);
        pen.lines(X + 258, TOP, RIGHT[0]);
        pen.lines(X + 258, TOP + LEADING + PARAGRAPH, RIGHT[1]);
      },
    ],
    blocks: [
      `p ${joined(LEFT[0])}`,
      `p ${joined(LEFT[1])}`,
      `p ${joined(RIGHT[0])}`,
      `p ${joined(RIGHT[1])}`,
    ],
  },
  {
    name: "blocks-two-columns-under-a-title",
    about:
      "The same two columns between a full-width title and a full-width line are still read down the left, then the right.",
    pages: [
      (pen) => {
        pen.text(X, TOP, "Pump Room Notes for the Facility Engineering Group", {
          size: 18,
        });
        pen.lines(X, TOP + 36, LEFT[0]);
        pen.lines(X, TOP + 36 + LEADING + PARAGRAPH, LEFT[1]);
        pen.lines(X + 258, TOP + 36, RIGHT[0]);
        pen.lines(X + 258, TOP + 36 + LEADING + PARAGRAPH, RIGHT[1]);
        pen.text(
          X,
          TOP + 36 + 2 * LEADING + 2 * PARAGRAPH,
          "Revised quarterly by the facility engineering group and posted by the pump room door.",
        );
      },
    ],
    blocks: [
      "h1 Pump Room Notes for the Facility Engineering Group",
      `p ${joined(LEFT[0])}`,
      `p ${joined(LEFT[1])}`,
      `p ${joined(RIGHT[0])}`,
      `p ${joined(RIGHT[1])}`,
      "p Revised quarterly by the facility engineering group and posted by the pump room door.",
    ],
    known:
      "The title and the footer span the gutter, so the page has no vertical gutter at the top of the cut; the paragraph breaks that line up across the columns are then a horizontal band, and the page is cut into rows before columns -- read left, right, left, right.",
  },
  {
    name: "blocks-runs-on-a-line",
    about:
      "Two runs on one baseline join as one line when the gap between them is under 0.6 × the line height (5pt against 9.2pt); wider (6.5pt), on a line with no line near it to say the gap is a space, they are two columns.",
    pages: [
      (pen) => {
        pen.text(X, TOP, "Pressure");
        pen.then(5, "Gauge reading");
        pen.text(X, TOP + 3 * PARAGRAPH, "Pressure");
        pen.then(6.5, "Gauge reading");
      },
    ],
    blocks: ["p Pressure Gauge reading", "p Pressure", "p Gauge reading"],
  },
  {
    name: "blocks-word-runs-wide-spaces",
    about:
      "Justified type stored one run per word, its spaces 7pt wide: wider than the gap the reader always joins, and the lines around have ink where each space is, so each line is one line and the lines one paragraph.",
    pages: [
      (pen) =>
        prose(4).forEach((t, i) =>
          wordRuns(pen, X, TOP + i * LEADING, t, LOOSE),
        ),
    ],
    blocks: [`p ${joined(prose(4))}`],
  },
  {
    name: "blocks-word-runs-gutter",
    about:
      "Two columns of word runs with 7pt spaces and a 12pt gutter, the right column's baselines 1pt below the left's: the strip between the columns is clear on every line around, so it is a gutter, and each column is read whole.",
    pages: [
      (pen) => {
        const left = LEFT.flat();
        const ends = left.map(
          (t) =>
            X +
            widthOf(t.replaceAll(" ", "")) +
            LOOSE * (t.split(" ").length - 1),
        );
        const right = Math.max(...ends) + NARROW_GUTTER;
        left.forEach((t, i) => wordRuns(pen, X, TOP + i * LEADING, t, LOOSE));
        RIGHT.flat().forEach((t, i) =>
          wordRuns(pen, right, TOP + 1 + i * LEADING, t, LOOSE),
        );
      },
    ],
    blocks: [`p ${joined(LEFT.flat())}`, `p ${joined(RIGHT.flat())}`],
  },
  {
    name: "blocks-marker-ends-a-line",
    about:
      'A run like a list marker at the end of a line -- "54)" in "(Fig. 54)", a run of its own -- is no bullet: the gap after it is not widened as a bullet\'s is, and the 12pt gutter after it stays a gutter.',
    pages: [
      (pen) => {
        const left = [MANUAL[0], `${MANUAL[1]} 54)`, ...LEFT[1]];
        const right =
          X + Math.max(...left.map((t) => widthOf(t))) + LOOSE + NARROW_GUTTER;
        pen.text(X, TOP, MANUAL[0]);
        pen.text(X, TOP + LEADING, MANUAL[1]);
        // Far enough off for pdf.js to keep it a run of its own.
        pen.then(LOOSE, "54)");
        LEFT[1].forEach((t, i) => pen.text(X, TOP + (i + 2) * LEADING, t));
        RIGHT.flat().forEach((t, i) => pen.text(right, TOP + i * LEADING, t));
      },
    ],
    blocks: [
      `p ${joined([MANUAL[0], `${MANUAL[1]} 54)`, ...LEFT[1]])}`,
      `p ${joined(RIGHT.flat())}`,
    ],
  },
  {
    name: "blocks-space-or-kerning",
    about:
      "Between two runs of a line, a gap over 0.15 × the run's height is a space (1.5pt); under it is kerning (0.5pt).",
    pages: [
      (pen) => {
        pen.text(X, TOP, "Grease");
        pen.then(1.5, "pump");
        pen.text(X, TOP + PARAGRAPH, "Grease");
        pen.then(0.5, "pump");
      },
    ],
    blocks: ["p Grease pump", "p Greasepump"],
  },
  {
    name: "blocks-superscript-joins-its-line",
    about:
      "A superscript is set small and above the baseline, and is still of the line it sits on, not a line of its own.",
    pages: [
      (pen) => {
        pen.text(X, TOP, "Readings are logged daily.");
        pen.then(0, "1", { size: 6, rise: 3 });
        pen.text(X, TOP + LEADING, "Gauges are checked weekly.");
      },
    ],
    blocks: ["p Readings are logged daily.1 Gauges are checked weekly."],
  },
  {
    name: "blocks-tall-run-does-not-draw-two-lines-together",
    about:
      "A drop cap reaches over the lines beside it, but stands on its own baseline: the lines it overlaps stay whole and apart, with their words in order.",
    pages: [
      (pen) => {
        pen.text(X, TOP + 2 * LEADING, "T", { size: 30 });
        prose(3).forEach((t, i) => pen.text(X + 24, TOP + i * LEADING, t));
      },
    ],
    blocks: ["h1 T", `p ${joined(prose(3))}`],
  },
];
