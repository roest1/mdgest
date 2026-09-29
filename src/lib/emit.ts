/** From an analysis to markdown, and to where in the markdown each block
 *  went.
 *
 * Pure, and shared: the worker calls it to write `markdown/<doc>.md`, and
 * the page calls it to know which source lines a block became, so the
 * numbered boxes on the page and the numbered lines beside them are one
 * list by construction. Nothing here reads edits yet -- when it does, it
 * will resolve them into the block list first and emit the result the same
 * way. */

import { LIST_ROLES, type Analysis, type Block, type Page } from "./analysis";

/** A block as it was written: which page, its number on that page (the
 *  note on its box), and the source lines it became, 1-based inclusive. */
export interface Placed {
  id: string;
  page: number;
  n: number;
  from: number;
  to: number;
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
  /** Every block that was written, in document order -- what a shift-click
   *  ranges over. */
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

function inline(block: Block): string {
  let text = block.text.trim();
  if (!text) return text;
  text = escapeText(text);
  if (block.role === "heading") return text;
  if (block.bold) text = `**${text}**`;
  if (block.italic) text = `*${text}*`;
  return text;
}

/** The markdown for a whole document. `assets` is the path the figures are
 *  written under, relative to the markdown file: `<doc>.assets/`. */
export function emit(analysis: Analysis, assets: string): Markdown {
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

  const emitPage = (page: Page) => {
    const counters = new Counters();
    let n = 0;
    let inList = false;
    for (const block of page.blocks) {
      const item = counters.itemFor(block);
      // Each block is one line of the source; `at` is that line.
      let at: number;
      if (block.kind === "image") {
        const pic = page.pictures[block.picture];
        if (!pic) continue;
        blank(page.n);
        at = put(
          `![page ${page.n} figure ${block.picture + 1}](${assets}${pic.path})`,
          block.id,
          page.n,
        );
        put("", null, page.n);
        inList = false;
      } else {
        const text = inline(block);
        if (!text) continue;
        if (block.role === "heading") {
          blank(page.n);
          at = put(
            `${"#".repeat(Math.max(1, Math.min(6, block.level || 2)))} ${text}`,
            block.id,
            page.n,
          );
          put("", null, page.n);
          inList = false;
        } else if (item) {
          if (!inList) blank(page.n);
          at = put(`${item.indent}${item.marker} ${text}`, block.id, page.n);
          inList = true;
        } else {
          blank(page.n);
          at = put(text, block.id, page.n);
          put("", null, page.n);
          inList = false;
        }
      }
      n += 1;
      blocks[block.id] = { id: block.id, page: page.n, n, from: at, to: at };
      order.push(block.id);
    }
  };

  analysis.pages.forEach((page, i) => {
    if (i > 0) {
      blank(page.n - 1);
      put("---", null, page.n);
      put("", null, page.n);
    }
    emitPage(page);
  });

  while (lines.length && last().text === "") lines.pop();
  return { text: `${lines.map((l) => l.text).join("\n")}\n`, lines, blocks, order };
}
