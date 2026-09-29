/** What the engine reads off a document: every line and picture on every
 *  page, and the blocks they make. `.mdgest/<doc>.pdf/analysis.json` holds
 *  one of these. It is regenerable from the PDF, and nothing in it is a
 *  decision -- the decisions go in `edits.json`, keyed to the block ids here.
 *
 * Coordinates are PDF points in each page's own frame at scale 1, origin
 * top-left, y down: what `getViewport({ scale: 1 })` lays out, and what the
 * page pane draws in. The frame is the page's *displayed* one, rotation
 * applied, so a box here is where a person sees the thing.
 *
 * No pdf.js in here: the worker imports this file to write markdown from
 * an analysis, and pdf.js has no business in the engine's worker. */

export const ANALYSIS_FORMAT = 1;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The smallest box holding both. */
export function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** How much of a horizontal extent two boxes share, in points; at or below
 *  zero when they do not. */
export function overlapX(a: Box, b: Box): number {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
}

export function overlapY(a: Box, b: Box): number {
  return Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
}

/** One line of text as printed: the runs pdf.js reads on one baseline,
 *  joined. The style is the line's majority, by character. */
export interface Line {
  text: string;
  box: Box;
  /** Font size in points, 0 when it could not be told. */
  size: number;
  bold: boolean;
  italic: boolean;
  /** The PDF's own name for the font, subset prefix removed: `Helvetica-Bold`. */
  font: string;
}

/** One image drawn on a page, with the bounds it was drawn to. Only images
 *  large enough to be figures are pictures at all: a hairline rule or a
 *  bullet glyph drawn as a bitmap is left out at reading time, so every
 *  picture here was written and has a line in the markdown. */
export interface Picture {
  box: Box;
  /** The file under `markdown/<doc>.assets/`: `p3-i0.png`. */
  path: string;
  /** The written image's size in pixels. */
  px: [number, number];
}

export type Role = "heading" | "para" | "bullet" | "numbered" | "alpha" | "roman" | "image";

export const LIST_ROLES: readonly Role[] = ["bullet", "numbered", "alpha", "roman"];

/** A unit of the markdown: a paragraph, a heading, one list item, a picture.
 *  Its id is its position -- `p{page}b{index}` for text, `p{page}i{index}`
 *  for a picture -- which is what `edits.json` keys to. See the README on
 *  what that means for a revised source. */
export interface Block {
  id: string;
  kind: "text" | "image";
  page: number;
  box: Box;
  /** Indexes into the page's `lines`, in reading order. Empty for a picture. */
  lines: number[];
  /** The block's words, the list marker taken off the front. */
  text: string;
  role: Role;
  /** Heading level 1..6; 0 otherwise. */
  level: number;
  /** List nesting depth, 0 for a top-level item. */
  depth: number;
  bold: boolean;
  italic: boolean;
  /** The printed marker (`1.`, `a)`, `•`) when there is one. */
  marker: string;
  size: number;
  font: string;
  /** Index into the page's `pictures` for an image block; -1 otherwise. */
  picture: number;
}

export interface Page {
  /** 1-based. */
  n: number;
  width: number;
  height: number;
  lines: Line[];
  pictures: Picture[];
  /** In default reading order. */
  blocks: Block[];
}

export interface Analysis {
  format: typeof ANALYSIS_FORMAT;
  pages: Page[];
  /** The document's body font size: the size most characters are set in. */
  bodySize: number;
}

/** An analysis from its JSON, or an error saying what is wrong with it. The
 *  checks are the ones the panes and the emitter build on: the format, and
 *  that every page has the arrays they index into. */
export function parseAnalysis(text: string): Analysis {
  const problem = (what: string) => new Error(`its analysis.json ${what}.`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw problem("is not valid JSON");
  }
  if (typeof value !== "object" || value === null) throw problem("is not a JSON object");
  const { format, pages, bodySize } = value as Record<string, unknown>;
  if (format !== ANALYSIS_FORMAT) throw problem("is not in a format this version reads");
  if (!Array.isArray(pages)) throw problem("has no pages");
  for (const page of pages as unknown[]) {
    const p = page as Record<string, unknown> | null;
    if (
      !p ||
      typeof p.n !== "number" ||
      !Array.isArray(p.lines) ||
      !Array.isArray(p.pictures) ||
      !Array.isArray(p.blocks)
    ) {
      throw problem("has a page that is not one");
    }
  }
  return {
    format: ANALYSIS_FORMAT,
    pages: pages as Page[],
    bodySize: typeof bodySize === "number" ? bodySize : 0,
  };
}
