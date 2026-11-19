/** What happens between pages: a rule in the markdown, and lists that do
 *  not run on across it. */

import type { Case } from "./case";
import { prose, TOP, X } from "./text";

const ITEMS = [
  "Grease the pump bearings",
  "Check the gaskets yearly",
  "Replace any worn coupling",
  "Log every repair",
];

export const pages: Case[] = [
  {
    name: "pages-rule-between",
    about:
      "Each page's blocks are written in turn with a --- rule between pages.",
    pages: [
      (pen) => pen.text(X, TOP, prose(1, 0)[0]),
      (pen) => pen.text(X, TOP, prose(1, 1)[0]),
    ],
    blocks: [`p ${prose(1, 0)[0]}`, "---", `p ${prose(1, 1)[0]}`],
    markdown: `${prose(1, 0)[0]}\n\n---\n\n${prose(1, 1)[0]}\n`,
  },
  {
    name: "pages-list-goes-on",
    about:
      "A numbered list carried onto the next page goes on counting there, from the number the page printed (#98).",
    pages: [
      (pen) => pen.lines(X, TOP, [`1. ${ITEMS[0]}`, `2. ${ITEMS[1]}`]),
      (pen) => pen.lines(X, TOP, [`3. ${ITEMS[2]}`, `4. ${ITEMS[3]}`]),
    ],
    blocks: [
      `numbered 1. ${ITEMS[0]}`,
      `numbered 2. ${ITEMS[1]}`,
      "---",
      `numbered 3. ${ITEMS[2]}`,
      `numbered 4. ${ITEMS[3]}`,
    ],
    markdown: [
      `1. ${ITEMS[0]}`,
      `2. ${ITEMS[1]}`,
      "",
      "---",
      "",
      `3. ${ITEMS[2]}`,
      `4. ${ITEMS[3]}`,
      "",
    ].join("\n"),
  },
];
