/** OmniDocBench: what its data holds, and its own evaluator run over a
 *  tool's markdown.
 *
 *  Not the benchmark as published. v1.6 is 1,651 pages, given as images;
 *  mdgest reads PDFs. v1.0 published its 981 pages as the PDFs they were
 *  cut from, so those are the inputs, scored against v1.6's ground truth
 *  for the same pages. The 670 pages left out are the newer and harder
 *  ones, so a score here runs high beside the leaderboard's and is never
 *  to be set against it: every line carries the manifest's label saying
 *  so.
 *
 *  The ground truth is one JSON file: for each page, its regions in
 *  reading order, each with its kind and its text, LaTeX or HTML. The
 *  evaluator -- the benchmark's repository, installed as a package at a
 *  pinned commit -- takes that file and a folder of `<page>.md`, matches
 *  what the markdown holds to the regions, and writes each measure to
 *  `result/`. It is given the ground truth of the pages asked for and a
 *  config that is its own `end2end.yaml` without CDM, the formula measure
 *  that needs a TeX installation; formulas are still scored by edit
 *  distance. */

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Input, Scored } from "../adapter.ts";
import { workDir } from "../cache.ts";
import type { Benchmark } from "../manifest.ts";
import { pythonBeside, scorerOf } from "../python.ts";
import { stretches, type Quote } from "../split.ts";
import { stem } from "../job.ts";

const PROJECT = "omnidocbench";

/** A page of the ground truth; only what is read here. */
interface Page {
  page_info: {
    image_path: string;
    page_attribute: { data_source?: string };
  };
  layout_dets: { category_type: string; ignore?: boolean; text?: string }[];
}

export const pdfs = (data: string) => join(data, "ori_pdfs");

/** The ground truth's pages that have a PDF, by the PDF's name: a page is
 *  named for its image, `<name>.jpg`, and its PDF is `<name>.pdf`. */
async function pages(data: string): Promise<Map<string, Page>> {
  const all = JSON.parse(
    await readFile(join(data, "OmniDocBench.json"), "utf8"),
  ) as Page[];
  const found = new Map<string, Page>();
  for (const page of all) {
    const file = `${basename(page.page_info.image_path).replace(/\.[^.]+$/, "")}.pdf`;
    if (existsSync(join(pdfs(data), file))) found.set(file, page);
  }
  return found;
}

export async function inputs(data: string): Promise<Input[]> {
  return [...(await pages(data))]
    .map(([file, page]) => ({
      file,
      category: page.page_info.page_attribute.data_source ?? "unknown",
    }))
    .sort((a, z) => (a.file < z.file ? -1 : 1));
}

/** The kinds of region whose ground truth is not text the page prints:
 *  a formula's LaTeX, a table's markup, and what the annotators masked
 *  or set aside. */
const NOT_TEXT = /^equation_|^table$|_mask$|^abandon$|^figure$/;

/** What each page's ground truth says it prints, thirty letters at a
 *  time, with formulas left out -- the ones set on their own and the ones
 *  written inside a line of text. */
export async function quoted(data: string): Promise<Map<string, Quote[]>> {
  const quotes = new Map<string, Quote[]>();
  for (const [file, page] of await pages(data))
    quotes.set(
      file,
      page.layout_dets
        .filter((det) => !det.ignore && !NOT_TEXT.test(det.category_type))
        .flatMap((det) => (det.text ?? "").split(/\$[^$]*\$|\\\(.*?\\\)/))
        .flatMap((text) => stretches(text)),
    );
  return quotes;
}

/** What the evaluator's `end2end.yaml` asks for, without CDM. */
const config = (truth: string, markdown: string) => ({
  end2end_eval: {
    metrics: {
      text_block: { metric: ["Edit_dist"] },
      display_formula: { metric: ["Edit_dist"] },
      table: { metric: ["TEDS", "Edit_dist"], teds_workers: 13 },
      reading_order: { metric: ["Edit_dist"] },
    },
    dataset: {
      dataset_name: "end2end_dataset",
      ground_truth: { data_path: truth },
      prediction: { data_path: markdown },
      match_method: "quick_match",
      match_workers: 13,
      quick_match_truncated_timeout_sec: 300,
      match_timeout_sec: 420,
      timeout_fallback_max_chunk_span: 10,
      timeout_fallback_order_penalty: 0.1,
    },
  },
});

export async function score(
  b: Benchmark,
  data: string,
  tool: string,
  out: string,
  files: string[],
  set: string,
): Promise<Scored> {
  const scorer = scorerOf(b, PROJECT);
  const work = workDir(b, tool, set);
  await rm(work, { recursive: true, force: true });
  await mkdir(join(work, "pred"), { recursive: true });
  const all = await pages(data);
  await writeFile(
    join(work, "truth.json"),
    JSON.stringify(files.map((file) => all.get(file))),
  );
  for (const file of files)
    await copyFile(
      join(out, `${stem(file)}.md`),
      join(work, "pred", `${stem(file)}.md`),
    );
  // YAML takes JSON as it is.
  await writeFile(
    join(work, "config.yaml"),
    JSON.stringify(config(join(work, "truth.json"), join(work, "pred"))),
  );
  // Run in its folder: the evaluator writes to `./result`.
  await writeFile(
    join(work, "scorer.txt"),
    await pythonBeside(PROJECT, [
      "-c",
      "import os, sys; os.chdir(sys.argv[1]); from src.cli import main; main(['--config', 'config.yaml'])",
      work,
    ]),
  );
  const result = JSON.parse(
    await readFile(
      join(work, "result", "pred_quick_match_metric_result.json"),
      "utf8",
    ),
  ) as Record<string, { all?: Record<string, unknown> }>;
  return { inputs: files.length, measures: measures(result), scorer };
}

/** Every number under each element's `all`, named by the way to it. */
function measures(
  result: Record<string, { all?: Record<string, unknown> }>,
): Record<string, number> {
  const found: Record<string, number> = {};
  const walk = (value: unknown, name: string) => {
    if (typeof value === "number") found[name] = value;
    else if (value && typeof value === "object")
      for (const [key, inner] of Object.entries(value))
        walk(inner, `${name}.${key}`);
  };
  for (const [element, { all }] of Object.entries(result))
    if (all) walk(all, element);
  return found;
}
