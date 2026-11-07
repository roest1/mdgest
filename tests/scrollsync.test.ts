/** The scroll sync on two plain scrollers, with no document behind them:
 *  what leads, what follows, and what a layout's own scroll does. With no
 *  blocks in either, the ends are the only pairs, so the panes are lined up
 *  by proportion, and where each should be is arithmetic. Then where the
 *  markdown pane says its blocks are, on a page laid out and one not. */

import { createElement, type HTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown, {
  type Components,
  type ExtraProps,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import { afterEach, describe, expect, test } from "vitest";
import { markdownTops } from "src/components/editor/tops";
import {
  ANALYSIS_FORMAT,
  READER,
  type Analysis,
  type Block,
} from "src/lib/analysis";
import { blankEdits } from "src/lib/edits";
import { emit, type SourceLine } from "src/lib/emit";
import { pieces } from "src/lib/pieces";
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

test("a layout reported between a person's scroll and its event does not swallow the scroll", async () => {
  const { page, markdown } = panes();
  await scrollTo(page, 800);
  await expect.poll(() => markdown.scrollTop, settle).toBeCloseTo(300, 0);
  // The markdown scrolled, and an observer heard from before its scroll
  // event is sent -- with nothing in either pane another size. Taking the
  // markdown's offset as the layout's would swallow the event, and the
  // settle would put the markdown back under the pages.
  markdown.scrollTop = room(markdown);
  invalidateSync(DOC);
  await frame();
  await expect.poll(() => page.scrollTop, settle).toBeCloseTo(room(page), 0);
  // Past the settle, and still where it was scrolled to.
  await new Promise((done) => setTimeout(done, 200));
  expect(markdown.scrollTop).toBe(room(markdown));
  expect(page.scrollTop).toBeCloseTo(room(page), 0);
});

test("a scroll that brings in a layout of its own leads, and is not undone", async () => {
  const { page, markdown } = panes();
  await scrollTo(page, 800);
  await expect.poll(() => markdown.scrollTop, settle).toBeCloseTo(300, 0);
  // The markdown scrolled 300px, and what it brings into view laid out
  // 100px taller, reported before the scroll event is sent: further than a
  // layout 100px taller could move it, so the scroll is a person's.
  markdown.scrollTop = 600;
  resize(markdown, 1100);
  invalidateSync(DOC);
  await frame();
  // Its view's line at 600 + 600/700 of 400, of 1100: on the pages, 1600
  // of that fraction of 2000.
  const y = ((600 + (600 / 700) * 400) / 1100) * 2000;
  await expect.poll(() => page.scrollTop, settle).toBeCloseTo(y * 0.8, -1);
  // Past the settle, and still where it was scrolled to.
  await new Promise((done) => setTimeout(done, 200));
  expect(markdown.scrollTop).toBe(600);
  expect(page.scrollTop).toBeCloseTo(y * 0.8, -1);
});

describe("where the markdown pane's blocks are", () => {
  const text = (id: string, page: number, words: string): Block => ({
    id,
    kind: "text",
    page,
    box: { x: 0, y: 0, w: 100, h: 10 },
    lines: [],
    text: words,
    role: "para",
    level: 0,
    depth: 0,
    bold: false,
    italic: false,
    marker: "",
    size: 10,
    font: "Body",
    picture: -1,
  });
  /** Two pages of three paragraphs. */
  const doc: Analysis = {
    format: ANALYSIS_FORMAT,
    reader: READER,
    bodySize: 10,
    pages: [1, 2].map((n) => ({
      n,
      width: 600,
      height: 800,
      lines: [],
      pictures: [],
      blocks: [0, 1, 2].map((i) =>
        text(`p${n}b${i}`, n, `Page ${n}, block ${i}.`),
      ),
    })),
  };

  /** One piece as the pane's rendered view draws it: react-markdown's
   *  block elements, each marked with the block that wrote its line. */
  function rendered(piece: { text: string; lines: SourceLine[] }): string {
    const components: Components = Object.fromEntries(
      ["p", "h1", "h2", "li"].map((tag) => [
        tag,
        ({ node, ...props }: HTMLAttributes<HTMLElement> & ExtraProps) =>
          createElement(tag, {
            ...props,
            "data-block":
              piece.lines[(node?.position?.start.line ?? 0) - 1]?.block ??
              undefined,
          }),
      ]),
    );
    return renderToStaticMarkup(
      createElement(
        ReactMarkdown,
        { remarkPlugins: [remarkGfm], components },
        piece.text,
      ),
    );
  }

  test("a hidden block has no element on a page laid out, and is estimated by its line on one that is not", () => {
    const md = emit(doc, "a/", {
      ...blankEdits(),
      blocks: { p1b1: { hidden: true }, p2b1: { hidden: true } },
    });
    const [one, two] = pieces(md);
    const el = scroller(0);
    el.replaceChildren();
    const laid = document.createElement("div");
    laid.dataset.piece = "1";
    laid.innerHTML = rendered(one);
    const wait = document.createElement("div");
    wait.dataset.wait = "2";
    wait.style.height = "300px";
    el.append(laid, wait);
    els = [el];
    const tops = markdownTops(
      el,
      new Map([
        [1, one],
        [2, two],
      ]),
      new WeakSet(),
    );
    const top = (node: Element) =>
      node.getBoundingClientRect().top - el.getBoundingClientRect().top;
    // Page 1 is laid out: each block is where its element is. The hidden
    // one is a comment, which renders no element, so it has no top: the
    // sync interpolates across it between its neighbors, which pair.
    expect(el.querySelector('[data-block="p1b1"]')).toBeNull();
    expect(tops.has("p1b1")).toBe(false);
    for (const id of ["p1b0", "p1b2"])
      expect(tops.get(id)).toBe(top(el.querySelector(`[data-block="${id}"]`)!));
    // Page 2 waits to be drawn: every block is put down its box by the
    // line it was written on, the hidden one's comment line with the rest.
    const line = (id: string) => two.lines.findIndex((l) => l.block === id);
    for (const id of ["p2b0", "p2b1", "p2b2"]) {
      expect(line(id)).toBeGreaterThan(0);
      expect(tops.get(id)).toBeCloseTo(
        top(wait) + (line(id) / two.lines.length) * 300,
        5,
      );
    }
    expect(tops.get("p2b0")!).toBeLessThan(tops.get("p2b1")!);
    expect(tops.get("p2b1")!).toBeLessThan(tops.get("p2b2")!);
  });
});
