/** What the markdown pane's Document properties say a file is: its length,
 *  its comments, and whether CommonMark renders all of it. */

import { describe, expect, test } from "vitest";
import { measure } from "src/lib/measure";
import { cases } from "./cases";

describe("measure", () => {
  test("counts lines as a file holds them, the last one ended or not", () => {
    expect(measure("").lines).toBe(0);
    expect(measure("a").lines).toBe(1);
    expect(measure("a\n\nb\n").lines).toBe(3);
  });

  test("takes the text's length in UTF-8, and a token for about four characters", () => {
    const m = measure("é".repeat(8));
    expect(m.bytes).toBe(16);
    expect(m.tokens).toBe(2);
  });

  test("counts every line a comment is on, in a quote, a list or a paragraph", () => {
    const text = [
      "<!-- page 3 -->",
      "",
      "> <!-- quoted -->",
      "",
      "- item",
      "  <!-- - hidden item -->",
      "",
      "words <!-- inline --> words",
      "",
      "<!-- two",
      "lines -->",
      "",
    ].join("\n");
    expect(measure(text).commentLines).toBe(6);
  });

  test("a line with two comments is one line, and one never closed runs to the end", () => {
    expect(measure("<!-- a --> and <!-- b -->\nplain\n").commentLines).toBe(1);
    expect(measure("a\n<!-- open\nb\nc\n").commentLines).toBe(3);
    expect(measure("<!---->").commentLines).toBe(1);
  });

  test("finds GFM in whichever page holds it, as the pane renders a page", () => {
    const pages = [
      "# One\n\nplain\n",
      "---\n\n~~struck~~\n",
      "---\n\n- [ ] todo\n",
    ];
    expect(measure(pages.join(""), pages).gfm).toEqual([
      "strikethrough",
      "task lists",
    ]);
    // A reference whose definition is on another page is plain text on
    // its own, as the pane draws it; the definition's page is a footnote
    // with or without a reference.
    const apart = ["A note.[^1]\n", "---\n\n[^1]: The note.\n"];
    expect(measure(apart[0]).gfm).toEqual([]);
    expect(measure(apart.join(""), apart).gfm).toEqual(["footnotes"]);
  });

  test("a bar in prose is not a table, nor a URL in a link's parentheses a bare one", () => {
    expect(measure("the value |x| and |y - 1| as well\n").gfm).toEqual([]);
    expect(
      measure("[site](https://example.com) and <https://example.com>\n").gfm,
    ).toEqual([]);
    expect(measure("see https://example.com\n").gfm).toEqual(["bare links"]);
    expect(measure("| a | b |\n|---|---|\n| 1 | 2 |\n").gfm).toEqual([
      "tables",
    ]);
    expect(measure("write to a@b.co\n").gfm).toEqual(["bare links"]);
  });

  test("reads what the emitter writes as CommonMark", () => {
    const text = [
      "# Title",
      "",
      "**Bold** and *italic*, a [link](https://example.com) and <https://example.com>.",
      "",
      "1. one",
      "   - nested",
      "",
      "> quoted",
      "",
      "![page 1 figure 1](doc.assets/p1-i0.png)",
      "",
      "---",
      "",
      "2024\\. Not a list, \\~not struck\\~, \\[^1\\]",
      "",
    ].join("\n");
    expect(measure(text).gfm).toEqual([]);
  });

  test("names each GFM construct once, in the order met", () => {
    const text = [
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "~~gone~~ and www.example.com and ~~again~~",
      "",
      "- [x] done",
      "",
      "A note.[^1]",
      "",
      "[^1]: The note.",
      "",
    ].join("\n");
    expect(measure(text).gfm).toEqual([
      "tables",
      "strikethrough",
      "bare links",
      "task lists",
      "footnotes",
    ]);
  });
});

// What the emitter writes, case by case, needs nothing past CommonMark: a
// file the properties call GFM has had something typed into it.
describe("every reader case's markdown", () => {
  for (const [group, list] of Object.entries(cases))
    for (const c of list)
      if (c.markdown !== undefined)
        test(`${group}: ${c.name}`, () => {
          expect(measure(c.markdown!).gfm).toEqual([]);
        });
});
