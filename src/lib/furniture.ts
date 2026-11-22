/** Page furniture: what a page prints in its top and bottom margins that is
 *  not the document -- printed page numbers, and headers and footers
 *  repeated from page to page -- and what a document wants done with each.
 *
 * Each kind is a setting, not a behavior: keep it as text, hide it as an
 * HTML comment, or delete it. Both are found when the markdown is written,
 * so no block moves and the reader is untouched.
 *
 * Position decides before wording. A bare `4` is a page number in a margin
 * and a list item in the body; a line repeated on eight slides is a running
 * header in a margin and a section title in the body. So only the margin
 * bands are looked at, and what sits in the body is never furniture.
 *
 * Pure, and shared like emit.ts. */

import type { Analysis, Block, Page } from "./analysis";

/** What a document does with one kind of furniture. */
export type Choice = "keep" | "hide" | "delete";

export const CHOICES: readonly Choice[] = ["keep", "hide", "delete"];

/** The kinds, as `edits.json` names their settings. */
export const FURNITURE = ["page_numbers", "headers_footers"] as const;
export type Furniture = (typeof FURNITURE)[number];

/** Share of the page's height, from the top and from the bottom, that
 *  furniture may sit in. */
export const MARGIN_FRACTION = 0.12;

/** `f` of an analysis, worked out once for each: emit asks on every edit,
 *  and a book's repeated lines took 190ms of the 390ms an edit to it took
 *  to emit. An analysis is not changed once made -- `structure.ts` builds
 *  it, and edits are kept beside it -- so what is found in it holds for as
 *  long as it is there, and goes with it. Read-only, being shared. */
function once<T>(f: (analysis: Analysis) => T): (analysis: Analysis) => T {
  const known = new WeakMap<Analysis, T>();
  return (analysis) => {
    if (!known.has(analysis)) known.set(analysis, f(analysis));
    return known.get(analysis)!;
  };
}

/** Whether `block` sits wholly in the top or bottom band of `page`. */
export function inMargin(block: Block, page: Page): boolean {
  const band = page.height * MARGIN_FRACTION;
  return block.box.y + block.box.h <= band || block.box.y >= page.height - band;
}

/** What a page prints, as it prints it: a list marker the reader took off
 *  the front (`4.` read as a list item) is put back. */
function printed(block: Block): string {
  return block.marker ? `${block.marker} ${block.text}` : block.text;
}

// ---- page numbers ---------------------------------------------------------

/** A roman numeral, properly formed, and under 90 -- `i` to `lxxxix`,
 *  which is the range front matter is numbered in.
 *
 * Properly formed is not enough on its own. The tempting `[ivxlcdm]+`
 *  matches ordinary words -- `civil`, `mill`, `did` -- and even a correct
 *  numeral of the full range matches `MIX`, `DIV`, `CIV`, `MI` and `D.`,
 *  which is how a margin line of real text becomes a page number and,
 *  with the setting at `delete`, disappears. Those are 1009, 504, 104,
 *  1001 and 500: numbers no page bears. Leaving out the hundreds and
 *  thousands leaves the letters that spell no word, and costs only the
 *  front matter that runs past page lxxxix.
 *
 * A letter standing alone is still a numeral: `i`, `v`, `x` and `l` read
 *  as 1, 5, 10 and 50, so an initial in a margin -- `V.` in a running
 *  head, `I` under a plate -- is still taken for a page number. Asking
 *  for two numerals would rule those out and lose pages `i`, `v`, `x`
 *  and `l` with them, which are page numbers a front matter page prints.
 *  Position is what keeps the rest of such a line: the band test, and
 *  for a header or footer the count across pages. */
const ROMAN = "(?=[ivxl])(?:xl|l?x{0,3})(?:ix|iv|v?i{0,3})";

/** What a page prints where a page number goes. Bounded on purpose: enough
 *  for `12`, `iv`, `Page 12`, `12 of 40`, `- 12 -`, and not enough for a
 *  clause number or a line of prose that starts with a digit. The groups
 *  are the word before (`Page`, `p.`), the number, and the count after
 *  (`of 40`, `/ 40`). */
const PAGE_NUMBER = new RegExp(
  "^[\\s\\-–—|·.]*" +
    "(page\\s+|p\\.\\s*)?" +
    `(\\d{1,4}|${ROMAN})` +
    `(\\s*(?:of|/)\\s*(?:\\d{1,4}|${ROMAN}))?` +
    "[\\s\\-–—|·.]*$",
  "i",
);

/** The page number `text` prints -- `12`, `iv` -- or null if it prints
 *  something else. Neither position nor sequence is checked here: see
 *  `pageNumberIds`. */
export function label(text: string): string | null {
  const match = PAGE_NUMBER.exec(text.trim());
  return match ? match[2].toLowerCase() : null;
}

/** What a roman label counts: `xiv` is 14. Only ever given a label
 *  `ROMAN` matched, so it is well formed. */
function romanValue(roman: string): number {
  const digit: Record<string, number> = { i: 1, v: 5, x: 10, l: 50 };
  let total = 0;
  for (let k = 0; k < roman.length; k++) {
    const here = digit[roman[k]];
    const next = digit[roman[k + 1]] ?? 0;
    total += here < next ? -here : here;
  }
  return total;
}

/** A margin line that prints a page number's form, before the document
 *  around it is asked whether it is one. */
interface Candidate {
  id: string;
  page: number;
  label: string;
  /** Roman and arabic numbers are separate runs: front matter's `iii`
   *  and the body's `3` are never one sequence. */
  roman: boolean;
  value: number;
  /** The line says it is a page number in words -- `Page 12`, `p. 7`,
   *  `12 of 40` -- not only by printing a number. */
  says: boolean;
}

function candidates(analysis: Analysis): Candidate[] {
  const out: Candidate[] = [];
  for (const page of analysis.pages) {
    for (const block of page.blocks) {
      if (block.kind !== "text" || !inMargin(block, page)) continue;
      const match = PAGE_NUMBER.exec(printed(block).trim());
      if (!match) continue;
      const label = match[2].toLowerCase();
      const roman = !/^\d/.test(label);
      out.push({
        id: block.id,
        page: page.n,
        label,
        roman,
        value: roman ? romanValue(label) : Number(label),
        says: match[1] !== undefined || match[3] !== undefined,
      });
    }
  }
  return out;
}

/** The page number each block of `analysis` prints, by block id, for the
 *  text blocks in a margin band that print one and nothing else.
 *
 * A number's form is not enough: a footer that prints only the year,
 *  `2024`, has the form of page 2024. What a page number has that a year
 *  or a fixed code does not is a sequence -- it counts up with the pages.
 *  So a number is a page number when another page's number keeps the
 *  same distance from its own page: printed number minus page index is
 *  one offset along a run. That takes in pages with no number (a blank
 *  page, a chapter opener), front matter in roman and the body from 1
 *  again in arabic (two runs, two offsets), and a book's middle cut out
 *  as a PDF of its own (`Page 213` on page 1). A year printed on every
 *  page stands at a new offset on each and is never in a run.
 *
 * A number with no run -- a one-page document, or the one number in a
 *  margin -- has nothing to count against, so it must say what it is by
 *  itself: in words (`Page 3`, `3 of 12`), or by being the page's own
 *  index (`1` on page 1). A lone `2024` stays text, which keeps a
 *  setting of `delete` from taking out what the page meant to say. */
export const pageNumberIds = once(function pageNumberIds(
  analysis: Analysis,
): ReadonlyMap<string, string> {
  const found = candidates(analysis);
  const runs = new Map<string, Set<number>>();
  const run = (c: Candidate) => `${c.roman ? "r" : "a"}${c.value - c.page}`;
  for (const c of found) {
    if (!runs.has(run(c))) runs.set(run(c), new Set());
    runs.get(run(c))!.add(c.page);
  }
  const out = new Map<string, string>();
  for (const c of found)
    if (runs.get(run(c))!.size >= 2 || c.says || c.value === c.page)
      out.set(c.id, c.label);
  return out;
});

// ---- headers and footers --------------------------------------------------

/** A line's wording with its numbers wildcarded, so `Page 3 of 40` and
 *  `Chapter 2 — Methods` match their own kind on every page. Case and
 *  spacing do not count. Empty for a line with no letters, which says
 *  too little to be matched on. */
export function wording(text: string): string {
  const key = text
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
  return /\p{L}/u.test(key) ? key : "";
}

/** A wording counts as a running header or footer when it is printed in a
 *  margin band on at least this many pages... */
export const MIN_PAGES = 2;
/** ...and on at least this share of all the pages it is printed on. Below
 *  it, the wording is mostly body text that sometimes lands in a margin. */
export const MARGIN_SHARE = 0.5;

/** One running header or footer: a wording printed in a margin band on
 *  `MIN_PAGES` pages or more, numbers wildcarded, so `Page 3 of 40` on
 *  every page is one line. `key` is the wording, which is what a choice
 *  for the line is kept under (`Edits.repeated_lines`); `text` is how the
 *  first of them is printed; `where` is the band most of them are in. */
export interface RepeatedLine {
  key: string;
  text: string;
  where: "top" | "bottom";
  pages: number[];
  ids: string[];
}

/** Every repeated header and footer of `analysis`, in the order each is
 *  first printed. A page number is not one -- it has its own setting --
 *  and a block in the body never is. */
export const repeatedLines = once(function repeatedLines(
  analysis: Analysis,
): readonly RepeatedLine[] {
  const margin = new Map<
    string,
    { text: string; pages: Set<number>; ids: string[]; top: number }
  >();
  const anywhere = new Map<string, Set<number>>();
  const numbers = pageNumberIds(analysis);
  for (const page of analysis.pages) {
    for (const block of page.blocks) {
      if (block.kind !== "text") continue;
      const key = wording(printed(block));
      if (!key) continue;
      if (!anywhere.has(key)) anywhere.set(key, new Set());
      anywhere.get(key)!.add(page.n);
      if (!inMargin(block, page) || numbers.has(block.id)) continue;
      if (!margin.has(key))
        margin.set(key, {
          text: printed(block).trim(),
          pages: new Set(),
          ids: [],
          top: 0,
        });
      const seen = margin.get(key)!;
      seen.pages.add(page.n);
      seen.ids.push(block.id);
      if (block.box.y < page.height / 2) seen.top++;
    }
  }
  const out: RepeatedLine[] = [];
  for (const [key, { text, pages, ids, top }] of margin) {
    const all = anywhere.get(key)!.size;
    if (pages.size >= MIN_PAGES && pages.size / all >= MARGIN_SHARE)
      out.push({
        key,
        text,
        where: top * 2 >= ids.length ? "top" : "bottom",
        pages: [...pages],
        ids,
      });
  }
  return out;
});

/** The ids of every block that is a repeated header or footer. */
export function headersFooters(analysis: Analysis): Set<string> {
  return new Set(repeatedLines(analysis).flatMap((line) => line.ids));
}

/** The wording each repeated header or footer block is kept under. */
export const repeatedKeys = once(function repeatedKeys(
  analysis: Analysis,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const line of repeatedLines(analysis))
    for (const id of line.ids) out.set(id, line.key);
  return out;
});

/** The printed page numbers of `analysis`, in page order: what each says,
 *  the page it is on, and the band most of them are in. */
export function pageNumbers(analysis: Analysis): {
  labels: string[];
  pages: number[];
  where: "top" | "bottom";
} {
  const labels: string[] = [];
  const pages: number[] = [];
  let top = 0;
  const numbers = pageNumberIds(analysis);
  for (const page of analysis.pages) {
    for (const block of page.blocks) {
      const n = numbers.get(block.id);
      if (n === undefined) continue;
      labels.push(n);
      pages.push(page.n);
      if (block.box.y < page.height / 2) top++;
    }
  }
  return { labels, pages, where: top * 2 > labels.length ? "top" : "bottom" };
}

// ---- what is found --------------------------------------------------------

/** One kind of furniture in a document: how many blocks it would act on,
 *  and the first of them as an example -- `text` as the page prints it,
 *  `hidden` as its comment would read. Null `sample` when there is none. */
export interface Found {
  count: number;
  sample: { text: string; hidden: string } | null;
}

/** What `analysis` has of each kind of furniture. */
export function findFurniture(analysis: Analysis): Record<Furniture, Found> {
  const numbers: Found = { count: 0, sample: null };
  const repeated = headersFooters(analysis);
  const heads: Found = { count: repeated.size, sample: null };
  const pageNumbered = pageNumberIds(analysis);
  for (const page of analysis.pages) {
    for (const block of page.blocks) {
      const n = pageNumbered.get(block.id);
      if (n !== undefined) {
        numbers.count++;
        numbers.sample ??= { text: printed(block).trim(), hidden: `page ${n}` };
      } else if (repeated.has(block.id) && !heads.sample) {
        const text = block.text.trim();
        heads.sample = { text, hidden: text };
      }
    }
  }
  return { page_numbers: numbers, headers_footers: heads };
}

/** How many blocks of `analysis` each kind of furniture would act on. */
export function countFurniture(analysis: Analysis): Record<Furniture, number> {
  const found = findFurniture(analysis);
  return {
    page_numbers: found.page_numbers.count,
    headers_footers: found.headers_footers.count,
  };
}
