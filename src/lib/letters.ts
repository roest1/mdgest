/** Letters and digits counted: what the fidelity check (`fidelity.ts`)
 *  compares a page and its markdown by, and the benchmarks' coverage
 *  (`bench/accuracy/coverage.ts`) a text layer and any tool's markdown.
 *
 *  Apart from `fidelity.ts` so the benchmarks' scripts, checked as Node
 *  modules, import nothing of the app's but this and `hast.ts`, which
 *  import only packages. */

import type { ElementContent, Root, RootContent } from "hast";
import { toHast } from "./hast.ts";

/** The letters and digits a coverage counts, case folded. */
const COUNTED = /[\p{L}\p{N}]/gu;
/** A word, for a list of what is missing. */
const WORD = /[\p{L}\p{N}]+/gu;

export type Counts = Map<string, number>;

/** The letters and digits of `text`, case folded, and how many of each. */
export function lettersOf(text: string): Counts {
  const counts: Counts = new Map();
  for (const [c] of text.toLowerCase().matchAll(COUNTED))
    counts.set(c, (counts.get(c) ?? 0) + 1);
  return counts;
}

/** The words of `text`, case folded, in order. */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().match(WORD) ?? [];
}

/** `from` added into `into`, or taken out of it with `sign` -1: a count
 *  that reaches nothing is gone. */
export function add(
  into: Counts,
  from: Iterable<[string, number]>,
  sign = 1,
): void {
  for (const [key, n] of from) {
    const left = (into.get(key) ?? 0) + sign * n;
    if (left > 0) into.set(key, left);
    else into.delete(key);
  }
}

export function total(counts: Counts): number {
  let n = 0;
  for (const v of counts.values()) n += v;
  return n;
}

/** How many of `expected` `got` carries. */
export function carriedOf(expected: Counts, got: Counts): number {
  let n = 0;
  for (const [key, want] of expected) n += Math.min(want, got.get(key) ?? 0);
  return n;
}

/** The text of a tree as a reader of the rendered markdown sees it: every
 *  text node, a space between. Attributes -- a figure's alt text, a link's
 *  target -- are not text. */
function textIn(nodes: (RootContent | ElementContent)[], into: string[]): void {
  for (const node of nodes) {
    if (node.type === "text") into.push(node.value);
    else if (node.type === "element") textIn(node.children, into);
  }
}

/** `markdown`'s text, as the pane renders it: comments and markup gone. */
export function textOf(markdown: string): string {
  const tree: Root = toHast(markdown);
  const into: string[] = [];
  textIn(tree.children, into);
  return into.join(" ");
}
