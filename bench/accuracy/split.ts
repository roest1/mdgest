/** Which pages a reader can get right without OCR: the text-layer split.
 *
 *  mdgest reads the text a PDF carries and cannot read words that are only
 *  pixels, so a scan scores about zero whatever the reader does. Each
 *  benchmark is therefore scored twice: on every page, and on the pages
 *  whose own text layer holds at least `TEXT_LAYER_CUTOFF` of what the page
 *  should say. This file decides which pages those are.
 *
 *  What a page should say comes from its benchmark (the adapter's
 *  `quoted`): the text its tests or its ground truth quote from the page.
 *  What the PDF carries is the text pdf.js finds in it, as the converter
 *  writes it beside the markdown -- before the reader has touched it, so a
 *  change to the reader never moves a page across the line.
 *
 *  The split is made once for a pinned revision and committed with the
 *  results (`results/<benchmark>.text-layer.json`), so every run and every
 *  tool is scored on the same pages. */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEXT_LAYER_CUTOFF, type Benchmark } from "./manifest.ts";
import { stem } from "./tools.ts";

/** A stretch of text a page should hold. */
export interface Quote {
  text: string;
  /** How many characters of it may differ, when its test says. */
  slack?: number;
}

/** A page whose benchmark quotes none of its text -- one tested only on
 *  its formulas, whose LaTeX is not text the page prints -- has nothing to
 *  hold its text layer against. It counts as having one when the layer has
 *  at least this many letters and digits: a scan has none at all, and a
 *  printed page has thousands. */
export const UNQUOTED_MIN = 200;

/** One edit in this many characters still counts as the quote being there:
 *  a text layer spells a dash, an accent or a ligature its own way. */
const SLACK_EVERY = 10;

export interface Split {
  benchmark: string;
  revision: string;
  /** The pdf.js whose reading of the text layers this was made from. */
  pdfjs: string;
  cutoff: number;
  /** Every input counted, and how many of them are in. */
  inputs: number;
  /** The inputs with a text layer, sorted. */
  pages: string[];
}

/** Letters and digits only, lower-cased, accents off: what is left the
 *  same however the spaces, hyphens and punctuation were set. */
export function plain(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** The fewest edits that turn `needle` into some stretch of `hay`, or
 *  `limit + 1` when it would take more than `limit`. */
function nearest(needle: string, hay: string, limit: number): number {
  if (hay.includes(needle)) return 0;
  if (limit === 0) return 1;
  const m = needle.length;
  let prev = Uint32Array.from({ length: m + 1 }, (_, i) => i);
  let cur = new Uint32Array(m + 1);
  let best = limit + 1;
  for (let j = 0; j < hay.length; j++) {
    const c = hay.charCodeAt(j);
    cur[0] = 0;
    for (let i = 1; i <= m; i++) {
      const swap = prev[i - 1] + (needle.charCodeAt(i - 1) === c ? 0 : 1);
      cur[i] = Math.min(swap, prev[i] + 1, cur[i - 1] + 1);
    }
    if (cur[m] < best) best = cur[m];
    [prev, cur] = [cur, prev];
  }
  return best;
}

/** The share of `quotes` that `layer` holds, or null when there are none
 *  with a letter or digit in them. */
export function share(layer: string, quotes: Quote[]): number | null {
  const hay = plain(layer);
  let found = 0;
  let counted = 0;
  for (const quote of quotes) {
    const needle = plain(quote.text);
    if (!needle) continue;
    counted++;
    const limit = Math.max(
      quote.slack ?? 0,
      Math.floor(needle.length / SLACK_EVERY),
    );
    if (nearest(needle, hay, limit) <= limit) found++;
  }
  return counted ? found / counted : null;
}

/** Whether a page with this text layer and these quotes is one a reader
 *  can get right without OCR. */
export function hasTextLayer(layer: string, quotes: Quote[]): boolean {
  const held = share(layer, quotes);
  return held === null
    ? plain(layer).length >= UNQUOTED_MIN
    : held >= TEXT_LAYER_CUTOFF;
}

const splitPath = (b: Benchmark) =>
  fileURLToPath(new URL(`results/${b.name}.text-layer.json`, import.meta.url));

/** The split committed for `b`'s revision, if there is one. */
export async function storedSplit(b: Benchmark): Promise<Split | null> {
  const at = splitPath(b);
  if (!existsSync(at)) return null;
  const split = JSON.parse(await readFile(at, "utf8")) as Split;
  return split.revision === b.revision && split.cutoff === TEXT_LAYER_CUTOFF
    ? split
    : null;
}

/** Make and write the split for `b`: `quoted` says what each input should
 *  hold, and `layers` is the folder the converter left each input's text
 *  layer in. */
export async function makeSplit(
  b: Benchmark,
  quoted: Map<string, Quote[]>,
  layers: string,
  pdfjs: string,
): Promise<Split> {
  const pages: string[] = [];
  for (const [file, quotes] of quoted) {
    const at = join(layers, `${stem(file)}.txt`);
    // No text layer written: the document could not be opened at all.
    const layer = existsSync(at) ? await readFile(at, "utf8") : "";
    if (hasTextLayer(layer, quotes)) pages.push(file);
  }
  const split: Split = {
    benchmark: b.name,
    revision: b.revision,
    pdfjs,
    cutoff: TEXT_LAYER_CUTOFF,
    inputs: quoted.size,
    pages: pages.sort(),
  };
  const at = splitPath(b);
  await mkdir(dirname(at), { recursive: true });
  await writeFile(at, `${JSON.stringify(split, null, 2)}\n`);
  return split;
}
