/** From an analysis to markdown, and to where in the markdown each block
 *  went.
 *
 * Pure, and shared: the worker calls it to write `markdown/<doc>.md`, and
 * the page calls it to know which source lines a block became, so the
 * numbered boxes on the page and the numbered lines beside them are one
 * list by construction. A person's edits are laid over each block first
 * (`shape`), and the result is written the same way. */

import { blocksById, LIST_ROLES, type Analysis, type Block, type Page } from "./analysis";
import { shape, type Edits, type Shaped } from "./edits";

/** A block as it was written: which page, its number on that page (the
 *  note on its box), and the source lines it became, 1-based inclusive.
 *  A hidden block keeps its number, so hiding one renumbers nothing, and
 *  became no lines: its `from` and `to` are 0. A block joined onto another
 *  is placed where that one is, with its number and lines, and `joined`
 *  names it. */
export interface Placed {
  id: string;
  page: number;
  n: number;
  from: number;
  to: number;
  hidden: boolean;
  joined?: string;
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

function inline(block: Shaped): string {
  let text = block.text.trim();
  if (!text) return text;
  text = escapeText(text);
  if (block.role === "heading") return text;
  if (block.bold) text = `**${text}**`;
  if (block.italic) text = `*${text}*`;
  return text;
}

/** The markdown for a whole document, with `edits` made to it. `assets` is
 *  the path the figures are written under, relative to the markdown file:
 *  `<doc>.assets/`. */
export function emit(analysis: Analysis, assets: string, edits?: Edits): Markdown {
  const lines: SourceLine[] = [];
  const blocks: Record<string, Placed> = {};
  const order: string[] = [];

  /** The lines a quoted block wrote, 1-based: where `> ` opens them, and
   *  what decides which blank lines between them carry a `>` too. */
  const quoted = new Set<number>();

  // The joins, resolved: each child to the head of its group, and each
  // head to its children in document order. Text onto text only; a
  // chain a spike file may hold is followed to its end, and a loop is no
  // join at all.
  const byId = blocksById(analysis);
  const headOf = (id: string): string => {
    const seen = new Set<string>();
    let at = id;
    for (;;) {
      const parent = edits?.joins[at];
      if (!parent) return at;
      if (seen.has(parent) || parent === id) return id;
      if (byId.get(parent)?.kind !== "text" || byId.get(at)?.kind !== "text") return at;
      seen.add(at);
      at = parent;
    }
  };
  const children = new Map<string, Block[]>();
  const joined = new Map<string, string>();
  for (const page of analysis.pages) {
    for (const b of page.blocks) {
      const head = headOf(b.id);
      if (head === b.id) continue;
      joined.set(b.id, head);
      children.set(head, [...(children.get(head) ?? []), b]);
    }
  }

  const last = () => lines[lines.length - 1];
  /** Returns the 1-based line the text landed on. */
  const put = (text: string, block: string | null, page: number): number => {
    lines.push({ text, block, page });
    return lines.length;
  };
  const blank = (page: number) => {
    if (lines.length && last().text !== "") put("", null, page);
  };
  /** A `---`, set off by blank lines so it reads as a rule and not as the
   *  underline of the line above. One rule where two would meet -- a break
   *  after one block and before the next, or beside the rule between
   *  pages. */
  const rule = (page: number) => {
    blank(page);
    const before = lines[lines.length - 2];
    if (lines.length === 0 || before?.text === "---") return;
    put("---", null, page);
    put("", null, page);
  };

  const emitPage = (page: Page) => {
    let counters = new Counters();
    let n = 0;
    let inList = false;
    /** Whether the last block written was quoted. */
    let inQuote = false;
    /** A rule ends any list it falls in, and the next one counts from 1. */
    const breakHere = () => {
      rule(page.n);
      counters = new Counters();
      inList = false;
    };
    for (const raw of page.blocks) {
      if (joined.has(raw.id)) continue;
      const kids = children.get(raw.id);
      const block = shape(
        kids ? { ...raw, text: [raw.text, ...kids.map((k) => k.text)].join(" ") } : raw,
        edits?.blocks[raw.id],
      );
      if (block.hidden) {
        n += 1;
        blocks[block.id] = { id: block.id, page: page.n, n, from: 0, to: 0, hidden: true };
        order.push(block.id);
        continue;
      }
      if (block.breakBefore) breakHere();
      // A list that goes into a quote or comes out of one is two lists:
      // the `>` cannot open or close partway through one.
      if (inList && LIST_ROLES.includes(block.role) && block.quote !== inQuote) {
        counters = new Counters();
        inList = false;
      }
      const item = counters.itemFor(block);
      const q = block.quote ? "> " : "";
      // Each block is one line of the source; `at` is that line.
      let at: number;
      if (block.kind === "image") {
        const pic = page.pictures[block.picture];
        if (!pic) continue;
        blank(page.n);
        at = put(
          `${q}![page ${page.n} figure ${block.picture + 1}](${assets}${pic.path})`,
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
            `${q}${"#".repeat(Math.max(1, Math.min(6, block.level || 2)))} ${text}`,
            block.id,
            page.n,
          );
          put("", null, page.n);
          inList = false;
        } else if (item) {
          if (!inList) blank(page.n);
          at = put(`${q}${item.indent}${item.marker} ${text}`, block.id, page.n);
          inList = true;
        } else {
          blank(page.n);
          at = put(`${q}${text}`, block.id, page.n);
          put("", null, page.n);
          inList = false;
        }
      }
      if (block.quote) quoted.add(at);
      inQuote = block.quote;
      n += 1;
      blocks[block.id] = { id: block.id, page: page.n, n, from: at, to: at, hidden: false };
      order.push(block.id);
      if (block.breakAfter) breakHere();
    }
  };

  analysis.pages.forEach((page, i) => {
    if (i > 0) rule(page.n);
    emitPage(page);
  });

  // A child is wherever its head went -- or nowhere, with a head that
  // wrote nothing.
  for (const [id, head] of joined) {
    const at = blocks[head];
    if (at) blocks[id] = { ...at, id, page: byId.get(id)!.page, joined: head };
  }

  // Quoted blocks next to each other are one quote: the blank lines
  // between them are written `>`, since a blank line would end it. A rule
  // or an unquoted block between them ends it all the same.
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].text !== "" || !quoted.has(i)) continue;
    let j = i;
    while (j < lines.length && lines[j].text === "") j++;
    if (quoted.has(j + 1)) for (let k = i; k < j; k++) lines[k].text = ">";
    i = j - 1;
  }

  while (lines.length && last().text === "") lines.pop();
  return { text: `${lines.map((l) => l.text).join("\n")}\n`, lines, blocks, order };
}
