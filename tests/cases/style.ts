/** Bold and italic, and the characters that would read as markdown.
 *
 * Emphasis is applied to a whole block, and only when every line of it is
 * set that way; a line's own style is its majority by character, so one
 * italic word does not make a line italic. What the page printed is what
 * the block holds: markup characters in the text are kept as they are. */

import { LEADING, PARAGRAPH } from "../fixtures/pdf";
import type { Case } from "./case";
import { prose, TOP, X } from "./text";

export const style: Case[] = [
  {
    name: "style-whole-block",
    about:
      "A sentence set bold, italic or both at the body size is a paragraph, not a heading; a larger bold line is one.",
    pages: [
      (pen) => {
        pen.text(X, TOP, "Never run a pump dry.", { face: "bold" });
        pen.text(X, TOP + PARAGRAPH, "Readings are taken at the gauge.", {
          face: "italic",
        });
        pen.text(X, TOP + 2 * PARAGRAPH, "Shut the supply valve first.", {
          face: "boldItalic",
        });
        pen.text(X, TOP + 3 * PARAGRAPH, "Safety Rules", {
          size: 16,
          face: "bold",
        });
        pen.lines(X, TOP + 4 * PARAGRAPH, prose(4), { leading: PARAGRAPH });
      },
    ],
    blocks: [
      "p Never run a pump dry.",
      "p Readings are taken at the gauge.",
      "p Shut the supply valve first.",
      "h1 Safety Rules",
      ...prose(4).map((l) => `p ${l}`),
    ],
  },
  {
    name: "style-partial",
    about:
      "One italic word in a line, or one italic line in a paragraph, leaves the block unemphasized: emphasis is all or nothing, and a change of slant alone does not end a paragraph.",
    pages: [
      (pen) => {
        pen.text(X, TOP, "Grease the");
        pen.then(2.8, "bearings", { face: "italic" });
        pen.then(2.8, "every quarter with the approved lithium type.");
        pen.text(X, TOP + PARAGRAPH, prose(1, 0)[0]);
        pen.text(X, TOP + PARAGRAPH + LEADING, prose(1, 1)[0], {
          face: "italic",
        });
        pen.lines(X, TOP + 3 * PARAGRAPH, prose(3, 2), { leading: PARAGRAPH });
      },
    ],
    blocks: [
      "p Grease the bearings every quarter with the approved lithium type.",
      `p ${prose(1, 0)[0]} ${prose(1, 1)[0]}`,
      ...prose(3, 2).map((l) => `p ${l}`),
    ],
  },
  {
    name: "style-escapes",
    about:
      "Lines that start the way markdown opens a heading, quote, list or rule, or carry inline markup, are paragraphs of what was printed.",
    pages: [
      (pen) =>
        pen.lines(
          X,
          TOP,
          [
            "# Not a heading",
            "> Not a quote",
            "+ Not a list",
            "---",
            "Use *stars*, _lines_, `ticks` and [brackets] as printed.",
            "Pressure < 40 & rising is a warning sign.",
            "A back\\slash and a ~tilde~ are kept.",
          ],
          { leading: PARAGRAPH },
        ),
    ],
    blocks: [
      "p # Not a heading",
      "p > Not a quote",
      "p + Not a list",
      "p ---",
      "p Use *stars*, _lines_, `ticks` and [brackets] as printed.",
      "p Pressure < 40 & rising is a warning sign.",
      "p A back\\slash and a ~tilde~ are kept.",
    ],
  },
];
