/** fr-bench-pdf2md: what its data holds, and its own scorer run over a
 *  tool's markdown.
 *
 *  The data is a folder per input under `pdfs/<group>/`: one single-page
 *  French PDF, its `metadata.json`, and its tests in `.jsonl` files -- the
 *  olmOCR-bench kinds without formulas: text that must be present, two
 *  stretches in order, a table cell and its neighbours. Each test names
 *  its category, and an input's tests all name the same one.
 *
 *  The scorer, benchpdf2md, is pinned in `pyproject.toml` to a commit of
 *  its repository. It scores vlmparse documents rather than markdown
 *  files, so `score.py` wraps each input's markdown in one and calls the
 *  scorer's own entry point. Its score is the share of all tests passed,
 *  its own "baseline" checks left out; the categories, baseline among
 *  them, are reported as it reports them. */

import { readFile, readdir, rm, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Input, Score, Tally } from "../adapter.ts";
import { workDir } from "../cache.ts";
import type { Benchmark } from "../manifest.ts";
import { python, scorerOf } from "../python.ts";
import type { Quote } from "../split.ts";

const PROJECT = "fr-bench";

/** A test as its `.jsonl` line has it; only the fields read here. */
interface Test {
  type: "present" | "absent" | "order" | "table";
  category: string;
  max_diffs?: number;
  text?: string;
  before?: string;
  after?: string;
  cell?: string;
  up?: string;
  down?: string;
  left?: string;
  right?: string;
  top_heading?: string;
  left_heading?: string;
}

export const pdfs = (data: string) => join(data, "pdfs");

/** Every input's tests, by its PDF's path under `pdfs()`. */
async function tests(data: string): Promise<Map<string, Test[]>> {
  const files = await readdir(pdfs(data), { recursive: true });
  const byDir = new Map<string, { pdf?: string; tests: Test[] }>();
  for (const file of files) {
    const dir = dirname(file);
    const entry = byDir.get(dir) ?? { tests: [] };
    byDir.set(dir, entry);
    if (file.endsWith(".pdf")) {
      if (entry.pdf) throw new Error(`${dir} holds more than one PDF`);
      entry.pdf = file;
    } else if (file.endsWith(".jsonl"))
      for (const line of (await readFile(join(pdfs(data), file), "utf8")).split(
        "\n",
      ))
        if (line.trim()) entry.tests.push(JSON.parse(line) as Test);
  }
  const found = new Map<string, Test[]>();
  for (const { pdf, tests } of byDir.values()) if (pdf) found.set(pdf, tests);
  return found;
}

export async function inputs(data: string): Promise<Input[]> {
  return [...(await tests(data))]
    .map(([file, list]) => {
      const categories = new Set(list.map((test) => test.category));
      if (categories.size !== 1)
        throw new Error(
          `${file}: its tests name ${categories.size} categories, not one`,
        );
      return { file, category: list[0].category };
    })
    .sort((a, z) => (a.file < z.file ? -1 : 1));
}

/** What each input's tests quote from its page: a present test's text,
 *  both stretches of an order test, a table test's cell and neighbours. */
export async function quoted(data: string): Promise<Map<string, Quote[]>> {
  const quotes = new Map<string, Quote[]>();
  for (const [file, list] of await tests(data))
    quotes.set(
      file,
      list.flatMap((test) =>
        [
          test.text,
          test.before,
          test.after,
          test.cell,
          test.up,
          test.down,
          test.left,
          test.right,
          test.top_heading,
          test.left_heading,
        ].flatMap((text) => (text ? [{ text, slack: test.max_diffs }] : [])),
      ),
    );
  return quotes;
}

/** What `score.py` leaves: the scorer's `metrics.json`, and each
 *  category's tests counted. */
interface Summary {
  metrics: { avg_result: number; num_tests: number } & Record<string, unknown>;
  categories: Record<string, Tally>;
}

export async function score(
  b: Benchmark,
  data: string,
  tool: string,
  out: string,
  files: string[],
  set: string,
): Promise<Score & { scorer: string }> {
  const scorer = scorerOf(b, PROJECT);
  const work = workDir(b, tool, set);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const job = join(work, "job.json");
  await writeFile(
    job,
    JSON.stringify({ pdfs: pdfs(data), out, files, work, tool }),
  );
  await writeFile(
    join(work, "scorer.txt"),
    python(PROJECT, [fileURLToPath(new URL("score.py", import.meta.url)), job]),
  );
  const { metrics, categories } = JSON.parse(
    await readFile(join(work, "summary.json"), "utf8"),
  ) as Summary;

  // The scorer's average is over every test but its own baseline checks;
  // the counts must come to it, and to each category's mean it wrote down.
  const { baseline, ...tested } = categories;
  const tallies = Object.values(tested);
  const passed = tallies.reduce((sum, t) => sum + t.passed, 0);
  const total = tallies.reduce((sum, t) => sum + t.total, 0);
  const agree = (mean: unknown, tally: Tally) =>
    typeof mean === "number" &&
    Math.abs(mean - tally.passed / tally.total) < 1e-9;
  if (
    !baseline ||
    !agree(metrics.avg_result, { passed, total }) ||
    !Object.entries(categories).every(([name, t]) => agree(metrics[name], t))
  )
    throw new Error(
      `the scorer's metrics.json and its test results disagree: see ${work}`,
    );
  return {
    score: metrics.avg_result,
    inputs: files.length,
    tests: total,
    categories,
    scorer,
  };
}
