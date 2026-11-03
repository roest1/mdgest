/** The markdown cut into its pages, each a markdown document of its own,
 *  so the pane can parse and draw one page at a time.
 *
 * Parsing the whole of a long document's markdown at once holds the page's
 * thread for as long as it takes -- the better part of a minute for a
 * thousand-page book -- and parsing it again on every edit. A page's part
 * reads the same alone as in the whole, by how `emit.ts` writes it: every
 * page after the first opens on a rule set off by blank lines, which ends
 * whatever came before it, and each page counts its own lists afresh; the
 * markdown carries nothing -- a link reference, a footnote -- that one part
 * could need from another. `pieces.test.ts` holds it to that. */

import type { Markdown, SourceLine } from "./emit";

export interface Piece {
  /** The page it is the markdown of. */
  page: number;
  /** Where its first line is among the markdown's, counted from 0. */
  from: number;
  /** Its lines, as markdown of its own. */
  text: string;
  /** Its lines as `Markdown.lines` has them, with the block that wrote
   *  each: a parser's line 1 is the first of these. */
  lines: SourceLine[];
}

/** The markdown's lines in runs of one page each, in the order written. A
 *  page that wrote nothing has no piece. */
export function pieces(markdown: Markdown): Piece[] {
  const { lines } = markdown;
  const out: Piece[] = [];
  let start = 0;
  for (let i = 1; i <= lines.length; i++) {
    if (i < lines.length && lines[i].page === lines[start].page) continue;
    const run = lines.slice(start, i);
    out.push({
      page: run[0].page,
      from: start,
      text: `${run.map((l) => l.text).join("\n")}\n`,
      lines: run,
    });
    start = i;
  }
  return out;
}

/** Whether two pieces would draw the same: one page's text, the same
 *  block behind each line. Where it starts in the whole does not change
 *  what is drawn. */
export function samePiece(a: Piece, b: Piece): boolean {
  return (
    a === b ||
    (a.page === b.page &&
      a.text === b.text &&
      a.lines.length === b.lines.length &&
      a.lines.every((l, i) => l.block === b.lines[i].block))
  );
}
