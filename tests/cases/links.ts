/** Links: a link annotation over a line makes that line's block a link.
 *
 * A line is the finest grain a link is tied to -- half a line's area under
 * the link's box carries it -- and a block is a link only when every line
 * of it points the same way. */

import { LEADING, PARAGRAPH } from "../fixtures/pdf";
import type { Case } from "./case";
import { joined, prose, TOP, X } from "./text";

const GUIDE = "https://example.com/pumps/guide";

/** Lines narrow enough to leave a right column beside them. */
const LEFT = [
  "Pumps are inspected yearly by",
  "the facility engineering group.",
  "Spare gaskets are kept in the",
];

/** A link box over the line whose baseline is `y`, `w` points wide. */
const over = (y: number, w = 420) => [X - 2, y - 10, w, 14] as const;

export const links: Case[] = [
  {
    name: "links-whole-block",
    about:
      "A paragraph whose every line is under one link is written [text](url).",
    pages: [
      (pen) => {
        pen.lines(X, TOP, prose(2));
        pen.link(...over(TOP), GUIDE);
        pen.link(...over(TOP + LEADING), GUIDE);
        pen.lines(X, TOP + 3 * PARAGRAPH, prose(3, 2), { leading: PARAGRAPH });
      },
    ],
    blocks: [
      `p ${joined(prose(2))} -> ${GUIDE}`,
      ...prose(3, 2).map((l) => `p ${l}`),
    ],
    markdown: [
      `[${joined(prose(2))}](${GUIDE})`,
      "",
      ...prose(3, 2).flatMap((l) => [l, ""]),
    ].join("\n"),
  },
  {
    name: "links-part-of-a-block",
    about:
      "A link over one line of two, or over under half of a line, links nothing: a block is a link only when all of it is.",
    pages: [
      (pen) => {
        pen.lines(X, TOP, prose(2));
        pen.link(...over(TOP), GUIDE);
        pen.text(X, TOP + PARAGRAPH + LEADING, prose(1, 2)[0]);
        pen.link(...over(TOP + PARAGRAPH + LEADING, 100), GUIDE);
        pen.lines(X, TOP + 3 * PARAGRAPH, prose(3, 3), { leading: PARAGRAPH });
      },
    ],
    blocks: [
      `p ${joined(prose(2))}`,
      `p ${prose(1, 2)[0]}`,
      ...prose(3, 3).map((l) => `p ${l}`),
    ],
    markdown: [
      joined(prose(2)),
      "",
      prose(1, 2)[0],
      "",
      ...prose(3, 3).flatMap((l) => [l, ""]),
    ].join("\n"),
  },
  {
    name: "links-unsafe-characters",
    about:
      "Spaces and parentheses in a link's URL are percent-encoded, so they cannot end the markdown link early.",
    pages: [
      (pen) => {
        pen.text(X, TOP, "Read the maintenance guide online.");
        pen.link(...over(TOP), "https://example.com/pump guide (rev 2).pdf");
        pen.lines(X, TOP + PARAGRAPH, prose(3), { leading: PARAGRAPH });
      },
    ],
    blocks: [
      // pdf.js hands the URL over with its spaces encoded, its parentheses
      // not: the markdown is left to encode those.
      "p Read the maintenance guide online. -> https://example.com/pump%20guide%20(rev%202).pdf",
      ...prose(3).map((l) => `p ${l}`),
    ],
    markdown: [
      "[Read the maintenance guide online.](https://example.com/pump%20guide%20%28rev%202%29.pdf)",
      "",
      ...prose(3).flatMap((l) => [l, ""]),
    ].join("\n"),
  },
  {
    name: "links-elsewhere-on-the-page",
    about:
      "A link marks only the lines under its box: a line apart from it on both axes -- the left column, below the link's baseline -- is not, however far apart.",
    pages: [
      (pen) => {
        pen.lines(X, TOP, LEFT, { leading: PARAGRAPH });
        pen.text(X + 258, TOP, "See the pump guide online.");
        pen.link(X + 258 - 2, TOP - 10, 140, 14, GUIDE);
      },
    ],
    blocks: [
      ...LEFT.map((l) => `p ${l}`),
      `p See the pump guide online. -> ${GUIDE}`,
    ],
    markdown: [
      ...LEFT.flatMap((l) => [l, ""]),
      `[See the pump guide online.](${GUIDE})`,
      "",
    ].join("\n"),
  },
];
