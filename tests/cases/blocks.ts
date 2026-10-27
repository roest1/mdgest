/** Where one block ends and the next begins, and the order blocks are read
 *  in.
 *
 * Lines continue a block when they are close below it (within 1.1 × the
 * line height), overlap it across, share its size and weight, and do not
 * start left of its first line. Columns are read down before across. All
 * the prose here has a capital and a descender on every line, so each line's
 * ink is 9.2pt tall and a 1.1 × gap is 10.12pt. */

import { LEADING, PARAGRAPH } from "../fixtures/pdf";
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
      "Two runs on one baseline join as one line when the gap between them is under 0.6 × the line height (5pt against 9.2pt); wider (6.5pt) they are two columns.",
    pages: [
      (pen) => {
        pen.text(X, TOP, "Pressure");
        pen.then(5, "Gauge reading");
        pen.text(X, TOP + PARAGRAPH, "Pressure");
        pen.then(6.5, "Gauge reading");
      },
    ],
    blocks: ["p Pressure Gauge reading", "p Pressure", "p Gauge reading"],
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
