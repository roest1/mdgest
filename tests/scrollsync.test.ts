/** The scroll sync on two plain scrollers, with no document behind them:
 *  what leads, what follows, and what a layout's own scroll does. With no
 *  blocks in either, the ends are the only pairs, so the panes are lined up
 *  by proportion, and where each should be is arithmetic. */

import { afterEach, expect, test } from "vitest";
import { attachSync, invalidateSync } from "src/lib/scrollsync";

const DOC = "sync-test";
const VIEW = 400;

function scroller(content: number): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = `height:${VIEW}px;overflow:auto`;
  const inner = document.createElement("div");
  inner.style.height = `${content}px`;
  el.append(inner);
  document.body.append(el);
  return el;
}

/** Content `content`px tall: the scroller is laid out anew. */
const resize = (el: HTMLElement, content: number) =>
  ((el.firstElementChild as HTMLElement).style.height = `${content}px`);

/** Past the frame a scroll event is sent before. */
const frame = () =>
  new Promise<void>((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done())),
  );

/** Scroll `el` to `top`, as a person would. */
async function scrollTo(el: HTMLElement, top: number): Promise<void> {
  el.scrollTop = top;
  await frame();
}

const room = (el: HTMLElement) => el.scrollHeight - el.clientHeight;
const settle = { timeout: 5_000 };

let detach: Array<() => void> = [];
let els: HTMLElement[] = [];

/** Two panes joined: pages 2000px tall and markdown 1000px, each in a
 *  400px view, so the pages scroll 1600px for the markdown's 600px. */
function panes() {
  const page = scroller(2000);
  const markdown = scroller(1000);
  els = [page, markdown];
  detach = [
    attachSync(DOC, "page", { scroller: page, tops: () => new Map() }),
    attachSync(DOC, "markdown", { scroller: markdown, tops: () => new Map() }),
  ];
  return { page, markdown };
}

afterEach(() => {
  for (const part of detach) part();
  for (const el of els) el.remove();
  detach = [];
  els = [];
});

test("the pane that scrolls leads, and the other follows in proportion", async () => {
  const { page, markdown } = panes();
  // Halfway down the pages: the view's middle is at 1000 of 2000, which is
  // 500 of the markdown's 1000, and that view's middle is at scrollTop 300.
  await scrollTo(page, 800);
  await expect.poll(() => markdown.scrollTop, settle).toBeCloseTo(300, 0);
  // And back the other way, to the ends.
  await scrollTo(markdown, room(markdown));
  await expect.poll(() => page.scrollTop, settle).toBeCloseTo(room(page), 0);
  await scrollTo(markdown, 0);
  await expect.poll(() => page.scrollTop, settle).toBe(0);
});

test("a scroll made by the follower's own layout leads nothing", async () => {
  const { page, markdown } = panes();
  await scrollTo(page, 800);
  await expect.poll(() => markdown.scrollTop, settle).toBeCloseTo(300, 0);
  // The markdown grows shorter than where it is scrolled to: the browser
  // clamps its offset to the new end, and sends a scroll event for that.
  // Taken as a person's, it would lead the pages to their end. Reported by
  // an observer, after the event.
  resize(markdown, 500);
  await frame();
  expect(markdown.scrollTop).toBe(100);
  invalidateSync(DOC);
  // The pages stay, and the markdown is put back under them: 500 of 1000
  // is 250 of 500, whose view's middle is at scrollTop 50.
  await expect.poll(() => markdown.scrollTop, settle).toBeCloseTo(50, 0);
  expect(page.scrollTop).toBe(800);
});

test("a scroll made by the leader's own layout leads nothing either", async () => {
  const { page, markdown } = panes();
  await scrollTo(page, 800);
  await expect.poll(() => markdown.scrollTop, settle).toBeCloseTo(300, 0);
  // Reported before the event, as a layout effect does.
  resize(page, 1000);
  invalidateSync(DOC);
  await frame();
  expect(page.scrollTop).toBe(600);
  // Clamped to its end, the pages lead from there once settled -- which is
  // the end of the markdown too -- rather than the markdown leading from
  // where it happened to be.
  await expect
    .poll(() => markdown.scrollTop, settle)
    .toBeCloseTo(room(markdown), 0);
  expect(page.scrollTop).toBe(600);
});

test("a pane laid out anew where it stands is put back in step", async () => {
  const { page, markdown } = panes();
  await scrollTo(page, 800);
  await expect.poll(() => markdown.scrollTop, settle).toBeCloseTo(300, 0);
  // Longer, with no scroll to say so: its offset is the same, and somewhere
  // else in the document now. 1000 of 2000 is 750 of 1500, whose view's
  // middle is at scrollTop 550.
  resize(markdown, 1500);
  invalidateSync(DOC);
  await expect.poll(() => markdown.scrollTop, settle).toBeCloseTo(550, 0);
  expect(page.scrollTop).toBe(800);
});

test("a scroll made as the layout settles leads, and is not undone", async () => {
  const { page, markdown } = panes();
  await scrollTo(page, 800);
  await expect.poll(() => markdown.scrollTop, settle).toBeCloseTo(300, 0);
  // A layout reported, and the markdown scrolled before its event is sent:
  // the settle that comes while the event is still to come finds it moved,
  // and follows it, rather than putting it back under the pages.
  invalidateSync(DOC);
  markdown.scrollTop = room(markdown);
  await expect.poll(() => page.scrollTop, settle).toBeCloseTo(room(page), 0);
  expect(markdown.scrollTop).toBe(room(markdown));
});

test("a scroll after the layout holds still is a person's again", async () => {
  const { page, markdown } = panes();
  resize(markdown, 500);
  invalidateSync(DOC);
  await frame();
  await scrollTo(markdown, room(markdown));
  await expect.poll(() => page.scrollTop, settle).toBeCloseTo(room(page), 0);
});
