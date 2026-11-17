/** The page pane's blocks, as geometry: where each one's box is drawn on
 *  its page, and where each one starts in the pane's column. Where the
 *  note with its number goes is the stylesheet's (`.hit > .note` in
 *  index.css), from the box's place on the page. */

import type { Analysis, Block, Box } from "src/lib/analysis";
import type { Placed } from "src/lib/emit";
import { GAP, type Row } from "./column";

/** Around a block, a little outside the text, in CSS px: the box the
 *  page's reading gives is the glyphs' own, and a line drawn on it would
 *  touch them. In CSS px rather than points, so it is the same hair off the
 *  text at every zoom. */
const INSET = { x: 3, y: 2 };

/** The width of the ring `.hit` draws around a box, outside it, in CSS
 *  px: a box is kept this far inside the page, so the whole ring is on the
 *  paper. */
const RING = 1;

/** A block's box as drawn on its page, in CSS px: its box in points at the
 *  page's `scale`, with the inset around it, kept on the `page` -- its size
 *  in CSS px. A block printed to the page's edge, a full-bleed picture,
 *  would otherwise be ringed out on the pane's ground, past the paper. */
export function drawnBox(
  box: Box,
  scale: number,
  page: { w: number; h: number },
): Box {
  const x = Math.max(RING, box.x * scale - INSET.x);
  const y = Math.max(RING, box.y * scale - INSET.y);
  const right = Math.min(page.w - RING, (box.x + box.w) * scale + INSET.x);
  const bottom = Math.min(page.h - RING, (box.y + box.h) * scale + INSET.y);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/** Where each block starts in the pane's column, in content px, for the
 *  scroll sync: `top(n)` is where page `n`'s row begins, or undefined for
 *  a page the column has not laid out. Worked out from the layout rather
 *  than measured, since only the rows near the view are in the document.
 *  Only blocks the markdown wrote, since only those have somewhere to be
 *  on the other side: a deleted block has no line, and is left out; a
 *  hidden one has its comment's line, and is kept. */
export function pageTops(
  analysis: Analysis,
  placed: Record<string, Placed>,
  top: (page: number) => number | undefined,
  scale: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const page of analysis.pages) {
    const at = top(page.n);
    if (at === undefined) continue;
    for (const block of page.blocks) {
      const written = placed[block.id];
      if (written && !written.deleted)
        out.set(block.id, at + block.box.y * scale);
    }
  }
  return out;
}

/** Every block a lasso's box touches, the box in the column's content px:
 *  each block's box as drawn (`drawnBox`), on the rows laid out at
 *  `scale`, each row starting `left(row)` across. Worked out from the
 *  layout rather than the DOM, like `pageTops`: the pages a lasso runs
 *  onto as it scrolls the pane have no block elements yet. In the order
 *  the pages are, which the selection puts in the markdown's. */
export function swept(
  rows: Row[],
  box: Box,
  blocksOf: (page: number) => Block[],
  scale: number,
  left: (row: Row) => number,
): string[] {
  const hits: string[] = [];
  for (const row of rows) {
    if (row.top > box.y + box.h || row.top + row.height < box.y) continue;
    let x = left(row);
    for (const page of row.pages) {
      const local = { ...box, x: box.x - x, y: box.y - row.top };
      for (const block of blocksOf(page.n)) {
        if (touches(local, drawnBox(block.box, scale, page)))
          hits.push(block.id);
      }
      x += page.w + GAP;
    }
  }
  return hits;
}

/** Whether two boxes overlap, edges touching included: a lasso drawn
 *  exactly to a box's edge takes it. */
function touches(a: Box, b: Box): boolean {
  return (
    a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h
  );
}

/** How far past a block's corner the selection's buttons hang
 *  (`BlockActions`), in px, to the right and up: clear of most of its
 *  first line. Further out on the page, whose boxes sit tight on small
 *  text, than in the rendered view. */
export const ACTIONS_OUT = {
  markdown: { x: 8, y: 8 },
  page: { x: 24, y: 12 },
} as const;
