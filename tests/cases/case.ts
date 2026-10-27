/** A reader test case: pages drawn to pin one default down, and what they
 *  should read as.
 *
 * `blocks` is the analysis in brief, one string per block in reading order:
 *
 *   h2 Section title           a heading and its level
 *   p Words of a paragraph     a paragraph
 *   numbered 1. Words          a list item: role, the marker as printed,
 *     alpha a. Words           and two spaces per level of nesting
 *     bullet Words             an item with no marker: a detail line
 *   image p1-i0.png            a picture
 *   ---                        a page break
 *
 * and a block that links ends ` -> ` and where it points. */

import type { Analysis, Block } from "src/lib/analysis";
import type { Draw } from "../fixtures/pdf";

export interface Case {
  /** The fixture's file name, and the test's. */
  name: string;
  /** What the case pins down, for whoever reads a failure. */
  about: string;
  pages: Draw[];
  blocks: string[];
  /** Set when the reader gets this case wrong today: why, in a sentence.
   *  The expectation stays what is right; the test is marked as failing
   *  until the reader is fixed, and then says so. */
  known?: string;
}

function brief(block: Block): string {
  const what = kind(block);
  return block.href ? `${what} -> ${block.href}` : what;
}

/** The block in brief, its link aside. */
function kind(block: Block): string {
  if (block.kind === "image")
    return `image ${block.picture < 0 ? "?" : `p${block.page}-i${block.picture}.png`}`;
  if (block.role === "heading") return `h${block.level} ${block.text}`;
  if (block.role === "para") return `p ${block.text}`;
  // A detail line made an item has no marker of its own.
  return `${"  ".repeat(block.depth)}${[block.role, block.marker, block.text].filter(Boolean).join(" ")}`;
}

export function summarize(analysis: Analysis): string[] {
  return analysis.pages.flatMap((page, i) => [
    ...(i > 0 ? ["---"] : []),
    ...page.blocks.map(brief),
  ]);
}
