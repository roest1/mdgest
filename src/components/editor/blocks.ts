/** The page pane's blocks, as geometry: where each one's box is drawn on
 *  its page. Where the note with its number goes is the stylesheet's
 *  (`.hit > .note` in index.css), from the box's place on the page. */

import type { Box } from "src/lib/analysis";

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
