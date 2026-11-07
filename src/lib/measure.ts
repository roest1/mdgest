/** What a markdown file is, for the markdown pane's Document properties: how
 *  long it is, how much of it is HTML comments, and whether CommonMark
 *  renders all of it or some of it needs GitHub Flavored Markdown.
 *
 * Read off the text, so it holds for whatever the file has become -- text a
 * person inserted is written as typed, and can carry a table the emitter
 * never writes. Measured the way the pane renders: a page at a time
 * (`pieces.ts`), since micromark over a whole book is half a minute of the
 * page's thread and grows faster than the text does, where a page is
 * milliseconds. And parsed only where there is something to find: the
 * length and the comments are read off the text, and a page is parsed for
 * GFM only when it holds a character one of its constructs is written
 * with, which a page the emitter wrote almost never does. */

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export interface Measure {
  lines: number;
  /** UTF-8, as the file is written. */
  bytes: number;
  /** About four characters a token, which is how English text runs through
   *  the common tokenizers; any one model's count differs. */
  tokens: number;
  /** Lines with an HTML comment on them: a hidden block, or one a person
   *  wrote. Gone from a rendered view, there for anything that reads the
   *  file as text. */
  commentLines: number;
  /** The GFM constructs in the file, by name, in the order first met. None
   *  is a file CommonMark renders whole. */
  gfm: string[];
}

interface Node {
  type: string;
  checked?: boolean | null;
  children?: Node[];
  position?: { start: { offset?: number } };
}

/** The GFM node types, by the name each is shown under. A link is GFM only
 *  when it is a bare URL: `[text](url)` and `<url>` are CommonMark, so its
 *  first character in the source says which it is. */
function gfmName(node: Node, text: string): string | null {
  switch (node.type) {
    case "table":
      return "tables";
    case "delete":
      return "strikethrough";
    case "footnoteDefinition":
    case "footnoteReference":
      return "footnotes";
    case "listItem":
      return typeof node.checked === "boolean" ? "task lists" : null;
    case "link": {
      const at = node.position?.start.offset;
      return at !== undefined && text[at] !== "[" && text[at] !== "<"
        ? "bare links"
        : null;
    }
    default:
      return null;
  }
}

/** Not preceded by an odd number of backslashes: the character after this
 *  stands, where `\\~` is a tilde escaped and `\\\\~` a backslash escaped
 *  and then a tilde. */
const UNESCAPED = String.raw`(?<!(?:^|[^\\])(?:\\\\)*\\)`;

/** What a GFM construct cannot be written without, each as it would stand
 *  in the source and not escaped: a table's delimiter row (which needs a
 *  pipe: with none it is a setext underline; in a quote it wears the `>`),
 *  a `~`, a `[^`, a `[ ]` or `[x]`, a URL, or an address. A URL after `](`
 *  or `<` is a CommonMark link when the link closes and a bare one when it
 *  does not, so no URL is passed over. The emitter escapes `~`, `[` and
 *  `<` in what a page prints, so its own pages pass but for the ones with
 *  links; what a person typed is parsed to be sure. Wider than the
 *  constructs, never narrower: the parser decides, this only says where to
 *  ask it. */
const MAY_HOLD_GFM = [
  /^(?=[^\n]*\|)(?=[^\n]*-)[ \t>|:-]+$/m,
  new RegExp(`${UNESCAPED}~`),
  new RegExp(String.raw`${UNESCAPED}\[\^`),
  new RegExp(String.raw`${UNESCAPED}\[[ xX]\]`),
  /https?:\/\/|www\./i,
  /\S@\S+\.\S/,
];

/** The GFM constructs `part` holds, by name, in the order met -- parsed
 *  only when it may hold one. */
function gfmIn(part: string): string[] {
  if (!MAY_HOLD_GFM.some((re) => re.test(part))) return [];
  const found: string[] = [];
  const visit = (node: Node) => {
    const name = gfmName(node, part);
    if (name && !found.includes(name)) found.push(name);
    node.children?.forEach(visit);
  };
  visit(
    fromMarkdown(part, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    }) as Node,
  );
  return found;
}

/** Whether the character at `at` is escaped: preceded by an odd number of
 *  backslashes, as `\\<!--` is and `\\\\<!--` is not. */
function escaped(text: string, at: number): boolean {
  let n = 0;
  for (let i = at - 1; i >= 0 && text.charCodeAt(i) === 92; i--) n++;
  return n % 2 === 1;
}

/** Whether `<!--` at `at` opens its line: nothing before it on the line
 *  but up to three spaces, a quote's `>`s and a list marker. Only then is
 *  one never closed an HTML block, which runs to the end of the file;
 *  opened inside a line it is text. */
const OPENS_LINE = /^ {0,3}(?:>[ \t]*)*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?$/;
function opensLine(text: string, at: number): boolean {
  return OPENS_LINE.test(text.slice(text.lastIndexOf("\n", at - 1) + 1, at));
}

/** How many lines of `text` an HTML comment is on: each from its `<!--`
 *  (`<!-->` and `<!--->` included, as CommonMark has them) to its `-->`,
 *  or to the end of the file for one that opens a line and never closes. A
 *  line with two is one line. Read off the text, not off a parse: a
 *  document with a block hidden on every page has a comment on every
 *  page, and parsing every page to count them is the cost this avoids. So
 *  a `<!--` in a code span or a fenced block counts too, which a parser
 *  would not; the emitter escapes backticks, so that is typed text. */
function commentLines(text: string): number {
  // Content ends before a final line break, which starts no line.
  const end = text.endsWith("\n") ? text.length - 2 : text.length - 1;
  let count = 0;
  let line = 0;
  let at = 0;
  let counted = -1;
  /** Advance to offset `to`, counting the line breaks passed. */
  const advance = (to: number) => {
    for (; at < to; at++) if (text.charCodeAt(at) === 10) line++;
  };
  for (;;) {
    const open = text.indexOf("<!--", at);
    if (open < 0) return count;
    advance(open);
    if (escaped(text, open)) {
      at = open + 1;
      continue;
    }
    const close = text.indexOf("-->", open + 2);
    if (close < 0 && !opensLine(text, open)) {
      at = open + 1;
      continue;
    }
    const first = line;
    advance(close < 0 ? Math.max(open, end) : close + 2);
    count += line - Math.max(first, counted + 1) + 1;
    counted = line;
    if (close < 0) return count;
  }
}

/** `text` measured, its GFM found in `parts` -- its pages, as the pane
 *  renders them; the whole text when there are none. A construct a page
 *  cannot hold on its own, a footnote whose definition is on another page,
 *  is one the pane does not render either. */
export function measure(
  text: string,
  parts: readonly string[] = [text],
): Measure {
  const found: string[] = [];
  for (const part of parts) {
    for (const name of gfmIn(part)) if (!found.includes(name)) found.push(name);
  }
  const breaks = text.split("\n").length - 1;
  return {
    lines: text === "" ? 0 : text.endsWith("\n") ? breaks : breaks + 1,
    bytes: new TextEncoder().encode(text).byteLength,
    tokens: Math.round(text.length / 4),
    commentLines: commentLines(text),
    gfm: found,
  };
}
