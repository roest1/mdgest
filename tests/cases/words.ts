/** Words a line break divided, put back together.
 *
 * A hyphen set against a word at a line's end has no space after it in the
 * block's text. The hyphen itself goes when both sides of it are lower
 * case, and stays when the word had a hyphen already, when either side is
 * a capital or a digit, when the two lines show it to be spelling -- one
 * letter beside it, the middle of a compound after it, a French pronoun
 * after its verb -- and when the document sets the same word with its
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
  {
    name: "words-one-letter-is-a-word",
    about:
      "One consonant before the hyphen, or one letter that is the next word, is a word of its own and no division: the hyphen stays.",
    pages: [
      (pen) =>
        pen.lines(X, TOP, [
          "Each gasket batch is checked against the stated p-",
          "value, and Fittings are checked again by x-",
          "ray before the Pump is put back; see section vitamin-",
          "c for the Supplier and the grade.",
        ]),
    ],
    blocks: [
      "p Each gasket batch is checked against the stated p-value, and Fittings are checked again by x-ray before the Pump is put back; see section vitamin-c for the Supplier and the grade.",
    ],
  },
  {
    name: "words-rest-goes-on-past-an-apostrophe",
    about:
      "One letter and an apostrophe after the hyphen is the rest of a divided word, which is one word again.",
    pages: [
      (pen) =>
        pen.lines(X, TOP, [
          "The Dealer by the loading dock said the gaskets did-",
          "n't arrive, and the Spares are kept nearby.",
        ]),
    ],
    blocks: [
      "p The Dealer by the loading dock said the gaskets didn't arrive, and the Spares are kept nearby.",
    ],
  },
  {
    name: "words-compound-divided-at-its-first-hyphen",
    about:
      "A word that compounds are made around, with a hyphen after it, is the middle of one, whose first hyphen stays; a syllable as short is the rest of a divided word.",
    pages: [
      (pen) =>
        pen.lines(X, TOP, [
          "Gauges on the Pump are chosen for their signal-",
          "to-noise ratio and are checked three-",
          "and-a-half times a year, with the elec-",
          "tron-beam Welds and the medi-",
          "um-firm Gaskets beside them.",
        ]),
    ],
    blocks: [
      "p Gauges on the Pump are chosen for their signal-to-noise ratio and are checked three-and-a-half times a year, with the electron-beam Welds and the medium-firm Gaskets beside them.",
    ],
  },
  {
    name: "words-french-pronoun-after-its-verb",
    about:
      "French sets a hyphen between a verb and the pronoun after it, and in a few words more; a line break there keeps it.",
    pages: [
      (pen) =>
        pen.lines(X, TOP, [
          "Les joints de la Pompe sont en stock, dit-",
          "il au Fournisseur. Pourquoi les avez-",
          "vous commandés, et le Stock est peut-",
          "être complet. Le Fournisseur lui-",
          "même reste-",
          "t-il sur le quai.",
        ]),
    ],
    blocks: [
      "p Les joints de la Pompe sont en stock, dit-il au Fournisseur. Pourquoi les avez-vous commandés, et le Stock est peut-être complet. Le Fournisseur lui-même reste-t-il sur le quai.",
    ],
  },
  {
    name: "words-divided-after-one-vowel",
    about:
      "A vowel alone before the hyphen is a syllable of a divided word, which is one word again.",
    pages: [
      (pen) =>
        pen.lines(X, TOP, [
          "Les joints de la Pompe sont rangés par les é-",
          "lèves du Fournisseur au premier é-",
          "tage du quai.",
        ]),
    ],
    blocks: [
      "p Les joints de la Pompe sont rangés par les élèves du Fournisseur au premier étage du quai.",
    ],
  },
  {
    name: "words-hanging-hyphen-before-to",
    about:
      'A hyphen left hanging before "to" and a second hyphenated word keeps its space; "to" alone is the end of a divided word.',
    pages: [
      (pen) =>
        pen.lines(X, TOP, [
          "Pumps bought for the supply room are mid-",
          "to high-pressure Units, and each pho-",
          "to of a Fitting is kept with the log.",
        ]),
    ],
    blocks: [
      "p Pumps bought for the supply room are mid- to high-pressure Units, and each photo of a Fitting is kept with the log.",
    ],
  },
];
