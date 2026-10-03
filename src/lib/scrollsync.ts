/** Scrolling one pane scrolls the other to the same place in the document.
 *
 * Each pane says where every block starts, in its own scroller's content
 * px: the pages from the layout they already work out, the markdown from
 * its DOM. Blocks found in both are pairs of points, and between pairs the
 * position is interpolated, so the follower moves smoothly rather than a
 * block at a time. Pairs that would run backwards on either side -- a
 * two-column page read down one column and then up the next -- are left
 * out, keeping the longest run that goes forwards on both.
 *
 * The pane last touched leads and the other follows. The follower's own
 * scrolling, including what this module does to it, is not sent back, so
 * the two never chase each other -- and a pane that brings a picked block
 * into view does not drag the one it was picked in. Kept outside React: it
 * runs on every scroll frame and draws nothing. */

import type { Side } from "./store";

export interface SyncPane {
  /** The whole pane, whose touch makes it the leader: its toolbar too, so
   *  a jump to a page is followed like a scroll. */
  root: HTMLElement;
  scroller: HTMLElement;
  /** Where each block starts, in the scroller's content px. */
  tops: () => Map<string, number>;
}

/** The two panes' positions of the same places, both strictly increasing:
 *  `page[i]` on the pages is `markdown[i]` in the markdown. */
type Points = Record<Side, number[]>;

interface Link {
  panes: Partial<Record<Side, SyncPane>>;
  leader: Side | null;
  points: Points | null;
}

const links = new Map<string, Link>();

function linkOf(docId: string): Link {
  let link = links.get(docId);
  if (!link) {
    link = { panes: {}, leader: null, points: null };
    links.set(docId, link);
  }
  return link;
}

const other = (side: Side): Side => (side === "page" ? "markdown" : "page");

/** Indices of the longest strictly increasing run of `ys`, in order. */
function longestRun(ys: number[]): number[] {
  const ends: number[] = [];
  const prev = new Array<number>(ys.length).fill(-1);
  for (let i = 0; i < ys.length; i++) {
    let lo = 0;
    let hi = ends.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ys[ends[mid]] < ys[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = ends[lo - 1];
    ends[lo] = i;
  }
  const out: number[] = [];
  for (let i = ends.at(-1) ?? -1; i >= 0; i = prev[i]) out.push(i);
  return out.reverse();
}

/** The pairs, with the two ends of both scrollers as the first and last,
 *  so the top of one is the top of the other and likewise the bottom. */
function pointsOf(page: SyncPane, markdown: SyncPane): Points {
  const pageEnd = page.scroller.scrollHeight;
  const markdownEnd = markdown.scroller.scrollHeight;
  const onPage = page.tops();
  const xs: number[] = [];
  const ys: number[] = [];
  // In the markdown's order, which is the order it was written in.
  for (const [id, y] of markdown.tops()) {
    const x = onPage.get(id);
    if (x === undefined || x <= 0 || x >= pageEnd || y <= 0 || y >= markdownEnd) continue;
    if (ys.length && y <= ys.at(-1)!) continue;
    xs.push(x);
    ys.push(y);
  }
  const run = longestRun(xs);
  return {
    page: [0, ...run.map((i) => xs[i]), pageEnd],
    markdown: [0, ...run.map((i) => ys[i]), markdownEnd],
  };
}

/** Where `x` on the `from` side falls on the `to` side, between the pair
 *  either side of it. */
function interpolate(from: number[], to: number[], x: number): number {
  let lo = 0;
  let hi = from.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (from[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = from[hi] - from[lo];
  const t = span > 0 ? (x - from[lo]) / span : 0;
  return to[lo] + t * (to[hi] - to[lo]);
}

/** Where a scroller is looking: a line that runs from the view's top edge
 *  when scrolled to the top, to its bottom edge at the bottom. With the
 *  scrollers' ends paired, that puts both ends of one at both ends of the
 *  other, and the middle of the view in the middle. */
function probe(el: HTMLElement): number {
  const room = el.scrollHeight - el.clientHeight;
  return room > 0 ? el.scrollTop + (el.scrollTop / room) * el.clientHeight : 0;
}

/** The scrollTop whose probe is at `y`: `probe` solved for scrollTop. */
function scrollFor(el: HTMLElement, y: number): number {
  return (y * (el.scrollHeight - el.clientHeight)) / el.scrollHeight;
}

function follow(link: Link, leader: Side) {
  const from = link.panes[leader];
  const to = link.panes[other(leader)];
  if (!from || !to) return;
  link.points ??= leader === "page" ? pointsOf(from, to) : pointsOf(to, from);
  const [xs, ys] =
    leader === "page"
      ? [link.points.page, link.points.markdown]
      : [link.points.markdown, link.points.page];
  to.scroller.scrollTop = scrollFor(to.scroller, interpolate(xs, ys, probe(from.scroller)));
}

/** Join `docId`'s pane on `side` to the other one; the returned function
 *  parts them. */
export function attachSync(docId: string, side: Side, pane: SyncPane): () => void {
  const link = linkOf(docId);
  link.panes[side] = pane;
  link.points = null;

  const lead = () => {
    link.leader = side;
  };
  // Followed at once: scroll events come at most a frame apart already,
  // and a frame later would let the two panes be seen out of step.
  const onScroll = () => {
    if (link.leader === side) follow(link, side);
  };
  // Whatever a person does to a pane first: point at it, press in it, turn
  // the wheel over it, or move focus into it for the keys.
  const leads = ["pointerenter", "pointerdown", "wheel", "touchstart", "focusin"] as const;
  for (const type of leads) pane.root.addEventListener(type, lead, { passive: true });
  pane.scroller.addEventListener("scroll", onScroll, { passive: true });

  return () => {
    for (const type of leads) pane.root.removeEventListener(type, lead);
    pane.scroller.removeEventListener("scroll", onScroll);
    if (link.panes[side] === pane) delete link.panes[side];
    if (link.leader === side) link.leader = null;
    link.points = null;
    if (!link.panes.page && !link.panes.markdown) links.delete(docId);
  };
}

/** A pane of `docId` laid out again: its blocks are somewhere else now.
 *
 * The pairs are remade a frame later rather than when the next scroll asks:
 * measuring forces a layout pass over the whole document, which taken in
 * the scroll handler is a visible hitch mid-scroll. A frame on, the layout
 * has settled and the handler's own work stays a lookup. */
export function invalidateSync(docId: string): void {
  const link = links.get(docId);
  if (!link) return;
  link.points = null;
  requestAnimationFrame(() => {
    const { page, markdown } = link.panes;
    if (link.points === null && page && markdown && links.get(docId) === link) {
      link.points = pointsOf(page, markdown);
    }
  });
}
