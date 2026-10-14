/** Dividing a block: a person's cuts through a block's words, and the
 *  pieces they make.
 *
 * A cut is a word position in the block's own text -- "a new piece starts
 * at word 7" -- so the words a piece holds are exact whatever the page's
 * geometry. Where a word sits on the page is only needed to draw: the cut
 * cursor, and each piece's box. That is estimated from the printed line's
 * box and where the word falls in the line's characters, which is close
 * for prose and needs nothing more from the reader.
 *
 * The first piece keeps the block's id, so every edit made to the block
 * before it was divided stays with its start; a later piece is `<id>c<k>`,
 * `k` the word it starts at. A piece that starts with a list marker takes
 * that marker's role, which is how a list read as one paragraph -- its
 * bullets drawn, not typed -- comes apart into items.
 *
 * Pure, and shared like emit.ts. */

import { union, type Analysis, type Block, type Box, type Page } from "./analysis";
import { markerOf } from "./structure";

/** One word of a block: the printed line it is on, and its left and right
 *  edges there. */
export interface Word {
  text: string;
  line: number;
  x0: number;
  x1: number;
}

/** A block's words, in order, each placed on its line. The first line's
 *  marker is not a word: the block's text starts after it. Empty for a
 *  picture. */
export function wordsOf(block: Block, page: Page): Word[] {
  if (block.kind !== "text") return [];
  const out: Word[] = [];
  block.lines.forEach((li, k) => {
    const line = page.lines[li];
    if (!line) return;
    const text = line.text;
    // Where the words start: after the marker, on the first line.
    let at = k === 0 ? Math.max(0, text.indexOf(markerOf(text).rest)) : 0;
    const per = text.length ? line.box.w / text.length : 0;
    for (const word of text.slice(at).split(/\s+/).filter(Boolean)) {
      const start = text.indexOf(word, at);
      at = start + word.length;
      out.push({ text: word, line: li, x0: line.box.x + start * per, x1: line.box.x + at * per });
    }
  });
  return out;
}

/** The box around words `from` up to `to` of `words`: per printed line,
 *  from the first word's left edge to the last one's right, the line's
 *  full height. */
export function boxOf(words: Word[], from: number, to: number, page: Page): Box {
  let box: Box | null = null;
  for (let i = from; i < to; ) {
    const line = words[i].line;
    let j = i;
    while (j < to && words[j].line === line) j++;
    const lb = page.lines[line].box;
    const part = { x: words[i].x0, y: lb.y, w: words[j - 1].x1 - words[i].x0, h: lb.h };
    box = box ? union(box, part) : part;
    i = j;
  }
  return box ?? { x: 0, y: 0, w: 0, h: 0 };
}

/** The id of the piece of `id` that starts at word `from`. */
export function pieceId(id: string, from: number): string {
  return from === 0 ? id : `${id}c${from}`;
}

/** Cuts as they can be: whole numbers strictly inside the block's words,
 *  sorted, each once. */
export function cleanCuts(cuts: readonly number[], words: number): number[] {
  return [...new Set(cuts)].filter((k) => Number.isInteger(k) && k > 0 && k < words).sort((a, b) => a - b);
}

/** `block` cut at `cuts` -- word positions -- into its pieces. With no
 *  cut that can be made, the block as it is. */
export function divideBlock(block: Block, page: Page, cuts: readonly number[]): Block[] {
  const words = wordsOf(block, page);
  const at = cleanCuts(cuts, words.length);
  if (at.length === 0) return [block];
  const bounds = [0, ...at, words.length];
  return bounds.slice(0, -1).map((from, n) => {
    const to = bounds[n + 1];
    const said = words.slice(from, to).map((w) => w.text).join(" ");
    const lines = [...new Set(words.slice(from, to).map((w) => w.line))];
    // The first piece keeps the marker the block printed before its words.
    let box = boxOf(words, from, to, page);
    if (from === 0) box = union(box, { ...page.lines[words[0].line].box, w: 0 });
    const piece = { of: block.id, from, to };
    if (n === 0) return { ...block, text: said, lines, box, piece };
    // A later piece is read off its own first words: a marker there makes
    // it a list item of that kind. Otherwise it is what the block was.
    const { role, marker, rest } = markerOf(said);
    return {
      ...block,
      id: pieceId(block.id, from),
      text: role ? rest : said,
      marker: role ? marker : "",
      role: role || block.role,
      lines,
      box,
      piece,
    };
  });
}

/** One analysis divided by one set of cuts, kept: every pane lays out the
 *  same pieces, and the emit after every edit asks again. */
const kept = new WeakMap<Analysis, { cuts: Record<string, number[]> | undefined; out: Analysis }>();

/** `analysis` with every block `cuts` divides replaced by its pieces, in
 *  place. The same object when there are no cuts. */
export function divided(analysis: Analysis, cuts: Record<string, number[]> | undefined): Analysis {
  if (!cuts || Object.keys(cuts).length === 0) return analysis;
  const was = kept.get(analysis);
  if (was && was.cuts === cuts) return was.out;
  const out: Analysis = {
    ...analysis,
    pages: analysis.pages.map((page) =>
      page.blocks.some((b) => cuts[b.id])
        ? { ...page, blocks: page.blocks.flatMap((b) => (cuts[b.id] ? divideBlock(b, page, cuts[b.id]) : [b])) }
        : page,
    ),
  };
  kept.set(analysis, { cuts, out });
  return out;
}
