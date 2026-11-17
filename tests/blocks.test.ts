/** The page pane's blocks: what a hidden block and a deleted one do to the
 *  boxes drawn over the page and to where the scroll sync says each block
 *  is, both read off `Placed` (`emit.ts`); what a selected block looks like
 *  whatever the tool bar says; and which blocks a lasso's box takes. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { drawnBox, pageTops, swept } from "src/components/editor/blocks";
import { GAP, layout, PAD } from "src/components/editor/column";
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
    selected: ReadonlySet<string> = new Set(),
  ) => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      createElement(PageBlocks, {
        blocks,
        lines: [],
        placed: md.blocks,
        scale: 1,
        page: { w: 600, h: 800 },
        boxes,
        indices,
        selected,
        onPick: () => {},
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

  test("with the boxes off, every block is still there to be clicked, drawing nothing", () => {
    const host = drawn({ text: false, images: false }, false);
    const all = [...host.querySelectorAll<HTMLElement>("[data-block]")];
    expect(all.map((el) => el.dataset.block)).toEqual([
      "p1b0",
      "p1b1",
      "p1b2",
      "p1b3",
    ]);
    expect(all.every((el) => el.matches(".hit.quiet"))).toBe(true);
    expect(host.querySelector(".note")).toBeNull();
  });

  test("a block the markdown placed is picked, a deleted one too -- here is where it is restored -- but not one with no words", () => {
    const host = drawn({ text: true, images: true }, true);
    expect(
      [...host.querySelectorAll<HTMLElement>(".pick")].map(
        (el) => el.dataset.block,
      ),
    ).toEqual(["p1b0", "p1b1", "p1b2"]);
  });

  test("a hidden block is veiled and a deleted one marked, whatever the tool bar says", () => {
    const host = drawn({ text: false, images: false }, false);
    const at = (id: string) =>
      host.querySelector<HTMLElement>(`[data-block="${id}"]`)!;
    expect(at("p1b1").querySelector(".veil")).not.toBeNull();
    expect(at("p1b2").matches(".deleted-block")).toBe(true);
    expect(at("p1b0").querySelector(".veil, .strike, .cross")).toBeNull();
  });

  test("a selected block is ringed and numbered whatever the tool bar says", () => {
    const host = drawn(
      { text: false, images: false },
      false,
      new Set(["p1b1"]),
    );
    const on = host.querySelector<HTMLElement>('[data-block="p1b1"]')!;
    expect(on.matches(".selection.on-paper")).toBe(true);
    expect(note(host, "p1b1")).toBe("2");
    expect(note(host, "p1b0")).toBeUndefined();
    expect(host.querySelectorAll(".selection")).toHaveLength(1);
  });
});

describe("swept", () => {
  /** Two pages of one block each, at the top-left and bottom-right. */
  const page = (n: number): Analysis["pages"][number] => ({
    n,
    width: 600,
    height: 800,
    lines: [],
    pictures: [],
    blocks: [
      { ...block(`p${n}b0`, "Top.", 50), page: n },
      {
        ...block(`p${n}b1`, "Bottom.", 700),
        page: n,
        box: { x: 350, y: 700, w: 200, h: 10 },
      },
    ],
  });
  const pages = [page(1), page(2), page(3)];
  const sizes = pages.map((p) => ({ w: p.width, h: p.height }));
  const blocksOf = (n: number) => pages[n - 1]?.blocks ?? [];
  const left = () => PAD;

  test("takes every block the box touches, as each is drawn, on every row the box crosses", () => {
    const rows = layout(sizes, 1, false);
    // From page 1's bottom-right block down to page 3's top one: the rows
    // between need not be in the document, since nothing is read off it.
    const b1 = drawnBox(pages[0].blocks[1].box, 1, sizes[0]);
    const t3 = drawnBox(pages[2].blocks[0].box, 1, sizes[2]);
    const box = {
      x: PAD,
      y: rows[0].top + b1.y,
      w: 600,
      h: rows[2].top + t3.y - (rows[0].top + b1.y),
    };
    expect(swept(rows, box, blocksOf, 1, left)).toEqual([
      "p1b1",
      "p2b0",
      "p2b1",
      "p3b0",
    ]);
  });

  test("the drawn box, inset and all: a box ending a hair outside the text still takes it", () => {
    const rows = layout(sizes, 1, false);
    // The text starts at x 50; drawn, its box starts 3px further out.
    const box = { x: PAD + 47 - 5, y: rows[0].top + 40, w: 5, h: 30 };
    expect(swept(rows, box, blocksOf, 1, left)).toEqual(["p1b0"]);
    expect(swept(rows, { ...box, w: 4 }, blocksOf, 1, left)).toEqual([]);
  });

  test("on a row of two pages, the second page's blocks are where it is drawn", () => {
    const rows = layout(sizes, 1, true);
    const x = PAD + 600 + GAP;
    const box = { x: x + 40, y: rows[0].top + 40, w: 20, h: 30 };
    expect(swept(rows, box, blocksOf, 1, left)).toEqual(["p2b0"]);
  });
});
