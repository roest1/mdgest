/** The page pane's side of an edit: what a hidden block and a deleted one
 *  do to the boxes drawn over the page and to where the scroll sync says
 *  each block is. Both read `Placed` (`emit.ts`); neither is reached from
 *  the editor until edits are toggled from it. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { pageTops } from "src/components/editor/blocks";
import { PageBlocks } from "src/components/editor/PageBlocks";
import {
  ANALYSIS_FORMAT,
  READER,
  type Analysis,
  type Block,
} from "src/lib/analysis";
import { blankEdits } from "src/lib/edits";
import { emit } from "src/lib/emit";

/** A text block at height `y` of page 1. */
function block(id: string, text: string, y: number): Block {
  return {
    id,
    kind: "text",
    page: 1,
    box: { x: 50, y, w: 200, h: 10 },
    lines: [],
    text,
    role: "para",
    level: 0,
    depth: 0,
    bold: false,
    italic: false,
    marker: "",
    size: 10,
    font: "Body",
    picture: -1,
  };
}

const blocks = [
  block("p1b0", "Shown.", 100),
  block("p1b1", "Hidden.", 200),
  block("p1b2", "Deleted.", 300),
  block("p1b3", "   ", 400),
];
const doc: Analysis = {
  format: ANALYSIS_FORMAT,
  reader: READER,
  bodySize: 10,
  pages: [{ n: 1, width: 600, height: 800, lines: [], pictures: [], blocks }],
};
const md = emit(doc, "a/", {
  ...blankEdits(),
  blocks: { p1b1: { hidden: true }, p1b2: { deleted: true } },
});

describe("pageTops", () => {
  test("a deleted block has no line to pair with and is left out; a hidden one is kept", () => {
    const tops = pageTops(
      doc,
      md.blocks,
      (n) => (n === 1 ? 1000 : undefined),
      2,
    );
    expect([...tops]).toEqual([
      ["p1b0", 1200],
      ["p1b1", 1400],
    ]);
  });

  test("a page the column has not laid out gives no tops", () => {
    expect(pageTops(doc, md.blocks, () => undefined, 1).size).toBe(0);
  });
});

describe("PageBlocks", () => {
  const drawn = (
    boxes: { text: boolean; images: boolean },
    indices: boolean,
  ) => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      createElement(PageBlocks, {
        blocks,
        placed: md.blocks,
        scale: 1,
        page: { w: 600, h: 800 },
        boxes,
        indices,
      }),
    );
    return host;
  };
  const note = (host: HTMLElement, id: string) =>
    host.querySelector(`[data-block="${id}"] .note`)?.textContent;

  test("a hidden block keeps its number, a deleted one has a box and no number", () => {
    const host = drawn({ text: true, images: true }, true);
    expect(note(host, "p1b0")).toBe("1");
    expect(note(host, "p1b1")).toBe("2");
    expect(host.querySelector('[data-block="p1b2"]')).not.toBeNull();
    expect(note(host, "p1b2")).toBeUndefined();
    // No words, so no line of the markdown, like the deleted one.
    expect(note(host, "p1b3")).toBeUndefined();
  });

  test("with the boxes off, only the numbered blocks are drawn", () => {
    const host = drawn({ text: false, images: false }, true);
    expect(
      [...host.querySelectorAll("[data-block]")].map((el) =>
        el.getAttribute("data-block"),
      ),
    ).toEqual(["p1b0", "p1b1"]);
  });
});
