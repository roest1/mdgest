/** Words a line break divided, put back together.
 *
 * A hyphen set against a word at a line's end has no space after it in the
 * block's text. The hyphen itself goes when both sides of it are lower
 * case, and stays when the word had a hyphen already, when either side is
 * a capital or a digit, and when the document sets the same word with its
 * hyphen within a line. */

import type { Case } from "./case";
import { TOP, X } from "./text";

export const words: Case[] = [
  {
    name: "words-divided-rejoined",
    about:
      "A word divided at a line's end, lower case either side of the hyphen, is one word again.",
    pages: [
      (pen) =>
        pen.lines(X, TOP, [
          "Pumps are inspected yearly by the facility engi-",
          "neering group, and Spare gaskets are kept nearby.",
        ]),
    ],
    blocks: [
      "p Pumps are inspected yearly by the facility engineering group, and Spare gaskets are kept nearby.",
    ],
    markdown:
      "Pumps are inspected yearly by the facility engineering group, and Spare gaskets are kept nearby.\n",
  },
  {
    name: "words-compound-seen-within-a-line",
    about:
      "A word the document sets with its hyphen within a line keeps the hyphen when a line break falls on it.",
    pages: [
      (pen) =>
        pen.lines(X, TOP, [
          "A well-known Supplier ships the gaskets, and a well-",
          "known Dealer by the loading dock keeps the spares.",
        ]),
    ],
    blocks: [
      "p A well-known Supplier ships the gaskets, and a well-known Dealer by the loading dock keeps the spares.",
    ],
  },
  {
    name: "words-hyphen-kept-by-capital-or-digit",
    about:
      "A capital or a digit on either side of the hyphen keeps it, with no space after it.",
    pages: [
      (pen) =>
        pen.lines(X, TOP, [
          "Replace any coupling that is PTFE-",
          "lined with one made by the Smith-",
          "Jones group; Pumps bought in 1990-",
          "1995 are Replaced by the group.",
        ]),
    ],
    blocks: [
      "p Replace any coupling that is PTFE-lined with one made by the Smith-Jones group; Pumps bought in 1990-1995 are Replaced by the group.",
    ],
  },
  {
    name: "words-hyphenated-already",
    about:
      "A word with a hyphen inside it was divided at another of its own, which stays.",
    pages: [
      (pen) =>
        pen.lines(X, TOP, [
          "Log every repair of the state-of-the-",
          "art Pump, giving the date and the part.",
        ]),
    ],
    blocks: [
      "p Log every repair of the state-of-the-art Pump, giving the date and the part.",
    ],
  },
  {
    name: "words-hanging-hyphen",
    about:
      'A hyphen left hanging before "and" is the writer\'s, and keeps its space.',
    pages: [
      (pen) =>
        pen.lines(X, TOP, [
          "Pressure gauges on the high-",
          "and low-pressure Pumps are calibrated yearly.",
        ]),
    ],
    blocks: [
      "p Pressure gauges on the high- and low-pressure Pumps are calibrated yearly.",
    ],
  },
  {
    name: "words-dash-with-a-space-before",
    about:
      "A dash with a space before it is not part of a word, and the lines join as any two do.",
    pages: [
      (pen) =>
        pen.lines(X, TOP, [
          "Spare gaskets are kept by the loading dock -",
          "and Pumps beside them, in the supply room.",
        ]),
    ],
    blocks: [
      "p Spare gaskets are kept by the loading dock - and Pumps beside them, in the supply room.",
    ],
  },
];
