/** A benchmark's history: `results/<benchmark>.jsonl`, committed, a line a
 *  run. A line says what was scored (the tool and what it was made of, the
 *  commit), on what (the dataset's revision), by what (the scorer's
 *  version), and the two scores with each category under them -- enough to
 *  tell, of any two lines, whether their scores can be compared and what
 *  moved between them. */

import { execSync } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { revisionOf, type Benchmark } from "./manifest.ts";
import type { Score } from "./adapter.ts";
import type { Conversion } from "./tools.ts";

export interface Line {
  date: string;
  benchmark: string;
  revision: string;
  /** What the numbers are to be read with, for a benchmark not run as
   *  published. */
  label?: string;
  scorer: string;
  tool: string;
  /** What the tool was: mdgest's `READER` and pdf.js, a peer's version. */
  made: Conversion["made"];
  /** The commit of this repo the run was made from. */
  commit: string;
  pages: number;
  /** Pages over the time spent reading them, each document's own: with
   *  several browsers it is not their speed together. They slow one
   *  another all the same, so it compares between lines of one
   *  `browsers`. */
  pages_per_second: number;
  /** How many browsers read side by side, for mdgest since it was
   *  recorded: one for a small job, and for a long one a number set by
   *  the machine's cores. */
  browsers?: number;
  /** Inputs the tool could not convert, scored as empty. */
  unread: number;
  /** A hash of all the markdown: equal on two lines whose tools wrote the
   *  same thing. */
  markdown: string;
  /** Every input. */
  all: Score;
  /** The inputs with a text layer (`split.ts`). */
  text_layer: Score | null;
}

/** What is kept of a tool's last run of every input, beside its verdicts
 *  (`keptDir`), in the history or not: what was run, for the review
 *  report to say whose failures it shows, and each input's markdown hash,
 *  for it to tell whether the reader still writes what was scored. */
export interface KeptRun {
  date: string;
  /** The commit the run began at, and why no commit could give its score
   *  again, when none could: it is then not in the history. */
  commit: string;
  unrepeatable: string | null;
  scorer: string;
  made: Conversion["made"];
  hashes: Record<string, string>;
}

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const git = (args: string) =>
  execSync(`git ${args}`, { cwd: ROOT, encoding: "utf8" }).trim();

/** The commit checked out, and whether the tree is as that commit has it. */
export interface Tree {
  commit: string;
  dirty: boolean;
}

/** The tree now. The history itself is left out of the question: a run
 *  changes it. A run asks before it converts and again once it has
 *  scored, since mdgest is read from the working tree all the while. */
export function tree(): Tree {
  return {
    commit: git("rev-parse --short HEAD"),
    dirty:
      git("status --porcelain -- . ':(exclude)bench/accuracy/results'") !== "",
  };
}

export function line(
  b: Benchmark,
  scorer: string,
  tool: string,
  made: Conversion,
  all: Score,
  textLayer: Score | null,
  commit: string,
): Line {
  return {
    date: new Date().toISOString(),
    benchmark: b.name,
    revision: revisionOf(b),
    ...(b.label ? { label: b.label } : {}),
    scorer,
    tool,
    made: made.made,
    commit,
    pages: made.pages,
    // No time at all when nothing could be read.
    pages_per_second: made.seconds
      ? Number((made.pages / made.seconds).toFixed(1))
      : 0,
    ...(made.browsers ? { browsers: made.browsers } : {}),
    unread: Object.keys(made.errors).length,
    markdown: made.markdown,
    all,
    text_layer: textLayer,
  };
}

export async function append(b: Benchmark, entry: Line): Promise<string> {
  const at = fileURLToPath(new URL(`results/${b.name}.jsonl`, import.meta.url));
  await mkdir(dirname(at), { recursive: true });
  await appendFile(at, `${JSON.stringify(entry)}\n`);
  return at;
}

const percent = (value: number) => `${(value * 100).toFixed(1).padStart(5)}%`;

/** One cell of the table: the score, a category's tests, or a measure. */
function cell(score: Score | null, of?: string): string {
  if (!score) return "";
  if (!of)
    return score.score === undefined
      ? `        ${score.inputs} inputs`
      : `${percent(score.score)}  ${score.inputs} inputs`;
  const tally = score.categories?.[of];
  if (tally)
    return `${percent(tally.passed / tally.total)}  ${tally.passed}/${tally.total}`;
  const measure = score.measures?.[of];
  return measure === undefined ? "" : percent(measure);
}

/** The run, as a table: both sets of inputs, and each category or measure
 *  under them. */
export function show(entry: Line): string {
  const made = Object.entries(entry.made)
    .map(([key, value]) => `${key} ${value}`)
    .join(", ");
  const names = [
    ...Object.keys(entry.all.categories ?? {}),
    ...Object.keys(entry.all.measures ?? {}),
  ].sort();
  const rows = [
    ["", "all", "with a text layer"],
    ["score", cell(entry.all), cell(entry.text_layer)],
    ...names.map((name) => [
      `  ${name}`,
      cell(entry.all, name),
      cell(entry.text_layer, name),
    ]),
  ];
  const wide = Math.max(...rows.map(([name]) => name.length)) + 2;
  return [
    `${entry.benchmark}${entry.label ? ` (${entry.label})` : ""} at ${entry.revision
      .split("+")
      .map((revision) => revision.slice(0, 8))
      .join("+")}, ${entry.scorer}`,
    `${entry.tool} (${made}) at ${entry.commit}`,
    "",
    ...rows.map(([a, b, c]) =>
      `${a.padEnd(wide)}${b.padEnd(24)}${c}`.trimEnd(),
    ),
    "",
    `${entry.pages} pages at ${entry.pages_per_second} a second` +
      (entry.browsers && entry.browsers > 1
        ? ` each, in ${entry.browsers} browsers`
        : "") +
      (entry.unread ? `; ${entry.unread} could not be read` : "") +
      (entry.all.refused
        ? `; the scorer refused ${entry.all.refused}, scored as empty`
        : ""),
    `markdown ${entry.markdown.slice(0, 16)}`,
  ].join("\n");
}
