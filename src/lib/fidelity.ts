/** Whether the markdown carries every word the pages print (#96).
 *
 * Held against the document's own pages, never against a reference copy:
 * what a page says is every run of text pdf.js finds on it, as `read.ts`
 * cleaned it and before the reader grouped any of it (`Read.text`), so a
 * word the grouping loses is still expected. The markdown is read as the
 * pane reads it, through `toHast`, so markup can neither pass for words
 * nor hide them.
 *
 * What counts is letters and digits, page by page, case and spaces and
 * punctuation aside: a hyphen rejoined across a line, or any change only
 * to spacing, carries the same letters. A count of letters cannot see
 * order, which the benchmarks measure; nor words the markdown invents. The
 * words missing are named on top, for a person to look for.
 *
 * Out of what a page is expected to carry:
 *  - a deleted block's words, by hand or by a furniture setting;
 *  - a block a person corrected, on both sides: its words are theirs now;
 *  - a list item's letter or numeral, `c.` or `iv.`: the markdown can
 *    write an ordered item only as a number, its place in the list. A
 *    numbered item's number is expected, and read off the list as the
 *    pane draws it.
 * A hidden block's words stay expected: they are in the file, as a
 * comment. They are counted apart, so hiding too much shows. Text a person
 * inserted is no block's, and is not counted. */

import type { Analysis } from "./analysis";
import type { Edits } from "./edits";
import type { Markdown } from "./emit";
import { add, carriedOf, lettersOf, textOf, total, wordsOf } from "./letters";

export interface PageFidelity {
  /** 1-based. */
  page: number;
  /** Letters and digits the page prints and the markdown should carry. */
  expected: number;
  /** Of those, how many it does, hidden ones among them. */
  carried: number;
  /** Of those carried, how many only in a hidden block's comment. */
  hidden: number;
  /** The words the page prints and the markdown does not, in the page's
   *  order, as many times as each is missing. */
  missing: string[];
}

export interface Fidelity {
  pages: PageFidelity[];
  expected: number;
  carried: number;
  hidden: number;
  /** `carried` over `expected`: 1 for a document with nothing to carry. */
  coverage: number;
}

/** What a hidden block's line says inside its comment. */
const COMMENTED = /<!-- ([\s\S]*) -->/;

/** How much of what `layers` print -- each page's `Read.text`, in page
 *  order -- the markdown `written` carries: `emit(analysis, …, edits)`. */
export function fidelity(
  layers: string[],
  analysis: Analysis,
  written: Markdown,
  edits?: Edits,
): Fidelity {
  const pages = analysis.pages.map((page, i): PageFidelity => {
    const expected = lettersOf(layers[i] ?? "");
    const words = wordsOf(layers[i] ?? "");
    /** Blocks whose lines are left out of the markdown's side. */
    const skipped = new Set<string>();
    const unexpect = (text: string) => {
      add(expected, lettersOf(text), -1);
      for (const word of wordsOf(text)) {
        const at = words.indexOf(word);
        if (at >= 0) words.splice(at, 1);
      }
    };
    for (const block of page.blocks) {
      const placed = written.blocks[block.id];
      const corrected = edits?.blocks[block.id]?.text !== undefined;
      // A number is written as the list's own (`emit.ts`), and expected;
      // a letter or numeral cannot be, and is not. A block a person made
      // something other than a numbered item writes no number.
      const role = edits?.blocks[block.id]?.role ?? block.role;
      unexpect(
        role === "numbered" ? block.marker.replace(/\d/g, "") : block.marker,
      );
      if (placed?.deleted || corrected) unexpect(block.text);
      if (corrected) skipped.add(block.id);
    }

    const shown: string[] = [];
    const commented: string[] = [];
    for (const line of written.lines) {
      if (line.page !== page.n) continue;
      const placed = line.block === null ? null : written.blocks[line.block];
      if (line.block !== null && skipped.has(line.block)) shown.push("");
      else if (placed?.hidden) {
        shown.push("");
        commented.push(COMMENTED.exec(line.text)?.[1] ?? "");
      } else shown.push(line.text);
    }
    const visible = textOf(shown.join("\n"));
    const hiddenText = commented.map(textOf).join(" ");

    const seen = lettersOf(visible);
    const both = new Map(seen);
    add(both, lettersOf(hiddenText));
    const carried = carriedOf(expected, both);

    // The words missing: what the page has more of than the markdown,
    // less any the markdown carries inside a longer word of its own -- a
    // hyphenated word rejoined, two runs read as one word.
    const have = new Map<string, number>();
    for (const word of [...wordsOf(visible), ...wordsOf(hiddenText)])
      have.set(word, (have.get(word) ?? 0) + 1);
    const missing: string[] = [];
    for (const word of words) {
      const n = have.get(word) ?? 0;
      if (n > 0) have.set(word, n - 1);
      else missing.push(word);
    }
    const spare = [...have].filter(([, n]) => n > 0).map(([word]) => word);
    return {
      page: page.n,
      expected: total(expected),
      carried,
      hidden: carried - carriedOf(expected, seen),
      missing: missing.filter(
        (word) => !spare.some((other) => other.includes(word)),
      ),
    };
  });
  const sum = (key: "expected" | "carried" | "hidden") =>
    pages.reduce((n, page) => n + page[key], 0);
  const expected = sum("expected");
  const carried = sum("carried");
  return {
    pages,
    expected,
    carried,
    hidden: sum("hidden"),
    coverage: expected === 0 ? 1 : carried / expected,
  };
}
