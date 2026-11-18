/** olmOCR-bench: what its data holds, and its own scorer run over a tool's
 *  markdown.
 *
 *  The data is one single-page PDF per input and, in a `.jsonl` per
 *  category, the unit tests each must pass: text that must be present or
 *  absent, two stretches in order, a table cell and its neighbours, a
 *  formula. The scorer -- `olmocr.bench.benchmark`, pinned in
 *  `pyproject.toml` -- wants a folder with those `.jsonl` files, the PDFs
 *  under `pdfs/`, and a folder per tool holding
 *  `<input>_pg1_repeat1.md`. It adds a "baseline" test of its own for
 *  every PDF, runs them all, and prints how many passed in each file; the
 *  score is the mean of those pass rates.
 *
 *  Nothing here decides a pass. The folder is laid out, the scorer is run,
 *  and what it printed is read back -- and checked against the average it
 *  printed itself. */

import { existsSync, writeFileSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Input, Score, Scored, Tally, Verdict } from "../adapter.ts";
import { envDir, workDir } from "../cache.ts";
import type { Benchmark } from "../manifest.ts";
import { python, scorerOf } from "../python.ts";
import type { Quote } from "../split.ts";
import { stem } from "../tools.ts";

const PROJECT = "olmocr";

/** A test as its `.jsonl` line has it; only the fields read here. */
interface Test {
  pdf: string;
  id: string;
  math?: string;
  page: number;
  type: "present" | "absent" | "order" | "table" | "math" | "baseline";
  max_diffs?: number;
  text?: string;
  before?: string;
  after?: string;
  cell?: string;
  up?: string | null;
  down?: string | null;
  left?: string | null;
  right?: string | null;
  top_heading?: string | null;
  left_heading?: string | null;
}

/** What a test looks for, in a line. */
function wants(test: Test): string {
  const quote = (text?: string | null) => JSON.stringify(text ?? "");
  if (test.type === "present") return `${quote(test.text)} present`;
  if (test.type === "absent") return `${quote(test.text)} absent`;
  if (test.type === "order")
    return `${quote(test.before)} before ${quote(test.after)}`;
  if (test.type === "table") {
    const near = (["up", "down", "left", "right"] as const)
      .filter((side) => test[side])
      .map((side) => `${side} ${quote(test[side])}`);
    if (test.top_heading) near.push(`under ${quote(test.top_heading)}`);
    if (test.left_heading) near.push(`beside ${quote(test.left_heading)}`);
    return `cell ${quote(test.cell)}${near.length ? `, ${near.join(", ")}` : ""}`;
  }
  if (test.type === "math") return `formula ${test.math ?? ""}`;
  return "text, and not the same thing over and over";
}

/** A category: its `.jsonl`, line by line, each with the test it parses to. */
interface Category {
  name: string;
  lines: { text: string; test: Test }[];
}

async function categories(data: string): Promise<Category[]> {
  const dir = join(data, "bench_data");
  const names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl")).sort();
  return Promise.all(
    names.map(async (name) => ({
      name: name.replace(/\.jsonl$/, ""),
      lines: (await readFile(join(dir, name), "utf8"))
        .split("\n")
        .filter((line) => line.trim())
        .map((text) => ({ text, test: JSON.parse(text) as Test })),
    })),
  );
}

export const pdfs = (data: string) => join(data, "bench_data", "pdfs");

/** Every input, sorted. */
export async function inputs(data: string): Promise<Input[]> {
  const seen = new Map<string, string>();
  for (const { name, lines } of await categories(data))
    for (const { test } of lines) {
      if (test.page !== 1)
        throw new Error(
          `${test.pdf}: a test on page ${test.page} of a one-page input`,
        );
      seen.set(test.pdf, name);
    }
  return [...seen]
    .map(([file, category]) => ({ file, category }))
    .sort((a, z) => (a.file < z.file ? -1 : 1));
}

/** What each input's tests quote from its page, for the text-layer split:
 *  the text of a present or an absent test (an absent one names a header
 *  or footer that is printed and should be left out), both stretches of
 *  an order test, and a table test's cell and neighbours. A formula is not
 *  quoted: its LaTeX is not text the page prints. */
export async function quoted(data: string): Promise<Map<string, Quote[]>> {
  const quotes = new Map<string, Quote[]>();
  for (const { lines } of await categories(data))
    for (const { test } of lines) {
      const texts =
        test.type === "present" || test.type === "absent"
          ? [test.text]
          : test.type === "order"
            ? [test.before, test.after]
            : test.type === "table"
              ? [
                  test.cell,
                  test.up,
                  test.down,
                  test.left,
                  test.right,
                  test.top_heading,
                  test.left_heading,
                ]
              : [];
      const list = quotes.get(test.pdf) ?? [];
      for (const text of texts)
        if (text) list.push({ text, slack: test.max_diffs });
      quotes.set(test.pdf, list);
    }
  return quotes;
}

/** The scorer, with the Chromium it renders formulas in: fetched once into
 *  Playwright's own cache. */
function scorer(b: Benchmark): string {
  const name = scorerOf(b, PROJECT);
  const marker = join(envDir(PROJECT), ".chromium");
  if (!existsSync(marker)) {
    python(PROJECT, ["-m", "playwright", "install", "chromium"], true);
    writeFileSync(marker, "");
  }
  return name;
}

/** The scorer's last summary of `tool`, read back. */
function parse(printed: string, tool: string): Omit<Score, "inputs"> {
  const summary = printed.slice(printed.lastIndexOf("Final Summary"));
  const average = new RegExp(
    `^${tool}\\s*: Average Score: (.+?) \\(average of per-JSONL scores\\)`,
    "m",
  ).exec(summary)?.[1];
  const said = /^(\d+(?:\.\d+)?)%/.exec(average ?? "")?.[1];
  if (!said)
    throw new Error(
      `the scorer gave no score for ${tool}: ${average ?? printed.slice(-2000)}`,
    );
  const cats: Record<string, Tally> = {};
  for (const [, name, passed, total] of summary.matchAll(
    /^\s+(\S+?)(?:\.jsonl)?\s*: \d+(?:\.\d+)?% \((\d+)\/(\d+) tests\)$/gm,
  ))
    cats[name] = { passed: Number(passed), total: Number(total) };
  const tallies = Object.values(cats);
  const score =
    tallies.reduce((sum, t) => sum + t.passed / t.total, 0) / tallies.length;
  // The scorer prints its average to one decimal; ours must round to it.
  if (!tallies.length || Math.abs(score * 100 - Number(said)) > 0.0500001)
    throw new Error(
      `the scorer's average is ${said}%, its categories come to ${(score * 100).toFixed(3)}%`,
    );
  return {
    score,
    tests: tallies.reduce((sum, t) => sum + t.total, 0),
    categories: cats,
  };
}

/** Score `tool`'s markdown, in `out`, on `files`: the folder laid out as
 *  the scorer wants it, with only those inputs and their tests, and the
 *  scorer run on it. `set` names the folder -- one per set of pages, so
 *  what the scorer was given and what it printed stay to be looked at. */
export async function score(
  b: Benchmark,
  data: string,
  tool: string,
  out: string,
  files: string[],
  set: string,
): Promise<Scored> {
  const version = scorer(b);
  const work = workDir(b, tool, set);
  await rm(work, { recursive: true, force: true });
  const wanted = new Set(files);
  for (const { name, lines } of await categories(data)) {
    const kept = lines.filter(({ test }) => wanted.has(test.pdf));
    if (!kept.length) continue;
    await mkdir(work, { recursive: true });
    await writeFile(
      join(work, `${name}.jsonl`),
      `${kept.map((line) => line.text).join("\n")}\n`,
    );
  }
  for (const file of files) {
    const pdf = join(work, "pdfs", file);
    const md = join(work, tool, `${stem(file)}_pg1_repeat1.md`);
    await mkdir(dirname(pdf), { recursive: true });
    await mkdir(dirname(md), { recursive: true });
    await symlink(join(pdfs(data), file), pdf);
    await copyFile(join(out, `${stem(file)}.md`), md);
  }
  const printed = python(PROJECT, [
    "-m",
    "olmocr.bench.benchmark",
    "--dir",
    work,
    "--candidate",
    tool,
  ]);
  await writeFile(join(work, "scorer.txt"), printed);

  // Each test's verdict: the scorer prints the ones that failed, and why.
  const failed = new Map<string, string>();
  for (const [, id, why] of printed.matchAll(
    /^\s*\[FAIL\] Test (\S+) on .*? Ex: (.*)$/gm,
  ))
    failed.set(id, why);
  const verdicts: Verdict[] = [];
  const tested = new Set<string>();
  for (const { name, lines } of await categories(data))
    for (const { test } of lines) {
      if (!wanted.has(test.pdf)) continue;
      if (test.type === "baseline") tested.add(test.pdf);
      verdicts.push({
        file: test.pdf,
        id: test.id,
        type: test.type,
        category: name,
        wants: wants(test),
        passed: !failed.has(test.id),
        why: failed.get(test.id),
      });
    }
  // The baseline test the scorer adds for a PDF that has none of its own.
  for (const file of files) {
    if (tested.has(file)) continue;
    const id = `${file}_baseline`;
    verdicts.push({
      file,
      id,
      type: "baseline",
      category: "baseline",
      wants: "text, and not the same thing over and over",
      passed: !failed.has(id),
      why: failed.get(id),
    });
  }
  const parsed = parse(printed, tool);
  // The verdicts are read off the lines the scorer prints for a failure;
  // its own count of each file's tests says whether every one was read.
  for (const [name, tally] of Object.entries(parsed.categories ?? {})) {
    const mine = verdicts.filter((verdict) => verdict.category === name);
    const passed = mine.filter((verdict) => verdict.passed).length;
    if (passed !== tally.passed || mine.length !== tally.total)
      throw new Error(
        `the scorer has ${tally.passed} of ${tally.total} tests passed in ${name}; the failures it printed come to ${passed} of ${mine.length}`,
      );
  }
  return { ...parsed, inputs: files.length, scorer: version, verdicts };
}
