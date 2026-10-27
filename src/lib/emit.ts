/** From an analysis to markdown, and to where in the markdown each block
 *  went.
 *
 * Pure, and shared: the worker calls it to write `markdown/<doc>.md`, and
 * the page calls it to know which source lines a block became, so the
 * numbered boxes on the page and the numbered lines beside them are one
 * list by construction. A person's edits are laid over each block first
 * (`shape`), and the result is written the same way. */

import {
  blocksById,
  LIST_ROLES,
  type Analysis,
  type Block,
  type Page,
} from "./analysis";
import { divided } from "./divide";
import { shape, type Edits, type Insert, type Shaped } from "./edits";
import { headersFooters, pageNumberOf, type Choice } from "./furniture";

/** A block as it was written: which page, its number on that page (the
 *  note on its box), and the source lines it became, 1-based inclusive.
 *  A hidden block is written as a comment, so it keeps its number and its
 *  line. A deleted one became no lines and has no number: its `n`, `from`
 *  and `to` are 0, and the blocks after it on the page count on without
 *  it. A block joined onto another is placed where that one is, with its
 *  number and lines, and `joined` names it. */
export interface Placed {
  id: string;
  page: number;
  n: number;
  from: number;
  to: number;
  hidden: boolean;
  deleted: boolean;
  /** Its words are a person's correction, not the page's. */
  corrected?: boolean;
  /** Text a person inserted, not a block of the page: it has no number. */
  inserted?: boolean;
  /** Hidden or deleted by the document's furniture setting, not by hand. */
  furniture?: "page_numbers" | "headers_footers";
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

function inline(block: Shaped): string {
  let text = block.text.trim();
  if (!text) return text;
  text = escapeText(text);
  if (block.href) text = `[${text}](${linkTarget(block.href)})`;
  if (block.role === "heading") return text;
  if (block.bold) text = `**${text}**`;
  if (block.italic) text = `*${text}*`;
  return text;
}

/** `text` as an HTML comment: there in the markdown's source, gone from
 *  any rendered view. `-->` inside it would end the comment early and let
 *  the rest render, so it is broken up. */
function comment(text: string): string {
  return `<!-- ${text.replaceAll("-->", "-- >")} -->`;
}

/** The markdown for a whole document, with `edits` made to it. `assets` is
 *  the path the figures are written under, relative to the markdown file:
 *  `<doc>.assets/`. A divided block is written as its pieces, each a block
 *  of its own from here on. */
export function emit(read: Analysis, assets: string, edits?: Edits): Markdown {
  const analysis = divided(read, edits?.cuts);
  const lines: SourceLine[] = [];
  const blocks: Record<string, Placed> = {};
  const order: string[] = [];

  /** The lines a quoted block wrote, 1-based: where `> ` opens them, and
   *  what decides which blank lines between them carry a `>` too. */
  const quoted = new Set<number>();

  // The joins, resolved: each child to the head of its group, and each
  // head to its children in document order. Text onto text only; a
  // chain a hand-edited manifest may hold is followed to its end, and a
  // loop is no join at all.
  const byId = blocksById(analysis);
  const headOf = (id: string): string => {
    const seen = new Set<string>();
    let at = id;
    for (;;) {
      const parent = edits?.joins[at];
      if (!parent) return at;
      if (seen.has(parent) || parent === id) return id;
      if (byId.get(parent)?.kind !== "text" || byId.get(at)?.kind !== "text")
        return at;
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
      const kids = children.get(head);
      if (kids) kids.push(b);
      else children.set(head, [b]);
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
   *  pages.
   *
   * The blank before a rule closes what came before it and is that page's;
   * the rule and the blank after it are the page's the rule opens. So a
   * `---` whose page is not the line's before it is the rule between two
   * pages, which draft.ts tells from a break inside one. A `---` a person
   * typed into inserted text is that text's line, not a rule: it is left
   * as written and the rule goes after it. */
  const rule = (page: number) => {
    blank(last()?.page ?? page);
    if (lines.length === 0) return;
    const before = lines[lines.length - 2];
    if (before?.text === "---" && before.block === null) {
      before.page = page;
      last().page = page;
      return;
    }
    put("---", null, page);
    put("", null, page);
  };

  /** Text a person inserted, written as it was typed, on `page`. */
  const putInsert = (ins: Insert, page: number) => {
    blank(page);
    const from = lines.length + 1;
    for (const text of ins.text.replace(/\s+$/, "").split("\n"))
      put(text, ins.id, page);
    blocks[ins.id] = {
      id: ins.id,
      page,
      n: 0,
      from,
      to: lines.length,
      hidden: false,
      deleted: false,
      inserted: true,
    };
    put("", null, page);
  };

  const pageNumbers = edits?.page_numbers ?? "keep";
  const headers = edits?.headers_footers ?? "keep";
  // Found once per document, and only when it is asked for: it looks at
  // every page to know what repeats.
  const repeated =
    headers === "keep" ? new Set<string>() : headersFooters(analysis);

  const emitPage = (page: Page) => {
    let counters = new Counters();
    let n = 0;
    let inList = false;
    /** How far the last list item's text is indented: where a comment
     *  inside the list starts. */
    let listIndent = "";
    /** Whether the last block written was quoted. */
    let inQuote = false;
    /** An image block as a markdown image, or null when its picture was
     *  not kept. */
    const figure = (block: Shaped): string | null => {
      const pic = page.pictures[block.picture];
      return pic
        ? `![page ${page.n} figure ${block.picture + 1}](${assets}${pic.path})`
        : null;
    };
    /** A rule ends any list it falls in, and the next one counts from 1. */
    const breakHere = () => {
      rule(page.n);
      counters = new Counters();
      inList = false;
    };
    /** One block of the page, written -- or passed over. */
    const one = (raw: Block) => {
      if (joined.has(raw.id)) return;
      const kids = children.get(raw.id);
      // A joined block keeps its link only when every member points the
      // same way: one `[...]` around words from elsewhere would claim them.
      const block = shape(
        kids
          ? {
              ...raw,
              text: [raw.text, ...kids.map((k) => k.text)].join(" "),
              href: kids.every((k) => k.href === raw.href)
                ? raw.href
                : undefined,
            }
          : raw,
        edits?.blocks[raw.id],
      );
      // Page furniture takes the document's setting, unless the block was
      // hidden or deleted by hand -- that decision stands. A hidden page
      // number is written as the number it prints, not its wording.
      const byHand = !!kids || block.hidden || block.deleted;
      const printed =
        !byHand && pageNumbers !== "keep" ? pageNumberOf(raw, page) : null;
      const furniture: Choice =
        printed !== null
          ? pageNumbers
          : !byHand && repeated.has(raw.id)
            ? headers
            : "keep";
      if (furniture === "delete") block.deleted = true;
      if (furniture === "hide") block.hidden = true;
      /** Which setting hid or deleted it, when one did rather than a hand. */
      const setting =
        furniture === "keep"
          ? {}
          : {
              furniture:
                printed !== null
                  ? ("page_numbers" as const)
                  : ("headers_footers" as const),
            };
      if (block.deleted) {
        blocks[block.id] = {
          id: block.id,
          page: page.n,
          n: 0,
          from: 0,
          to: 0,
          hidden: false,
          deleted: true,
          ...setting,
        };
        order.push(block.id);
        return;
      }
      if (block.hidden) {
        // The line it would be, commented out: markup and all, so reading
        // it back is reading any line. A page number hidden by the setting
        // is the number it prints.
        const words = inline(block);
        const said =
          printed !== null
            ? `page ${printed}`
            : block.kind === "image"
              ? figure(block)
              : !words
                ? ""
                : block.role === "heading"
                  ? `${"#".repeat(Math.max(1, Math.min(6, block.level || 2)))} ${words}`
                  : block.role === "bullet"
                    ? `- ${words}`
                    : LIST_ROLES.includes(block.role)
                      ? `1. ${words}`
                      : words;
        const q = block.quote ? "> " : "";
        if (!said) return;
        // Inside a list the comment is indented into the item before it,
        // so the list goes on past it rather than ending there.
        let at: number;
        if (inList) {
          at = put(`${q}${listIndent}${comment(said)}`, block.id, page.n);
        } else {
          blank(page.n);
          at = put(`${q}${comment(said)}`, block.id, page.n);
          put("", null, page.n);
        }
        if (block.quote) quoted.add(at);
        inQuote = block.quote;
        n += 1;
        blocks[block.id] = {
          id: block.id,
          page: page.n,
          n,
          from: at,
          to: at,
          hidden: true,
          deleted: false,
          ...setting,
        };
        order.push(block.id);
        return;
      }
      if (block.breakBefore) breakHere();
      // A list that goes into a quote or comes out of one is two lists:
      // the `>` cannot open or close partway through one.
      if (
        inList &&
        LIST_ROLES.includes(block.role) &&
        block.quote !== inQuote
      ) {
        counters = new Counters();
        inList = false;
      }
      const item = counters.itemFor(block);
      const q = block.quote ? "> " : "";
      // Each block is one line of the source; `at` is that line.
      let at: number;
      if (block.kind === "image") {
        const pic = figure(block);
        if (pic === null) return;
        blank(page.n);
        at = put(`${q}${pic}`, block.id, page.n);
        put("", null, page.n);
        inList = false;
      } else {
        const text = inline(block);
        if (!text) return;
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
          at = put(
            `${q}${item.indent}${item.marker} ${text}`,
            block.id,
            page.n,
          );
          listIndent = " ".repeat(item.indent.length + item.marker.length + 1);
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
      blocks[block.id] = {
        id: block.id,
        page: page.n,
        n,
        from: at,
        to: at,
        hidden: false,
        deleted: false,
        ...(block.corrected ? { corrected: true } : {}),
      };
      order.push(block.id);
      if (block.breakAfter) breakHere();
    };
    // Text a person inserted goes where they put it: at the page's top,
    // after the block it follows, or -- when that block no longer stands
    // here, joined away or made whole -- at the page's end.
    const mine = (edits?.inserts ?? []).filter((ins) => ins.page === page.n);
    /** Inserted text ends any list it falls in, like a rule. */
    const put1 = (ins: Insert) => {
      putInsert(ins, page.n);
      counters = new Counters();
      inList = false;
      inQuote = false;
    };
    const here = new Set(page.blocks.map((b) => b.id));
    for (const ins of mine) if (ins.after === null) put1(ins);
    for (const raw of page.blocks) {
      one(raw);
      for (const ins of mine) if (ins.after === raw.id) put1(ins);
    }
    for (const ins of mine)
      if (ins.after !== null && !here.has(ins.after)) put1(ins);
  };

  analysis.pages.forEach((page, i) => {
    if (i > 0) rule(page.n);
    emitPage(page);
  });
  // Inserted text on a page the document does not have -- an export from
  // another reading of it -- is written at the end rather than lost.
  const end = analysis.pages[analysis.pages.length - 1]?.n ?? 1;
  const stray = (edits?.inserts ?? []).filter(
    (ins) => !analysis.pages.some((p) => p.n === ins.page),
  );
  for (const ins of stray) putInsert(ins, end);

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
  return {
    text: `${lines.map((l) => l.text).join("\n")}\n`,
    lines,
    blocks,
    order,
  };
}
