/** What the markdown pane's Document properties say a file is: its length,
 *  its comments, and whether CommonMark renders all of it. */

import { describe, expect, test } from "vitest";
import { measure } from "src/lib/measure";

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
