/** Where each block of the markdown pane starts, for the scroll sync --
 *  measured where a page is laid out, and put down by estimate where it
 *  is not.
 *
 * A page of the markdown is a box the browser skips while it is far off
 * screen (`.piece`, `content-visibility: auto`), which is what keeps a
 * book's hundred thousand blocks from costing a layout every frame. Asking
 * where a block inside a skipped page is would lay that page out, and
 * asking for every block lays out the book: seconds, every time the sync
 * measures. So a skipped page -- and a page still waiting to be drawn --
 * gives its blocks by how far down its lines each is written, inside the
 * page's own box, whose place is known without laying it out. A page
 * coming into view is laid out, and says so (`trackSkipped`): the sync is
 * measured again before it next follows, exactly where it is looked at. */

import type { Piece } from "src/lib/pieces";

/** Which pages the browser is skipping, as it says while it skips and
 *  stops: `contentvisibilityautostatechange`, which does not bubble and is
 *  heard on the way down instead. `onShown` hears a page stop being
 *  skipped. Where the event is not sent, nothing is counted as skipped,
 *  and every block is measured where it is -- right, only slower. */
export function trackSkipped(
  scroller: HTMLElement,
  onShown: () => void,
): { skipped: WeakSet<Element>; stop: () => void } {
  const skipped = new WeakSet<Element>();
  const hear = (e: Event) => {
    const { target } = e;
    if (!(target instanceof HTMLElement) || target.dataset.piece === undefined)
      return;
    if ((e as Event & { skipped: boolean }).skipped) skipped.add(target);
    else {
      skipped.delete(target);
      onShown();
    }
  };
  scroller.addEventListener("contentvisibilityautostatechange", hear, true);
  return {
    skipped,
    stop: () =>
      scroller.removeEventListener(
        "contentvisibilityautostatechange",
        hear,
        true,
      ),
  };
}

/** Each block's top in `scroller`'s content, in the order written: off
 *  the elements marked with it on a page laid out, and down a page's box
 *  by its line otherwise. */
export function markdownTops(
  scroller: HTMLElement,
  byPage: ReadonlyMap<number, Piece>,
  skipped: WeakSet<Element>,
): Map<string, number> {
  const out = new Map<string, number>();
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
  for (const page of scroller.querySelectorAll<HTMLElement>(
    "[data-piece], [data-wait]",
  )) {
    if (page.dataset.piece !== undefined && !skipped.has(page)) {
      for (const node of page.querySelectorAll<HTMLElement>("[data-block]")) {
        const id = node.dataset.block!;
        if (!out.has(id)) out.set(id, node.getBoundingClientRect().top - base);
      }
      continue;
    }
    const piece = byPage.get(Number(page.dataset.piece ?? page.dataset.wait));
    if (!piece) continue;
    const { top, height } = page.getBoundingClientRect();
    piece.lines.forEach(({ block }, i) => {
      if (block && !out.has(block))
        out.set(block, top - base + (i / piece.lines.length) * height);
    });
  }
  return out;
}
