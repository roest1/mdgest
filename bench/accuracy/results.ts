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
import type { Benchmark } from "./manifest.ts";
import type { Score } from "./olmocr/adapter.ts";
import type { Conversion } from "./tools.ts";

export interface Line {
  date: string;
  benchmark: string;
  revision: string;
  scorer: string;
  tool: string;
  /** What the tool was: mdgest's `READER` and pdf.js, a peer's version. */
  made: Conversion["made"];
  /** The commit of this repo the run was made from. */
  commit: string;
  pages: number;
  pages_per_second: number;
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

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const git = (args: string) =>
  execSync(`git ${args}`, { cwd: ROOT, encoding: "utf8" }).trim();

/** The commit checked out, and whether the tree is as that commit has it.
 *  The history itself is left out of the question: a run changes it. */
export function tree(): { commit: string; dirty: boolean } {
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
): Line {
  return {
    date: new Date().toISOString(),
    benchmark: b.name,
    revision: b.revision,
    scorer,
    tool,
    made: made.made,
    commit: tree().commit,
    pages: made.pages,
    pages_per_second: Number((made.pages / made.seconds).toFixed(1)),
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

const percent = (score: Score | null, of?: string) => {
  if (!score) return "";
  const tally = of ? score.categories[of] : null;
  if (of && !tally) return "";
  const value = tally ? tally.passed / tally.total : score.score;
  const count = tally
    ? `${tally.passed}/${tally.total}`
    : `${score.inputs} pages`;
  return `${(value * 100).toFixed(1).padStart(5)}%  ${count}`;
};

/** The run, as a table: both scores, and each category under them. */
export function show(entry: Line): string {
  const made = Object.entries(entry.made)
    .map(([key, value]) => `${key} ${value}`)
    .join(", ");
  const rows = [
    ["", "all pages", "text-layer pages"],
    ["score", percent(entry.all), percent(entry.text_layer)],
    ...Object.keys(entry.all.categories)
      .sort()
      .map((name) => [
        `  ${name}`,
        percent(entry.all, name),
        percent(entry.text_layer, name),
      ]),
  ];
  return [
    `${entry.benchmark} at ${entry.revision.slice(0, 8)}, ${entry.scorer}`,
    `${entry.tool} (${made}) at ${entry.commit}`,
    "",
    ...rows.map(([a, b, c]) => `${a.padEnd(20)}${b.padEnd(24)}${c}`.trimEnd()),
    "",
    `${entry.pages} pages at ${entry.pages_per_second} a second` +
      (entry.unread ? `; ${entry.unread} could not be read` : ""),
    `markdown ${entry.markdown.slice(0, 16)}`,
  ].join("\n");
}
