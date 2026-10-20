/** From lines on a page to blocks in reading order, each with a role.
 *
 * Pure functions over what `read.ts` produces. No model: the structure is
 * read off the page the way a person reads it in a second -- what is larger
 * or bolder is a heading, what sits behind a bullet is an item, what sits
 * further right is nested deeper, what shares a column is read down before
 * across.
 *
 * Everything here is a *default*. Edits override any of it per block, and
 * the override is what is precious; this is regenerable. Everything is in
 * the page pane's frame: y down, boxes as origin and size. */

import {
  ANALYSIS_FORMAT,
  READER,
  LIST_ROLES,
  overlapX,
  overlapY,
  union,
  type Analysis,
  type Block,
  type Box,
  type Line,
  type Page,
  type Role,
} from "./analysis";

/** What `read.ts` hands over: a page before its blocks are made. */
export type ReadPage = Omit<Page, "blocks">;

// ---- thresholds -------------------------------------------------------------

/** Larger than the body by this much reads as a heading. */
const SIZE_RATIO = 1.1;
const MAX_HEADING_CHARS = 90;
/** When more text than this is bold, bold means nothing. */
const BOLD_SATURATION = 0.35;
/** Lines closer than this (× line height) are one paragraph. */
const LINE_GAP_RATIO = 1.1;
/** An x-gap wider than this (× median line height) is a gutter... */
const COLUMN_GAP_RATIO = 0.6;
/** ...and at least this many points. */
const MIN_COLUMN_GAP = 3;
/** A y-gap wider than this (× median line height) splits bands. */
const BAND_GAP_RATIO = 0.6;
/** Indents within this many points are one indent. */
const INDENT_TOLERANCE = 3;
/** Heading sizes within this ratio of each other are one level. */
const LEVEL_RATIO = 0.92;
const MAX_LEVEL = 4;

// ---- markers ----------------------------------------------------------------

/** Glyphs a bullet is set in. The dash-like and star ones need a space after
 *  them: `-5 °C` and `*emphasis*` start lines too. */
const BULLET_GLYPHS = "■□▪▫●○◦•‣⁃◆◇❏❑❒❘❙❚❖➥";
const DASH_BULLETS = "\\-–—·*";
const BULLET_RE = new RegExp(`^(?:[${BULLET_GLYPHS}]\\s*|[${DASH_BULLETS}]\\s+)`);
const NUMBER_RE = /^\(?(\d{1,3})[.)]\s+/;
const ALPHA_RE = /^\(?([a-zA-Z])[.)]\s+/;
const ROMAN_RE = /^\(?((?:x{0,3})(?:ix|iv|v?i{0,3}))[.)]\s+/i;

/** A run of text that is a bullet and nothing else, and one that is a
 *  marker and nothing else: what `read.ts` widens the join gap behind.
 *  Looser than the role grammar above on purpose -- misjudging a gap costs
 *  little -- and kept beside it so a glyph or shape added to one is seen
 *  by whoever must add it to the other. */
export const BULLET_ONLY = new RegExp(`^[${BULLET_GLYPHS}${DASH_BULLETS}]+$`);
export const MARKER_ONLY = /^\(?(?:\d{1,3}|[ivxlcdm]{1,5}|[a-z])[.)]$/i;

interface Marker {
  role: Role | "";
  marker: string;
  rest: string;
}

/** The list marker a line starts with, and the words after it, or no role
 *  and the text as it was. Roman before alpha, so `i.` and `v.` are numerals
 *  and `c.` is a letter. */
export function markerOf(text: string): Marker {
  let m = BULLET_RE.exec(text);
  if (m && m[0].length < text.length) {
    return { role: "bullet", marker: m[0].trim(), rest: text.slice(m[0].length).trim() };
  }
  m = NUMBER_RE.exec(text);
  if (m) return { role: "numbered", marker: m[0].trim(), rest: text.slice(m[0].length).trim() };
  m = ROMAN_RE.exec(text);
  if (m && m[1]) return { role: "roman", marker: m[0].trim(), rest: text.slice(m[0].length).trim() };
  m = ALPHA_RE.exec(text);
  if (m) return { role: "alpha", marker: m[0].trim(), rest: text.slice(m[0].length).trim() };
  return { role: "", marker: "", rest: text };
}

// ---- typography -------------------------------------------------------------

/** The size most characters are set in, to a tenth of a point. */
function bodySize(pages: ReadPage[]): number {
  const weights = new Map<number, number>();
  for (const page of pages) {
    for (const line of page.lines) {
      if (line.size <= 0) continue;
      const key = Math.round(line.size * 10) / 10;
      weights.set(key, (weights.get(key) ?? 0) + line.text.length);
    }
  }
  let best = 0;
  let most = -1;
  for (const [size, count] of weights) {
    if (count > most) {
      most = count;
      best = size;
    }
  }
  return best;
}

function boldFraction(pages: ReadPage[]): number {
  let total = 0;
  let bold = 0;
  for (const page of pages) {
    for (const line of page.lines) {
      total += line.text.length;
      if (line.bold) bold += line.text.length;
    }
  }
  return total ? bold / total : 0;
}

function isHeading(line: Line, body: number, boldMatters: boolean): boolean {
  const text = line.text.trim();
  if (!text || text.length > MAX_HEADING_CHARS || line.size <= 0 || body <= 0) return false;
  if (markerOf(text).role) return false;
  const larger = line.size >= body * SIZE_RATIO;
  const emphasized =
    boldMatters && line.bold && line.size >= body && !/[.,;]$/.test(text);
  return larger || emphasized;
}

function sameStyle(a: Line, b: Line): boolean {
  return Math.abs(a.size - b.size) <= 0.6 && a.bold === b.bold;
}

// ---- reading order (XY-cut) ---------------------------------------------------

/** The unit every gap threshold here is a multiple of. */
function medianHeight(boxes: Box[]): number {
  const hs = boxes.map((b) => b.h).filter((h) => h > 0).sort((a, b) => a - b);
  return hs.length ? hs[hs.length >> 1] : 10;
}

type Item = [number, Box];

const xSide = (b: Box): [number, number] => [b.x, b.x + b.w];
const ySide = (b: Box): [number, number] => [b.y, b.y + b.h];

/** Where to cut a set of 1-D extents: the midpoint of every empty stretch
 *  at least `min` wide. The extents must come in ascending by their start,
 *  which makes the sweep enough to find the stretches and leaves the cuts
 *  ascending for `bisect` below. */
function cutsOn(items: Item[], side: (b: Box) => [number, number], min: number): number[] {
  const out: number[] = [];
  let edge = -Infinity;
  for (const [, box] of items) {
    const [lo, hi] = side(box);
    if (edge > -Infinity && lo - edge >= min) out.push((edge + lo) / 2);
    if (hi > edge) edge = hi;
  }
  return out;
}

/** The first index in ascending `cuts` at or above `v`: which side of the
 *  cuts a box falls. A bisect rather than a scan of every cut per box,
 *  because that scan made a page of n bands cost O(n^2) -- 800 lines took
 *  8.55 ms where this takes 0.46 ms. */
function bisect(cuts: number[], v: number): number {
  let lo = 0;
  let hi = cuts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cuts[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** `items` split by `cuts`, each group keeping the order it came in. */
function split(items: Item[], cuts: number[], mid: (b: Box) => number): Item[][] {
  const groups: Item[][] = Array.from({ length: cuts.length + 1 }, () => []);
  for (const item of items) groups[bisect(cuts, mid(item[1]))].push(item);
  return groups;
}

/** Reading order of boxes as leaf groups: bands top to bottom, columns left
 *  to right, recursively. Each leaf is one column-band of the page; flatten
 *  for the order, keep the leaves to reason about indentation within a
 *  column.
 *
 * Columns win over bands when a gutter exists, because a paragraph break
 * that happens to line up across two columns is not a reason to read
 * across. */
function readingOrder(items: Item[], unit: number): number[][] {
  // Sorted by left edge once, for the whole page: a cut hands each group the
  // items in the order it was given them, so every group below this is left
  // to right already and no level has to sort for x again.
  return xyCut([...items].sort(([, a], [, b]) => a.x - b.x), unit);
}

/** The recursion under `readingOrder`, which `items` reaches sorted by left
 *  edge -- the order `cutsOn` needs for the gutters, and the order the cuts
 *  preserve. */
function xyCut(items: Item[], unit: number): number[][] {
  if (items.length <= 1) return items.length ? [items.map(([i]) => i)] : [];
  const xcuts = cutsOn(items, xSide, Math.max(COLUMN_GAP_RATIO * unit, MIN_COLUMN_GAP));
  if (xcuts.length) {
    return split(items, xcuts, (b) => b.x + b.w / 2).flatMap((g) => xyCut(g, unit));
  }
  // The bands want the same sweep down the page, which is the one order a
  // cut above cannot have left behind.
  const byY = [...items].sort(([, a], [, b]) => a.y - b.y);
  const ycuts = cutsOn(byY, ySide, BAND_GAP_RATIO * unit);
  if (ycuts.length) {
    return split(items, ycuts, (b) => b.y + b.h / 2).flatMap((g) => xyCut(g, unit));
  }
  // `byY` is this leaf's own copy, so it sorts in place.
  return [byY.sort(([, a], [, b]) => a.y - b.y || a.x - b.x).map(([i]) => i)];
}

// ---- blocks -----------------------------------------------------------------

/** Distinct indents, with anything within INDENT_TOLERANCE of a smaller one
 *  folded in. */
function cluster(values: number[]): number[] {
  const out: number[] = [];
  for (const v of [...new Set(values)].sort((a, b) => a - b)) {
    if (!out.length || v - out[out.length - 1] > INDENT_TOLERANCE) out.push(v);
  }
  return out;
}

/** Consecutive lines, in reading order, that make one block. */
function groupLines(
  lines: Line[],
  order: number[],
  body: number,
  boldMatters: boolean,
): number[][] {
  const groups: number[][] = [];
  let prev: Line | null = null;
  let prevHeading = false;
  let prevMarker: Role | "" = "";
  for (const idx of order) {
    const line = lines[idx];
    const heading = isHeading(line, body, boldMatters);
    const { role } = markerOf(line.text);
    let startNew = true;
    if (prev !== null && groups.length) {
      const unit = Math.max(prev.box.h, line.box.h, 1);
      const gap = line.box.y - (prev.box.y + prev.box.h);
      const close = -0.5 * unit <= gap && gap <= LINE_GAP_RATIO * unit;
      if (close && overlapX(prev.box, line.box) > 0 && sameStyle(prev, line) && !role) {
        if (heading && prevHeading) {
          startNew = false; // a heading wrapped onto two lines
        } else if (!heading && !prevHeading) {
          // A wrapped paragraph or list item: a continuation starts at or
          // right of the previous text's left edge (a hanging indent).
          const group = groups[groups.length - 1];
          const first = lines[group[0]];
          if (prevMarker) {
            // Inside a list item, whose first line is the marker's. Its
            // wrapped lines line up with one another, past the marker; a
            // line that steps back left of them stands where the marker
            // did and is not more of the item but what follows the list,
            // which would otherwise be read as part of the last item.
            // Until a second line sets that edge there is nothing to tell
            // one from the other, and the line is the item's.
            const wrapped = group.length > 1 ? lines[group[1]] : null;
            startNew = wrapped !== null && line.box.x < wrapped.box.x - 0.9 * unit;
          } else {
            startNew =
              Math.abs(line.box.x - first.box.x) > 0.9 * unit && line.box.x < first.box.x;
          }
        }
      }
    }
    if (startNew) {
      groups.push([idx]);
      prevMarker = role;
    } else {
      groups[groups.length - 1].push(idx);
    }
    prev = line;
    prevHeading = heading;
  }
  return groups;
}

/** Where a picture goes among the text: before the text nearest to it --
 *  its label to the right on the same row, or its caption below it -- else
 *  at the end of the page. */
function placePicture(ordered: Block[], img: Block): number {
  let bestPos = ordered.length;
  let bestDist = Infinity;
  ordered.forEach((tb, i) => {
    if (tb.kind !== "text") return;
    let dist: number | null = null;
    if (overlapY(tb.box, img.box) > 0 && tb.box.x >= img.box.x + img.box.w - 2) {
      dist = tb.box.x - (img.box.x + img.box.w); // beside it, to the right
    } else if (overlapX(tb.box, img.box) > 0 && tb.box.y >= img.box.y + img.box.h - 2) {
      dist = tb.box.y - (img.box.y + img.box.h); // under it
    }
    if (dist === null) return;
    // A few points either way is a tie; the earlier block wins.
    dist = Math.round(dist / 6);
    if (dist < bestDist) {
      bestPos = i;
      bestDist = dist;
    }
  });
  return bestPos;
}

/** The whole document as blocks with roles, per page, in a default order. */
export function structure(pages: ReadPage[]): Analysis {
  const body = bodySize(pages);
  const boldMatters = boldFraction(pages) < BOLD_SATURATION;
  const headingSizes = new Map<number, number>();
  const perPage: Block[][] = [];

  for (const page of pages) {
    const unit = page.lines.length ? medianHeight(page.lines.map((l) => l.box)) : 10;
    const leaves = readingOrder(
      page.lines.map((l, i): Item => [i, l.box]),
      unit,
    );
    const order = leaves.flat();
    const groups = groupLines(page.lines, order, body, boldMatters);
    const blocks: Block[] = [];
    groups.forEach((group, gi) => {
      const lines = group.map((i) => page.lines[i]);
      const first = lines[0];
      const box = lines.slice(1).reduce((b, l) => union(b, l.box), first.box);
      const { role, marker, rest } = markerOf(first.text);
      const text = [rest, ...lines.slice(1).map((l) => l.text)]
        .filter(Boolean)
        .join(" ")
        .trim();
      const block: Block = {
        id: `p${page.n}b${gi}`,
        kind: "text",
        page: page.n,
        box,
        lines: group,
        text,
        role: "para",
        level: 0,
        depth: 0,
        bold: lines.every((l) => l.bold),
        italic: lines.every((l) => l.italic),
        marker,
        size: first.size,
        font: first.font,
        picture: -1,
      };
      // The block links where its lines do, when they all point one way. A
      // paragraph with a link on part of it keeps only the words: a line is
      // the finest grain this reader ties a link to.
      if (lines[0].href && lines.every((l) => l.href === lines[0].href)) {
        block.href = lines[0].href;
      }
      if (!role && lines.every((l) => isHeading(l, body, boldMatters))) {
        block.role = "heading";
        const key = Math.round(first.size * 10) / 10;
        headingSizes.set(key, (headingSizes.get(key) ?? 0) + 1);
      } else if (role) {
        block.role = role;
      }
      blocks.push(block);
    });

    page.pictures.forEach((pic, pi) => {
      blocks.push({
        id: `p${page.n}i${pi}`,
        kind: "image",
        page: page.n,
        box: pic.box,
        lines: [],
        text: "",
        role: "image",
        level: 0,
        depth: 0,
        bold: false,
        italic: false,
        marker: "",
        size: 0,
        font: "",
        picture: pi,
      });
    });
    perPage.push(blocks);
  }

  // Heading levels: larger type is a higher level, document-wide. Sizes
  // within 8% of each other are one level (a 24pt and a 25pt title are the
  // same thing), and nothing goes deeper than h4 by default.
  const sizes = [...headingSizes.keys()].sort((a, b) => b - a);
  const levelOf = new Map<number, number>();
  let level = 0;
  let anchor: number | null = null;
  for (const sz of sizes) {
    if (anchor === null || sz < anchor * LEVEL_RATIO) {
      level += 1;
      anchor = sz;
    }
    levelOf.set(sz, Math.min(level, MAX_LEVEL));
  }

  const out: Page[] = pages.map((page, pi) => {
    const blocks = perPage[pi];
    const textBlocks = blocks.filter((b) => b.kind === "text");

    // List nesting by marker indent, judged within one column of the page:
    // a column is a run of non-heading blocks whose horizontal extents chain.
    const colOf = new Map<string, number>();
    let col = -1;
    let extent: [number, number] | null = null;
    for (const b of textBlocks) {
      if (b.role === "heading") continue;
      const right = b.box.x + b.box.w;
      if (extent === null || Math.min(extent[1], right) - Math.max(extent[0], b.box.x) <= 0) {
        col += 1;
        extent = [b.box.x, right];
      } else {
        extent = [Math.min(extent[0], b.box.x), Math.max(extent[1], right)];
      }
      colOf.set(b.id, col);
    }
    const indentsByCol = new Map<number, number[]>();
    for (const b of textBlocks) {
      if (!LIST_ROLES.includes(b.role)) continue;
      const c = colOf.get(b.id) ?? -1;
      // Pushed, not rebuilt: a page of 800 list items rebuilding this array
      // per item costs more than reading the page did.
      const indents = indentsByCol.get(c);
      if (indents) indents.push(Math.round(b.box.x));
      else indentsByCol.set(c, [Math.round(b.box.x)]);
    }
    for (const [c, v] of indentsByCol) indentsByCol.set(c, cluster(v));

    let item: Block | null = null;
    for (const b of textBlocks) {
      const indents = indentsByCol.get(colOf.get(b.id) ?? -1) ?? [];
      if (b.role === "heading") {
        b.level = levelOf.get(Math.round(b.size * 10) / 10) ?? (sizes.length || 1);
        item = null;
      } else if (LIST_ROLES.includes(b.role)) {
        // How many of the column's indents this one sits right of. They
        // come out of `cluster` ascending, so that count is where the item's
        // own indent falls among them.
        b.depth = bisect(indents, Math.round(b.box.x) - INDENT_TOLERANCE);
        item = b;
      } else if (
        item !== null &&
        !b.bold &&
        colOf.get(b.id) === colOf.get(item.id) &&
        b.box.x >= item.box.x + 2 &&
        b.size <= item.size + 0.6 &&
        b.box.y - (item.box.y + item.box.h) < 2.5 * Math.max(b.box.h, 1)
      ) {
        // A regular line under an item, indented: its detail.
        b.role = "bullet";
        b.depth = item.depth + 1;
      } else {
        item = null;
      }
    }

    // Default order: text blocks already in reading order; each picture
    // goes before the text nearest to it.
    const ordered: Block[] = [...textBlocks];
    for (const img of blocks) {
      if (img.kind === "image") ordered.splice(placePicture(ordered, img), 0, img);
    }
    return { ...page, blocks: ordered };
  });

  return { format: ANALYSIS_FORMAT, reader: READER, pages: out, bodySize: body };
}
