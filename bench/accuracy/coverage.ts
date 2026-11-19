/** How many of the letters and digits a PDF's text layer prints reach a
 *  tool's markdown: the fidelity check's count (`src/lib/letters.ts`) over a
 *  whole document, for any tool. Reported beside the scores, not held to
 *  anything.
 *
 *  Held against the text layer mdgest's converter writes beside its
 *  markdown (`<input>.txt`): pdf.js's text as the PDF carries it, before
 *  the reader cleans or groups any of it. So a picture face's bullet
 *  that pdf.js reports as `l` is a letter expected here, of every tool
 *  alike; and an ordered list's `a.` that mdgest writes as `1.` is one
 *  mdgest does not carry. Neither moves the number much, and both are the
 *  same from run to run. The markdown is read as text, markup gone, the
 *  same way for every tool. A page with no text layer expects nothing. */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { carriedOf, lettersOf, textOf } from "../../src/lib/letters.ts";
import { stem } from "./job.ts";

/** Letters expected and carried, over a set of inputs. */
export interface Tally {
  expected: number;
  carried: number;
}

/** Each input's tally: `<input>.txt` in `layers` against `<input>.md` in
 *  `out`. An input with no text layer written is left out. */
export async function tallies(
  layers: string,
  out: string,
  files: string[],
): Promise<Record<string, Tally>> {
  const each: Record<string, Tally> = {};
  for (const file of files) {
    const layerAt = join(layers, `${stem(file)}.txt`);
    if (!existsSync(layerAt)) continue;
    const expected = lettersOf(await readFile(layerAt, "utf8"));
    const markdownAt = join(out, `${stem(file)}.md`);
    const markdown = existsSync(markdownAt)
      ? await readFile(markdownAt, "utf8")
      : "";
    let want = 0;
    for (const n of expected.values()) want += n;
    each[file] = {
      expected: want,
      carried: carriedOf(expected, lettersOf(textOf(markdown))),
    };
  }
  return each;
}

/** The share of `files`' letters carried, pooled over them: null when
 *  none of them prints any. */
export function coverage(
  each: Record<string, Tally>,
  files: string[],
): number | null {
  let expected = 0;
  let carried = 0;
  for (const file of files) {
    const tally = each[file];
    if (!tally) continue;
    expected += tally.expected;
    carried += tally.carried;
  }
  return expected === 0 ? null : carried / expected;
}
