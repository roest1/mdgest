/** From an analysis to markdown, and to where in the markdown each block
 *  went.
 *
 * Pure, and shared: the worker calls it to write `markdown/<doc>.md`, and
 * the page calls it to know which source lines a block became, so the
 * numbered boxes on the page and the numbered lines beside them are one
 * list by construction. A person's edits are laid over each block first
 * (`shape`), and the result is written the same way. */

import { LIST_ROLES, type Analysis, type Block, type Page } from "./analysis";
import { shape, type Edits } from "./edits";
import { headersFooters, pageNumberOf, type Furniture } from "./furniture";

/** A block as it was written: which page, its number on that page (the
 *  note on its box), and the source line it became, 1-based. `from` and
 *  `to` are one line today; a range, so a block written over several can
 *  say so without another field.
 *
 * A hidden block is written as a comment, so it keeps its number and its
 * line. A deleted one became no lines and has no number: its `n`, `from`
 * and `to` are 0, and the blocks after it on the page count on without
 * it. */
export interface Placed {
  id: string;
  page: number;
  n: number;
  from: number;
  to: number;
  hidden: boolean;
  deleted: boolean;
  /** Hidden or deleted by the document's furniture setting, not by hand. */
  furniture?: Furniture;
}

/** One line of the markdown source, and the block it came from -- null for
 *  the blank lines and page rules between blocks. */
export interface SourceLine {
  text: string;
  block: string | null;
  page: number;
}

export interface Markdown {
  text: string;
  lines: SourceLine[];
  blocks: Record<string, Placed>;
  /** Every block placed, in document order: the ones written, and the
   *  deleted ones where they would have been -- what a shift-click will
   *  range over. A block with no words is written nowhere and is in
   *  neither. */
  order: string[];
}

/** The list markers, counted, and the column each item starts in: a
 *  paragraph resets the numbering, and coming back up a level resets the
 *  deeper ones.
 *
 * Every ordered marker is decimal, whatever style the page printed --
 * CommonMark reads only digits as ordered lists, so `a.` or `iii.` would
 * be a paragraph -- and the pane's nested-list styles letter and numeral
 * the levels back. A nested item starts in the column its parent's text
 * did, which is what makes it nested at all: a fixed two spaces is not
 * enough under `1. `. */
class Counters {
  private counts = new Map<string, number>();
  /** `cols[d]`: the column depth `d`'s markers go in. Grown one level at
   *  a time, so an item deeper than any list yet open joins the deepest
   *  one there is. */
  private cols: number[] = [0];

  /** How `block` is written -- its marker and the indent before it -- or
   *  null for a block that is not a list item, which also ends the list. */
  itemFor(block: Block): { marker: string; indent: string } | null {
    if (!LIST_ROLES.includes(block.role)) {
      this.counts.clear();
      this.cols = [0];
      return null;
    }
    const depth = Math.min(Math.max(0, block.depth), this.cols.length - 1);
    for (const key of [...this.counts.keys()]) {
      if (Number(key.split(":")[1]) > depth) this.counts.delete(key);
    }
    let marker = "-";
    if (block.role !== "bullet") {
      const key = `${block.role}:${depth}`;
      const k = (this.counts.get(key) ?? 0) + 1;
      this.counts.set(key, k);
      marker = `${k}.`;
    }
    const col = this.cols[depth];
    this.cols = [...this.cols.slice(0, depth + 1), col + marker.length + 1];
    return { marker, indent: " ".repeat(col) };
  }
}

/** The text with the characters that would read as markup escaped: what
 *  the page printed is what the pane should show, so a paragraph of `---`
 *  or `2024.` stays those characters rather than becoming a rule or a
 *  list. Inline punctuation is escaped everywhere; `#`, `>`, `-`, `+` and
 *  a number's dot only where they open the line and would open a block. */
function escapeText(text: string): string {
  return text
    .replace(/[\\`*_[\]<&~]/g, "\\$&")
    .replace(/^([#>+-])/, "\\$1")
    .replace(/^(\d{1,9})([.)])/, "$1\\$2");
}

/** A URL as a markdown destination: the characters that would end or
 *  confuse the `(...)` -- spaces, parens, angle brackets, a backslash --
 *  percent-encoded, which every browser reads back. By code, because
 *  `encodeURIComponent` leaves parentheses as they are. */
function linkTarget(url: string): string {
  return url.replace(
    /[\s<>()\\]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

/** A text block's words as markdown: escaped, linked, and emphasized where
 *  the whole block is -- except a heading, whose level is its emphasis. */
function inline(block: Block): string {
  let text = block.text.trim();
  if (!text) return text;
  text = escapeText(text);
  // A heading's own words ending in ` #` would read as the `#`s that may
  // close one, and be dropped.
  if (block.role === "heading") text = text.replace(/(\s)(#+)$/, "$1\\$2");
  if (block.href) text = `[${text}](${linkTarget(block.href)})`;
  if (block.role === "heading") return text;
  if (block.bold) text = `**${text}**`;
  if (block.italic) text = `*${text}*`;
  return text;
}

/** A heading's line: its level in `#`s, two where the reader gave none. */
function heading(block: Block, text: string): string {
  return `${"#".repeat(Math.max(1, Math.min(6, block.level || 2)))} ${text}`;
}

/** `text` as an HTML comment: there in the markdown's source, gone from
 *  any rendered view. `-->` inside it would end the comment early and let
 *  the rest render, so it is broken up. */
function comment(text: string): string {
  return `<!-- ${text.replaceAll("-->", "-- >")} -->`;
}

/** The markdown for a whole document, with `edits` made to it. `assets` is
 *  the path the figures are written under, relative to the markdown file:
 *  `<doc>.assets/`. Of the edits, what each block is overridden to, and
 *  the furniture settings, are written; the joins, cuts and inserted text
 *  an `Edits` can hold are not yet. */
export function emit(
  analysis: Analysis,
  assets: string,
  edits?: Edits,
): Markdown {
  const lines: SourceLine[] = [];
  const blocks: Record<string, Placed> = {};
  const order: string[] = [];

  const last = () => lines[lines.length - 1];
  /** Returns the 1-based line the text landed on. */
  const put = (text: string, block: string | null, page: number): number => {
    lines.push({ text, block, page });
    return lines.length;
  };
  const blank = (page: number) => {
    if (lines.length && last().text !== "") put("", null, page);
  };
  /** The `---` between two pages, set off by blank lines so it reads as a
   *  rule and not as the underline of the line above. The blank before it
   *  closes the page before and is that page's; the rule and the blank
   *  after it are the page's the rule opens. */
  const rule = (page: number) => {
    blank(last()?.page ?? page);
    if (lines.length === 0) return;
    put("---", null, page);
    put("", null, page);
  };

  const pageNumbers = edits?.page_numbers ?? "keep";
  const headers = edits?.headers_footers ?? "keep";
  // Found once per document, and only when it is asked for: it looks at
  // every page to know what repeats.
  const repeated =
    headers === "keep" ? new Set<string>() : headersFooters(analysis);

  const emitPage = (page: Page) => {
    const counters = new Counters();
    let n = 0;
    let inList = false;
    /** How far the last list item's text is indented: where a comment
     *  inside the list starts. */
    let listIndent = "";
    /** An image block as a markdown image, or null when its picture was
     *  not kept. */
    const figure = (block: Block): string | null => {
      const pic = page.pictures[block.picture];
      return pic
        ? `![page ${page.n} figure ${block.picture + 1}](${linkTarget(assets + pic.path)})`
        : null;
    };
    for (const raw of page.blocks) {
      const block = shape(raw, edits?.blocks[raw.id]);
      // Page furniture takes the document's setting, unless the block was
      // hidden or deleted by hand -- that decision stands. Looked for only
      // under a setting that is not `keep`, so a block the setting names
      // is one the setting hides or deletes.
      const byHand = block.hidden || block.deleted;
      const printed =
        !byHand && pageNumbers !== "keep" ? pageNumberOf(raw, page) : null;
      const setting: Furniture | undefined =
        printed !== null
          ? "page_numbers"
          : !byHand && repeated.has(raw.id)
            ? "headers_footers"
            : undefined;
      if (setting !== undefined) {
        const choice = setting === "page_numbers" ? pageNumbers : headers;
        if (choice === "delete") block.deleted = true;
        else block.hidden = true;
      }
      const by = setting === undefined ? {} : { furniture: setting };
      if (block.deleted) {
        blocks[block.id] = {
          id: block.id,
          page: page.n,
          n: 0,
          from: 0,
          to: 0,
          hidden: false,
          deleted: true,
          ...by,
        };
        order.push(block.id);
        continue;
      }
      if (block.hidden) {
        // The line it would be, commented out: markup and all, so reading
        // it back is reading any line. A list item takes its kind's first
        // marker, since a comment is not counted in the list. A page
        // number hidden by the setting is the number it prints.
        const words = block.kind === "image" ? figure(block) : inline(block);
        if (!words) continue;
        const said =
          printed !== null
            ? `page ${printed}`
            : block.kind === "image"
              ? words
              : block.role === "heading"
                ? heading(block, words)
                : block.role === "bullet"
                  ? `- ${words}`
                  : LIST_ROLES.includes(block.role)
                    ? `1. ${words}`
                    : words;
        // Inside a list the comment is indented into the item before it,
        // so the list goes on past it rather than ending there.
        let at: number;
        if (inList) {
          at = put(`${listIndent}${comment(said)}`, block.id, page.n);
        } else {
          blank(page.n);
          at = put(comment(said), block.id, page.n);
          put("", null, page.n);
        }
        n += 1;
        blocks[block.id] = {
          id: block.id,
          page: page.n,
          n,
          from: at,
          to: at,
          hidden: true,
          deleted: false,
          ...by,
        };
        order.push(block.id);
        continue;
      }
      const item = counters.itemFor(block);
      // Each block is one line of the source; `at` is that line.
      let at: number;
      if (block.kind === "image") {
        const pic = figure(block);
        if (pic === null) continue;
        blank(page.n);
        at = put(pic, block.id, page.n);
        put("", null, page.n);
        inList = false;
      } else {
        const text = inline(block);
        if (!text) continue;
        if (block.role === "heading") {
          blank(page.n);
          at = put(heading(block, text), block.id, page.n);
          put("", null, page.n);
          inList = false;
        } else if (item) {
          if (!inList) blank(page.n);
          at = put(`${item.indent}${item.marker} ${text}`, block.id, page.n);
          listIndent = " ".repeat(item.indent.length + item.marker.length + 1);
          inList = true;
        } else {
          blank(page.n);
          at = put(text, block.id, page.n);
          put("", null, page.n);
          inList = false;
        }
      }
      n += 1;
      blocks[block.id] = {
        id: block.id,
        page: page.n,
        n,
        from: at,
        to: at,
        hidden: false,
        deleted: false,
      };
      order.push(block.id);
    }
  };

  analysis.pages.forEach((page, i) => {
    if (i > 0) rule(page.n);
    emitPage(page);
  });

  while (lines.length && last().text === "") lines.pop();
  return {
    text: `${lines.map((l) => l.text).join("\n")}\n`,
    lines,
    blocks,
    order,
  };
}
