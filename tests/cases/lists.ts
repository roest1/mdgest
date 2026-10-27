/** Lists: which markers make an item, which only look like one, and how
 *  deep an item sits.
 *
 * The role the reader gives an item is what is checked: lettered and
 * numeral markers stay as printed, whatever count they make. */

import { LEADING, PARAGRAPH, type Pen } from "../fixtures/pdf";
import type { Case } from "./case";
import { joined, prose, TOP, X } from "./text";

/** Short items, each with a capital and a descender. */
const ITEMS = [
  "Grease the pump bearings",
  "Check the gaskets yearly",
  "Replace any worn coupling",
  "Log every repair",
  "Keep the strainers empty",
  "Test the pressure gauge",
  "Bleed air from the piping",
  "Tighten loose fittings",
  "Inspect the impeller",
  "Record the supply voltage",
  "Clean the cooling fins",
  "Flush the drain plug",
];

/** Items one per line, `marker + text`, as one run each. */
function list(
  pen: Pen,
  markers: string[],
  { x = X, y = TOP, from = 0 } = {},
): number {
  return pen.lines(
    x,
    y,
    markers.map((m, i) => `${m}${ITEMS[(from + i) % ITEMS.length]}`),
  );
}

export const lists: Case[] = [
  // ---- bullets ------------------------------------------------------------
  {
    name: "lists-bullet-glyphs",
    about:
      "Each bullet glyph and dash form starts a bullet item; the dash forms need the space after them, the bullet glyph does not.",
    pages: [(pen) => list(pen, ["• ", "- ", "– ", "— ", "· ", "* ", "•"])],
    blocks: [
      `bullet • ${ITEMS[0]}`,
      `bullet - ${ITEMS[1]}`,
      `bullet – ${ITEMS[2]}`,
      `bullet — ${ITEMS[3]}`,
      `bullet · ${ITEMS[4]}`,
      `bullet * ${ITEMS[5]}`,
      `bullet • ${ITEMS[6]}`,
    ],
  },
  {
    name: "lists-dingbat-bullets",
    about:
      "Bullets set in a picture face (ZapfDingbats), in a run of their own before the text, as word processors write them.",
    pages: [
      (pen) =>
        ["●", "■", "◆", "❖"].forEach((glyph, i) => {
          pen.text(X, TOP + i * LEADING, glyph, { face: "dingbats", size: 7 });
          pen.text(X + 18, TOP + i * LEADING, ITEMS[i]);
        }),
    ],
    blocks: [
      `bullet ● ${ITEMS[0]}`,
      `bullet ■ ${ITEMS[1]}`,
      `bullet ◆ ${ITEMS[2]}`,
      `bullet ❖ ${ITEMS[3]}`,
    ],
    known:
      "pdf.js reports a ZapfDingbats glyph by its character code -- `l` for ●, `n` for ■ -- and read.ts remaps only Wingdings and Webdings, so each bullet is read as a letter, stands apart from its text, and the items run together as one paragraph.",
  },
  {
    name: "lists-dash-lookalikes",
    about:
      "A dash or star with no space after it opens a sentence, not a list: -5 °C, *emphasis*, an em dash, ·word.",
    pages: [
      (pen) =>
        pen.lines(
          X,
          TOP,
          [
            "-5 °C is the lowest reading allowed.",
            "*Emphasis* marks a term defined below.",
            "—and so the pump stops.",
            "–40 °C is the coldest it gets.",
            "·Grease is applied by hand.",
          ],
          { leading: PARAGRAPH },
        ),
    ],
    blocks: [
      "p -5 °C is the lowest reading allowed.",
      "p *Emphasis* marks a term defined below.",
      "p —and so the pump stops.",
      "p –40 °C is the coldest it gets.",
      "p ·Grease is applied by hand.",
    ],
  },

  // ---- numbered ---------------------------------------------------------------
  {
    name: "lists-numbered",
    about:
      "Numbers of one to three digits with . or ) or in parentheses are numbered items, each marker as printed.",
    pages: [
      (pen) => list(pen, ["1. ", "2) ", "(3) ", "10. ", "100. ", "999) "]),
    ],
    blocks: [
      `numbered 1. ${ITEMS[0]}`,
      `numbered 2) ${ITEMS[1]}`,
      `numbered (3) ${ITEMS[2]}`,
      `numbered 10. ${ITEMS[3]}`,
      `numbered 100. ${ITEMS[4]}`,
      `numbered 999) ${ITEMS[5]}`,
    ],
  },
  {
    name: "lists-numbered-lookalikes",
    about:
      "A four-digit number, a decimal and a year open sentences, not items.",
    pages: [
      (pen) =>
        pen.lines(
          X,
          TOP,
          [
            "1000. Gaskets were shipped in the spring.",
            "3.14 is the ratio used for the piping.",
            "2024 was a year of many repairs.",
            "1.5 hours per pump is typical.",
          ],
          { leading: PARAGRAPH },
        ),
    ],
    blocks: [
      "p 1000. Gaskets were shipped in the spring.",
      "p 3.14 is the ratio used for the piping.",
      "p 2024 was a year of many repairs.",
      "p 1.5 hours per pump is typical.",
    ],
  },

  // ---- lettered -----------------------------------------------------------------
  {
    name: "lists-lettered",
    about:
      "Single letters with . or ) or in parentheses are lettered items, lower and upper case.",
    pages: [
      (pen) => {
        const y = list(pen, ["a. ", "b) ", "(c) ", "d. "]);
        pen.text(X, y + PARAGRAPH, prose(1)[0]);
        list(pen, ["A. ", "B) ", "(C) "], { y: y + 2 * PARAGRAPH, from: 4 });
      },
    ],
    blocks: [
      `alpha a. ${ITEMS[0]}`,
      `alpha b) ${ITEMS[1]}`,
      `alpha (c) ${ITEMS[2]}`,
      `alpha d. ${ITEMS[3]}`,
      `p ${prose(1)[0]}`,
      `alpha A. ${ITEMS[4]}`,
      `alpha B) ${ITEMS[5]}`,
      `alpha (C) ${ITEMS[6]}`,
    ],
  },
  {
    name: "lists-lettered-past-h",
    about:
      "A lettered list long enough to reach i. stays lettered: in a run of a. b. c., i. is the ninth letter, not the numeral one.",
    pages: [
      (pen) =>
        list(pen, [
          "a. ",
          "b. ",
          "c. ",
          "d. ",
          "e. ",
          "f. ",
          "g. ",
          "h. ",
          "i. ",
          "j. ",
        ]),
    ],
    blocks: "abcdefghij".split("").map((l, i) => `alpha ${l}. ${ITEMS[i]}`),
    known:
      "Roman numerals are matched before letters so that a numeral list's i. and v. are numerals, with no look at the items around them -- so i. in a lettered list is read as roman, and the markdown count restarts there.",
  },

  // ---- roman ------------------------------------------------------------------------
  {
    name: "lists-roman",
    about:
      "Roman numerals to x, lower and upper case, with . or ) or in parentheses, are numeral items -- i. and v. among them.",
    pages: [
      (pen) => {
        const y = list(pen, [
          "i. ",
          "ii. ",
          "iii) ",
          "(iv) ",
          "v. ",
          "vi. ",
          "vii. ",
          "viii. ",
          "ix. ",
          "x. ",
        ]);
        pen.text(X, y + PARAGRAPH, prose(1)[0]);
        list(pen, ["I. ", "II) ", "(III) ", "IV. "], { y: y + 2 * PARAGRAPH });
      },
    ],
    blocks: [
      ...[
        "i.",
        "ii.",
        "iii)",
        "(iv)",
        "v.",
        "vi.",
        "vii.",
        "viii.",
        "ix.",
        "x.",
      ].map((m, i) => `roman ${m} ${ITEMS[i]}`),
      `p ${prose(1)[0]}`,
      ...["I.", "II)", "(III)", "IV."].map((m, i) => `roman ${m} ${ITEMS[i]}`),
    ],
  },

  // ---- markers in a run of their own ----------------------------------------------
  {
    name: "lists-marker-in-own-run",
    about:
      "A marker set apart from its text by a tab -- a run of its own, a wide gap after it -- still joins its text.",
    pages: [
      (pen) =>
        ["•", "1.", "a)", "iv."].forEach((marker, i) => {
          pen.text(X, TOP + i * PARAGRAPH, marker);
          pen.text(X + 18, TOP + i * PARAGRAPH, ITEMS[i]);
        }),
    ],
    blocks: [
      `bullet • ${ITEMS[0]}`,
      `numbered 1. ${ITEMS[1]}`,
      `alpha a) ${ITEMS[2]}`,
      `roman iv. ${ITEMS[3]}`,
    ],
  },
  {
    name: "lists-marker-gap",
    about:
      "Behind a marker, a gap up to 3 × the line height joins (27pt over 9.2pt ink); past it (28.5pt) the marker stands alone.",
    pages: [
      (pen) => {
        pen.text(X, TOP, "1.");
        pen.then(27, ITEMS[0]);
        pen.text(X, TOP + PARAGRAPH, "2.");
        pen.then(28.5, ITEMS[1]);
      },
    ],
    blocks: [`numbered 1. ${ITEMS[0]}`, "p 2.", `p ${ITEMS[1]}`],
  },

  // ---- nesting ---------------------------------------------------------------------
  {
    name: "lists-nesting",
    about:
      "Depth comes from indent: each further indent is one level deeper, and coming back out returns to the level there.",
    pages: [
      (pen) =>
        [
          [X, 0],
          [X + 18, 1],
          [X + 36, 2],
          [X + 18, 3],
          [X, 4],
        ].forEach(([x, i]) => pen.text(x, TOP + i * LEADING, `• ${ITEMS[i]}`)),
    ],
    blocks: [
      `bullet • ${ITEMS[0]}`,
      `  bullet • ${ITEMS[1]}`,
      `    bullet • ${ITEMS[2]}`,
      `  bullet • ${ITEMS[3]}`,
      `bullet • ${ITEMS[4]}`,
    ],
  },
  {
    name: "lists-indent-tolerance",
    about:
      "Indents within 3pt are one level (72 and 75); 4pt further in is a level deeper (76).",
    pages: [
      (pen) =>
        [X, X + 3, X, X + 4].forEach((x, i) =>
          pen.text(x, TOP + i * LEADING, `• ${ITEMS[i]}`),
        ),
    ],
    blocks: [
      `bullet • ${ITEMS[0]}`,
      `bullet • ${ITEMS[1]}`,
      `bullet • ${ITEMS[2]}`,
      `  bullet • ${ITEMS[3]}`,
    ],
  },
  {
    name: "lists-mixed-ordered-nesting",
    about:
      "Numbered, lettered and numeral levels nest, each nested item starting where its parent's text does.",
    pages: [
      (pen) =>
        (
          [
            [X, "1. ", 0],
            [X + 18, "a. ", 1],
            [X + 36, "i. ", 2],
            [X + 36, "ii. ", 3],
            [X + 18, "b. ", 4],
            [X, "2. ", 5],
          ] as const
        ).forEach(([x, m, i]) =>
          pen.text(x, TOP + i * LEADING, `${m}${ITEMS[i]}`),
        ),
    ],
    blocks: [
      `numbered 1. ${ITEMS[0]}`,
      `  alpha a. ${ITEMS[1]}`,
      `    roman i. ${ITEMS[2]}`,
      `    roman ii. ${ITEMS[3]}`,
      `  alpha b. ${ITEMS[4]}`,
      `numbered 2. ${ITEMS[5]}`,
    ],
  },

  // ---- what belongs to an item -------------------------------------------------------
  {
    name: "lists-wrapped-item",
    about:
      "An item's text wrapped onto a second line stays one item, whether the second line hangs under the text or under the bullet.",
    pages: [
      (pen) => {
        pen.lines(X, TOP, [
          "• Grease the pump bearings quarterly with the approved",
        ]);
        pen.text(
          X + 8,
          TOP + LEADING,
          "lithium type, and log the date of every greasing.",
        );
        pen.text(X, TOP + 2 * LEADING, `• ${ITEMS[1]}`);
        pen.lines(X, TOP + 3 * LEADING, [
          "• Replace any coupling that shows play greater than a",
          "quarter turn when rocked by hand.",
        ]);
      },
    ],
    blocks: [
      "bullet • Grease the pump bearings quarterly with the approved lithium type, and log the date of every greasing.",
      `bullet • ${ITEMS[1]}`,
      "bullet • Replace any coupling that shows play greater than a quarter turn when rocked by hand.",
    ],
  },
  {
    name: "lists-detail-line",
    about:
      "A plain line indented under an item and close below it is that item's detail, one level deeper. Not indented, or too far below, it is a paragraph.",
    pages: [
      (pen) => {
        pen.text(X, 96, `• ${ITEMS[0]}`);
        pen.text(X + 18, 120, "Use the approved lithium type only.");
        pen.text(X, 144, `• ${ITEMS[1]}`);
        pen.text(X, 168, "Keep a spare set by the pump.");
        pen.text(X, 192, `• ${ITEMS[2]}`);
        pen.text(X + 18, 228, "Order replacements by part number.");
      },
    ],
    blocks: [
      `bullet • ${ITEMS[0]}`,
      "  bullet Use the approved lithium type only.",
      `bullet • ${ITEMS[1]}`,
      "p Keep a spare set by the pump.",
      `bullet • ${ITEMS[2]}`,
      "p Order replacements by part number.",
    ],
  },
  {
    name: "lists-detail-reach-is-a-line",
    about:
      "How far below an item a detail may start is measured in lines, not in the detail's own height: an indented paragraph of three lines, set too far below for a one-line detail, is a paragraph too.",
    pages: [
      (pen) => {
        pen.text(X, TOP, `• ${ITEMS[0]}`);
        pen.lines(X + 18, TOP + 36, prose(3));
      },
    ],
    blocks: [`bullet • ${ITEMS[0]}`, `p ${joined(prose(3))}`],
  },
  {
    name: "lists-numbering-restarts",
    about:
      "A paragraph between two runs of items ends the list: the second run counts from 1 again, whatever was printed.",
    pages: [
      (pen) => {
        const y = list(pen, ["1. ", "2. "]);
        pen.text(X, y + PARAGRAPH, prose(1)[0]);
        list(pen, ["3. ", "4. "], { y: y + 2 * PARAGRAPH, from: 2 });
      },
    ],
    blocks: [
      `numbered 1. ${ITEMS[0]}`,
      `numbered 2. ${ITEMS[1]}`,
      `p ${joined(prose(1))}`,
      `numbered 3. ${ITEMS[2]}`,
      `numbered 4. ${ITEMS[3]}`,
    ],
  },
  {
    name: "lists-paragraph-set-tight-under-an-item",
    about:
      "A paragraph set tight under an item, at the marker's own left edge, is its own block: the item's wrapped lines line up past the marker, and this one steps back to it.",
    pages: [
      (pen) => {
        pen.text(X, TOP, `• ${ITEMS[0]} with enough words to`);
        pen.text(X + 14, TOP + LEADING, "wrap onto a second line");
        pen.text(X, TOP + 2 * LEADING, prose(1)[0]);
      },
    ],
    blocks: [
      `bullet • ${ITEMS[0]} with enough words to wrap onto a second line`,
      `p ${prose(1)[0]}`,
    ],
  },
];
