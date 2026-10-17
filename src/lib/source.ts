/** Editing a block from its markdown: what a person wrote over one block's
 *  lines in the source view, turned into edits to that block.
 *
 * One block at a time, by its id, so nothing is diffed or guessed: the
 * lines being edited are the lines the block wrote. What the writing says
 * is read back the way emit.ts writes it --
 *
 * - its markup (a heading's `#`s, a list marker and its indent, `**`, `*`,
 *   a quote's `>`) → the block's shape;
 * - wrapped in `<!-- -->` → hidden; nothing left → deleted;
 * - its words changed → a correction on the block, the page's own words
 *   kept beside it;
 * - a new line between its words → the block divided there. The words on
 *   either side must be the block's own: a cut moves no word, so dividing
 *   and rewording at once is refused rather than guessed at.
 *
 * Every change it makes is one undo step. Pure, and shared like emit.ts. */

import { blocksById, LIST_ROLES, type Analysis, type Block, type Role } from "./analysis";
import { divided, pieceId, wordsOf } from "./divide";
import { apply, asOneStep, setCuts, shape, type Change, type Edits } from "./edits";
import { BULLET_ONLY, MARKER_ONLY } from "./structure";

/** What one written line says. `role` is absent when the line opens with
 *  no markup that names one -- a plain line, which is a paragraph. */
export interface Written {
  text: string;
  role: Role | null;
  level: number;
  /** Spaces before a list marker. */
  indent: number;
  bold: boolean;
  italic: boolean;
  quote: boolean;
  hidden: boolean;
  /** Emphasis on part of the line -- `some *word* here` -- which a block
   *  cannot carry: emphasis is the whole block's, and these `*`s would be
   *  kept as characters. */
  partial: boolean;
}

/** Markdown's backslash escapes taken off, as `escapeText` put them on. */
function unescape(text: string): string {
  return text.replace(/\\([\\`*_[\]<&~#>+\-.)])/g, "$1");
}

/** A line of source read back into what it says of its block. */
export function readLine(line: string): Written {
  const out: Written = {
    text: "",
    role: null,
    level: 0,
    indent: 0,
    bold: false,
    italic: false,
    quote: false,
    hidden: false,
    partial: false,
  };
  let s = line.replace(/\s+$/, "");
  const q = /^>\s?/.exec(s);
  if (q) {
    out.quote = true;
    s = s.slice(q[0].length);
  }
  out.indent = /^ */.exec(s)![0].length;
  s = s.trimStart();
  // A comment is a hidden line: emit writes the line the block would be,
  // commented out, so what is inside is read like any other line.
  const c = /^<!--\s?([\s\S]*?)\s?-->$/.exec(s);
  if (c) {
    const inner = readLine(c[1].replaceAll("-- >", "-->"));
    return { ...inner, quote: out.quote, indent: out.indent, hidden: true };
  }
  let m = /^(#{1,6})\s+(.*)$/.exec(s);
  if (m) {
    out.role = "heading";
    out.level = m[1].length;
    s = m[2];
  } else if ((m = /^[-*+]\s+(.*)$/.exec(s))) {
    out.role = "bullet";
    s = m[1];
  } else if ((m = /^\d{1,9}[.)]\s+(.*)$/.exec(s))) {
    out.role = "numbered";
    s = m[1];
  }
  // Emphasis as `inline` nests it: italic outside, bold inside -- and only
  // around the whole line: inside, emit escapes every `*`, so one that is
  // not escaped was written there, around part of the line.
  const bare = (t: string) => !/(^|[^\\])\*/.test(t);
  if ((m = /^\*\*\*(.+)\*\*\*$/.exec(s)) && bare(m[1])) {
    out.bold = out.italic = true;
    s = m[1];
  } else if ((m = /^\*\*(.+)\*\*$/.exec(s)) && bare(m[1])) {
    out.bold = true;
    s = m[1];
  } else if ((m = /^\*(.+)\*$/.exec(s)) && bare(m[1])) {
    out.italic = true;
    s = m[1];
  }
  out.partial = !bare(s);
  // A link around the whole line is the block's own; its words are inside.
  if ((m = /^\[(.*)\]\([^)]*\)$/.exec(s))) s = m[1];
  out.text = unescape(s).trim();
  return out;
}

const words = (text: string) => text.split(/\s+/).filter(Boolean);
const same = (a: string, b: string) => words(a).join(" ") === words(b).join(" ");

/** The shape a written line asks of `block`, set against the line that
 *  was there. A list written `1.` keeps a lettered or roman list's kind:
 *  emit writes every ordered list in numbers. Depth moves one level for an
 *  indent deeper or shallower than before. Emphasis is a heading's own. */
function shapeOf(w: Written, was: Written, block: ReturnType<typeof shape>): Change {
  let role: Role = w.role ?? "para";
  if (role === "numbered" && (block.role === "alpha" || block.role === "roman")) role = block.role;
  const change: Change = { role, quote: w.quote, hidden: w.hidden };
  if (role === "heading") change.level = w.level;
  else change.level = 0;
  if (LIST_ROLES.includes(role)) {
    const step = Math.sign(w.indent - was.indent);
    change.depth = Math.max(0, (LIST_ROLES.includes(block.role) ? block.depth : 0) + step);
  }
  if (role !== "heading") {
    change.bold = w.bold;
    change.italic = w.italic;
  }
  return change;
}

/** Edits with `blockId`'s text corrected to `text`, or the correction taken
 *  off when `text` is the page's own words again. */
function correct(edits: Edits, blockId: string, text: string, printed: string): Edits {
  const entry = { ...edits.blocks[blockId] };
  if (same(text, printed)) delete entry.text;
  else entry.text = words(text).join(" ");
  const blocks = { ...edits.blocks };
  if (Object.keys(entry).length) blocks[blockId] = entry;
  else delete blocks[blockId];
  return { ...edits, blocks };
}

/** Where, in `source` -- the block's words -- each of `lines` starts, when
 *  together they are those words in order. A list marker printed among the
 *  words (a bullet drawn as `•`) may stand where a line writes its own
 *  marker, and goes with the line it opens. Null when they are not the
 *  block's words. */
function starts(source: string[], lines: string[][]): number[] | null {
  const out: number[] = [];
  let at = 0;
  for (const line of lines) {
    out.push(at);
    const marker = source[at];
    if (marker && marker !== line[0] && (BULLET_ONLY.test(marker) || MARKER_ONLY.test(marker))) at++;
    for (const word of line) {
      if (source[at] !== word) return null;
      at++;
    }
  }
  return at === source.length ? out : null;
}

export type SourceEdit = { edits: Edits } | { problem: string };

/** What writing `written` over `blockId`'s lines makes of `edits`, as one
 *  step -- the same edits when it says nothing new -- or why it cannot be
 *  done. `was` is the source the block wrote, its lines as they stood. */
export function editSource(
  read: Analysis,
  edits: Edits,
  blockId: string,
  was: string,
  written: string,
): SourceEdit {
  const view = divided(read, edits.cuts);
  const byId = blocksById(view);
  const block = byId.get(blockId);
  if (!block) return { problem: "That block is not in this document any more." };
  // A joined block writes its children's words after its own.
  const kids = Object.entries(edits.joins)
    .filter(([, head]) => head === blockId)
    .map(([child]) => byId.get(child))
    .filter((b): b is Block => b !== undefined);
  const printed = [block.text, ...kids.map((k) => k.text)].join(" ");
  const shaped = shape({ ...block, text: printed }, edits.blocks[blockId]);

  const lines = written.split("\n").filter((l) => l.trim());
  const wrote = lines.map(readLine);
  const before = readLine(was.split("\n").find((l) => l.trim()) ?? "");

  if (lines.length === 0) {
    return { edits: apply(edits, [block], () => ({ deleted: true, hidden: false })) };
  }

  if (block.kind === "image") {
    const [w] = wrote;
    if (lines.length > 1 || (!w.hidden && w.text !== before.text)) {
      return { problem: "A picture's line is not edited here: hide or delete it, or do it on the page." };
    }
    return { edits: apply(edits, [block], () => ({ hidden: w.hidden, quote: w.quote })) };
  }

  if (wrote.some((w) => w.partial)) {
    return {
      problem:
        "Emphasis on part of a line is not kept: bold and italic are a whole block's. " +
        "Take out the *s, or set the whole block from the toolbar.",
    };
  }

  if (lines.length === 1) {
    const [w] = wrote;
    // A comment says only that it is hidden: its shape is kept as it was.
    // Taking the comment off a line written plain only shows it again --
    // a hidden list item or heading stays what it was.
    const shown = before.hidden && !w.hidden && w.role === null && !w.bold && !w.italic;
    const change = w.hidden ? { hidden: true } : shown ? { hidden: false } : shapeOf(w, before, shaped);
    let next = apply(edits, [block], () => change);
    // Words are set against what the line showed: a hidden page number
    // shows `page 12`, and written so again it is no correction.
    if (!same(w.text, before.text)) next = correct(next, blockId, w.text, printed);
    return { edits: asOneStep(edits, next) };
  }

  // Several lines: the block divided where they break.
  if (kids.length) return { problem: "A joined block is divided from the page: divide takes the join apart." };
  if (shaped.corrected) {
    return { problem: "This block's words are corrected. Restore the page's wording first, then divide it." };
  }
  const source = block.piece?.of ?? block.id;
  const from = block.piece?.from ?? 0;
  const to = block.piece?.to ?? Infinity;
  // The lines are set against the block's printed words, which the cuts
  // count: a later piece's text has the marker it opens with taken off,
  // and the whole block's drops a line that is only a bullet, so its text
  // can stand a word short of where its cuts fall.
  const page = read.pages.find((p) => p.n === block.page) ?? read.pages[0];
  const whole = block.piece ? (page.blocks.find((b) => b.id === source) ?? block) : block;
  const printedWords = wordsOf(whole, page)
    .slice(from, to)
    .map((w) => w.text);
  const at = starts(printedWords, wrote.map((w) => words(w.text)));
  if (!at) {
    return {
      problem:
        "A new line divides the block where you put it, so its words have to stay the same. " +
        "Divide first, then edit each piece.",
    };
  }
  // A block's first piece starts after any marker the reader took off, so a
  // piece's place in the whole block is its start here plus the block's.
  const had = edits.cuts?.[source] ?? [];
  const cuts = [...had.filter((k) => k <= from || k >= to), ...at.slice(1).map((k) => from + k)];
  let next = setCuts(edits, source, cuts);
  const pieces = blocksById(divided(read, next.cuts));
  wrote.forEach((w, i) => {
    const id = i === 0 ? blockId : pieceId(source, from + at[i]);
    const piece = pieces.get(id);
    if (!piece) return;
    const was = shape(piece, next.blocks[id]);
    next = apply(next, [piece], () => (w.hidden ? { hidden: true } : shapeOf(w, before, was)));
  });
  return { edits: asOneStep(edits, next) };
}
