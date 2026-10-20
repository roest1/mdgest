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
 *  clause number or a line of prose that starts with a digit. */
const PAGE_NUMBER = new RegExp(
  "^[\\s\\-–—|·.]*" +
    "(?:page\\s+|p\\.\\s*)?" +
    `(\\d{1,4}|${ROMAN})` +
    `(?:\\s*(?:of|/)\\s*(?:\\d{1,4}|${ROMAN}))?` +
    "[\\s\\-–—|·.]*$",
  "i",
);

/** The page number `text` prints -- `12`, `iv` -- or null if it prints
 *  something else. Position is not checked here: see `pageNumberOf`. */
export function label(text: string): string | null {
  const match = PAGE_NUMBER.exec(text.trim());
  return match ? match[1].toLowerCase() : null;
}

/** The page number `block` prints, when it is a text block in a margin band
 *  of `page` printing nothing else; null otherwise. */
export function pageNumberOf(block: Block, page: Page): string | null {
  if (block.kind !== "text" || !inMargin(block, page)) return null;
  return label(printed(block));
}

// ---- headers and footers --------------------------------------------------

/** A line's wording with its numbers wildcarded, so `Page 3 of 40` and
 *  `Chapter 2 — Methods` match their own kind on every page. Case and
 *  spacing do not count. Empty for a line with no letters, which says
 *  too little to be matched on. */
export function wording(text: string): string {
  const key = text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  return /\p{L}/u.test(key) ? key : "";
}

/** A wording counts as a running header or footer when it is printed in a
 *  margin band on at least this many pages... */
export const MIN_PAGES = 2;
/** ...and on at least this share of all the pages it is printed on. Below
 *  it, the wording is mostly body text that sometimes lands in a margin. */
export const MARGIN_SHARE = 0.5;

/** The ids of every block that is a repeated header or footer: text in a
 *  margin band whose wording is printed in a margin on `MIN_PAGES` pages or
 *  more. A page number is not one -- it has its own setting -- and a block
 *  in the body never is. */
export function headersFooters(analysis: Analysis): Set<string> {
  const margin = new Map<string, { pages: Set<number>; ids: string[] }>();
  const anywhere = new Map<string, Set<number>>();
  for (const page of analysis.pages) {
    for (const block of page.blocks) {
      if (block.kind !== "text") continue;
      const key = wording(printed(block));
      if (!key) continue;
      if (!anywhere.has(key)) anywhere.set(key, new Set());
      anywhere.get(key)!.add(page.n);
      if (!inMargin(block, page) || pageNumberOf(block, page) !== null) continue;
      if (!margin.has(key)) margin.set(key, { pages: new Set(), ids: [] });
      const seen = margin.get(key)!;
      seen.pages.add(page.n);
      seen.ids.push(block.id);
    }
  }
  const out = new Set<string>();
  for (const [key, { pages, ids }] of margin) {
    const all = anywhere.get(key)!.size;
    if (pages.size >= MIN_PAGES && pages.size / all >= MARGIN_SHARE) for (const id of ids) out.add(id);
  }
  return out;
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
  for (const page of analysis.pages) {
    for (const block of page.blocks) {
      const n = pageNumberOf(block, page);
      if (n !== null) {
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
  return { page_numbers: found.page_numbers.count, headers_footers: found.headers_footers.count };
}
