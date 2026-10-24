/** The PDF pane's column of pages, as geometry: where each row sits at a
 *  zoom, and which of them are in view. */

/** Around the pages, and between them, in CSS px. */
export const PAD = 16;
export const GAP = 16;

export interface Row {
  /** The row's pages left to right: 1-based number and drawn size in CSS px.
   *  The sizes live here so the boxes the render draws are the very numbers
   *  the row's geometry was summed from. */
  pages: { n: number; w: number; h: number }[];
  top: number;
  width: number;
  height: number;
}

/** The column's geometry, worked out rather than measured: every page's
 *  size is known, so where each row sits follows from the zoom alone. That
 *  is what lets a page be scrolled to, and the pages near the view picked
 *  out, without reading the DOM. */
export function layout(
  sizes: { w: number; h: number }[],
  scale: number,
  twoPage: boolean,
): Row[] {
  const rows: Row[] = [];
  let top = PAD;
  for (let i = 0; i < sizes.length; i += twoPage ? 2 : 1) {
    const nums = twoPage && i + 1 < sizes.length ? [i + 1, i + 2] : [i + 1];
    const pages = nums.map((n) => ({
      n,
      w: Math.round(sizes[n - 1].w * scale),
      h: Math.round(sizes[n - 1].h * scale),
    }));
    const width = pages.reduce((sum, p) => sum + p.w, 0);
    const height = Math.max(...pages.map((p) => p.h));
    rows.push({ pages, top, width: width + GAP * (pages.length - 1), height });
    top += height + GAP;
  }
  return rows;
}

/** Which rows are worth drawing -- the view, and a screen either side --
 *  and which page is current: the first of the row under a line a third of
 *  the way down the view, or, when more than one row starts between the
 *  view's top and that line, the first of those -- the one a page typed
 *  into the bar was scrolled to, where short pages would otherwise leave
 *  the line in the row after it. At the very bottom it is the last row,
 *  which may never reach the line. */
export function inView(rows: Row[], top: number, height: number, end: boolean) {
  let first = -1;
  let last = -1;
  let current = 0;
  let starting = -1;
  const probe = top + height / 3;
  rows.forEach((row, i) => {
    const bottom = row.top + row.height;
    if (bottom >= top - height && row.top <= top + 2 * height) {
      if (first < 0) first = i;
      last = i;
    }
    // Rows are in order, so the last one starting above the probe holds it,
    // or is the nearest above it when the probe falls in a gap.
    if (row.top <= probe) current = i;
    if (starting < 0 && row.top >= top && row.top <= probe) starting = i;
  });
  if (starting >= 0 && starting < current) current = starting;
  if (end) current = rows.length - 1;
  return { first, last, current: rows[current].pages[0].n };
}
