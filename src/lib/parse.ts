/** The markdown's pages as trees: parsed once each, kept while their
 *  document is open, and parsed ahead of the view in workers.
 *
 * A book's pages take seconds to parse, a few milliseconds each (#52, #55),
 * and a tree takes a fraction of that to render. So the rendered view draws
 * its first frame from pages parsed here, on the page's thread -- what fits
 * in that frame, which for most documents is all of them -- and asks
 * `parseAhead` for the rest: workers, as many as the work left is worth,
 * each handed a few pages at a time from the front of the view's order, so
 * a page jumped to is the next one parsed rather than waiting behind the
 * book. A short document never starts one.
 *
 * Kept by the page's text, so the rendered and raw views swapped back and
 * forth, or a document edited, parse only the pages whose text is new.
 * What is kept goes with the document's tab (`releaseParsed`). The pool
 * goes with the last document that used it, or with the editor. A worker
 * that fails takes the pool with it, and every page is then parsed on the
 * page's thread, as before there were workers: slower, never wrong. */

import type { Root } from "hast";
import { toHast } from "./hast";

/** A batch of pages to parse, as the worker is sent it. */
export interface ParseAsk {
  id: number;
  texts: string[];
}

/** The worker's answer: the batch's trees in its order, or why not. */
export type ParseAnswer =
  | { id: number; ok: true; trees: Root[] }
  | { id: number; ok: false; message: string };

/** About how long a character of a book's markdown takes to parse, in ms:
 *  measured on a 1,404-page textbook, 7.2 s over 4.24 MB. What the pool is
 *  sized by, before any of the document has been parsed. */
const PARSE_MS_PER_CHAR = 0.0017;
/** How much parsing a worker is started for, in ms: about what one costs to
 *  start and warm (30 ms) many times over. Work left under this is one
 *  worker's; a book's is as many as there may be. */
const MS_PER_WORKER = 250;
/** About how much of the markdown one batch carries, in characters: a few
 *  pages, a few milliseconds of a worker's time. Small enough that a page
 *  jumped to waits for one batch at most; big enough that the message
 *  either way is a small part of it. */
const BATCH_CHARS = 8_000;
/** How long after a batch lands the view is told, at most, in ms: a frame.
 *  Told for every batch, the view rendered its list of pages anew a
 *  hundred times a second for pages it could have drawn together. */
const WAKE_MS = 16;

// ---- what is kept, by document -------------------------------------------

interface Held {
  /** By a page's text, its tree. */
  trees: Map<string, Root>;
  /** Texts a worker has, not answered yet. */
  flying: Set<string>;
  /** Texts a worker could not parse: drawn as parsed on the page's thread,
   *  which says why as react-markdown would have. */
  failed: Set<string>;
}

const held = new Map<string, Held>();

function heldFor(docId: string): Held {
  let h = held.get(docId);
  if (!h) {
    h = { trees: new Map(), flying: new Set(), failed: new Set() };
    held.set(docId, h);
  }
  return h;
}

/** `text`'s tree, a page of `docId`'s markdown: the one kept, or parsed now
 *  and kept. */
export function treeOf(docId: string, text: string): Root {
  const h = heldFor(docId);
  let tree = h.trees.get(text);
  if (!tree) {
    tree = toHast(text);
    h.trees.set(text, tree);
  }
  return tree;
}

/** Whether `text` can be drawn without waiting on a worker: it is parsed,
 *  or no worker is going to parse it. */
export function ready(docId: string, text: string): boolean {
  if (broken) return true;
  const h = held.get(docId);
  return !!h && (h.trees.has(text) || h.failed.has(text));
}

/** Let go of `docId`'s trees, for when its tab closes. A batch still out
 *  for it lands on nothing; with no document left, the pool goes too. */
export function releaseParsed(docId: string): void {
  held.delete(docId);
  if (source?.docId === docId) stopSource();
  if (held.size === 0) stopPool();
}

/** Let go of every document's trees, and the pool: for when the editor
 *  goes. */
export function releaseAllParsed(): void {
  held.clear();
  stopSource();
  stopPool();
}

// ---- the pool -------------------------------------------------------------

interface Slot {
  worker: Worker;
  busy: boolean;
}

const slots: Slot[] = [];
const answers = new Map<number, (answer: ParseAnswer) => void>();
let sequence = 0;
/** Set when a worker could not start or failed: every page is parsed on
 *  the page's thread from then until the pool is let go. */
let broken = false;

/** As many workers as the machine has cores to spare, up to four: a core
 *  is kept for the page, and a book on four parses in a third of the time
 *  one takes, more than that in little less. One on a machine of one or
 *  two, which keeps the page's thread free and parses no slower. */
function most(): number {
  const cores = navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(4, cores - 1));
}

function spawn(): void {
  const worker = new Worker(new URL("./hast.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = ({ data }: MessageEvent<ParseAnswer>) => {
    const answered = answers.get(data.id);
    answers.delete(data.id);
    answered?.(data);
  };
  // A worker whose script fails to load says so here and nowhere else.
  worker.onerror = (event) => {
    event.preventDefault();
    fail(`a markdown worker failed: ${event.message || "it did not start"}`);
  };
  slots.push({ worker, busy: false });
}

/** Grow the pool to `wanted` workers, as far as `most` allows. */
function grow(wanted: number): void {
  try {
    while (slots.length < Math.min(wanted, most())) spawn();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function stopPool(): void {
  for (const { worker } of slots) worker.terminate();
  slots.length = 0;
  answers.clear();
  for (const h of held.values()) h.flying.clear();
  broken = false;
}

/** The pool is given up: what was out is parsed on the page's thread when
 *  it is drawn, and the view is told so it draws. */
function fail(why: string): void {
  if (broken) return;
  console.warn(`${why}; the markdown is parsed on the page's thread instead`);
  stopPool();
  broken = true;
  wake();
}

// ---- parsing ahead --------------------------------------------------------

interface Source {
  docId: string;
  order: () => Iterable<string>;
  wake: () => void;
}

/** The view parsing ahead: the one on screen. */
let source: Source | null = null;
let waking: ReturnType<typeof setTimeout> | null = null;

function stopSource(): void {
  source = null;
  if (waking !== null) clearTimeout(waking);
  waking = null;
}

/** Tell the view, within a frame, that more is ready: once for every batch
 *  landed in that time. */
function wake(): void {
  if (!source || waking !== null) return;
  const { wake: told } = source;
  waking = setTimeout(() => {
    waking = null;
    told();
  }, WAKE_MS);
}

/** Parse `docId`'s pages ahead in workers, in the order `order` gives their
 *  texts -- asked each time a worker is free, so it is what is wanted at
 *  that moment -- and call `wake` as they land. The pool is sized to what
 *  is left to parse when this is called. One view parses ahead at a time:
 *  this replaces the last. Returns how to stop; what is out still lands,
 *  and is kept. */
export function parseAhead(
  docId: string,
  order: () => Iterable<string>,
  wake: () => void,
): () => void {
  stopSource();
  const mine: Source = { docId, order, wake };
  source = mine;
  if (!broken) {
    const h = heldFor(docId);
    let left = 0;
    for (const text of order())
      if (!h.trees.has(text) && !h.flying.has(text)) left += text.length;
    if (left > 0) grow(Math.ceil((left * PARSE_MS_PER_CHAR) / MS_PER_WORKER));
    drive();
  }
  return () => {
    if (source === mine) stopSource();
  };
}

/** Hand each free worker the next batch the view wants. */
function drive(): void {
  if (!source || broken) return;
  const { docId } = source;
  const h = heldFor(docId);
  for (const slot of slots) {
    if (slot.busy) continue;
    const texts: string[] = [];
    let size = 0;
    for (const text of source.order()) {
      if (h.trees.has(text) || h.flying.has(text) || h.failed.has(text))
        continue;
      // Two pages that say the same thing are one tree.
      if (texts.includes(text)) continue;
      texts.push(text);
      size += text.length;
      if (size >= BATCH_CHARS) break;
    }
    if (texts.length === 0) return;
    send(slot, docId, h, texts);
  }
}

function send(slot: Slot, docId: string, h: Held, texts: string[]): void {
  const id = ++sequence;
  slot.busy = true;
  for (const text of texts) h.flying.add(text);
  answers.set(id, (answer) => {
    slot.busy = false;
    for (const text of texts) h.flying.delete(text);
    // Kept only while the document is: let go meanwhile, `h` is no one's.
    if (held.get(docId) === h) {
      if (answer.ok)
        answer.trees.forEach((tree, i) => h.trees.set(texts[i], tree));
      else for (const text of texts) h.failed.add(text);
      if (source?.docId === docId) wake();
    }
    drive();
  });
  slot.worker.postMessage({ id, texts } satisfies ParseAsk);
}
