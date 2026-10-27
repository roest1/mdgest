/** What happens between pages: each is read on its own, and a list does
 *  not run on across the break. */

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
      "Each page is read on its own, its blocks in turn after the page before.",
    pages: [
      (pen) => pen.text(X, TOP, prose(1, 0)[0]),
      (pen) => pen.text(X, TOP, prose(1, 1)[0]),
    ],
    blocks: [`p ${prose(1, 0)[0]}`, "---", `p ${prose(1, 1)[0]}`],
  },
  {
    name: "pages-list-restarts",
    about:
      "A numbered list carried onto the next page is items on both, each marker as printed: no item runs across the break.",
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
  },
];
