/** READoc: what its data holds, and its own evaluation suite run over a
 *  tool's markdown.
 *
 *  The data is whole documents, not pages: 1,009 arXiv papers and 1,224
 *  GitHub READMEs as PDFs, in two archives, and for each the markdown it
 *  was made from, as ground truth. The two subsets are scored apart, as
 *  the benchmark reports them.
 *
 *  The suite is a repository of scripts, checked out at the commit the
 *  manifest names; what it runs on is pinned in `pyproject.toml`. It
 *  takes a folder of ground truth and a folder of markdown under the same
 *  file names, and writes one number per measure: the mean, over the
 *  documents, of how close the text, the headings, the formulas, the
 *  tables and the reading order came. It gives no single score. The
 *  paper's tables do -- an "Average", the plain mean of the measures they
 *  list -- so that is worked out here, the one sum in this file, and
 *  named `average`. */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
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
import type { Input, Scored } from "../adapter.ts";
import { envDir, scorerDir, workDir } from "../cache.ts";
import type { Benchmark } from "../manifest.ts";
import { python, pythonBeside } from "../python.ts";
import type { Quote } from "../split.ts";
import { stem } from "../tools.ts";

const PROJECT = "readoc";
const SUBSETS = ["arxiv", "github"];

/** The measures the paper's tables list, whose mean is its "Average": the
 *  two for reading order are Kendall's tau, and Spearman's, which the
 *  suite also writes, is left out as the paper leaves it. */
const TABLED = [
  "text_eds",
  "text_f1",
  "head_eds",
  "head_teds",
  "inline_eds",
  "outline_eds",
  "table_eds",
  "table_teds",
  "seg_kt",
  "word_kt",
];

/** The archives unpacked: `<subset>/pdf/<id>.pdf` under `pdfs()`. */
export const pdfs = (data: string) => join(data, "unpacked");
const truth = (data: string, file: string) =>
  join(data, `${subset(file)}_ground_truth`, `${id(file)}.md`);
const subset = (file: string) => file.split("/")[0];
const id = (file: string) => stem(file).split("/").at(-1)!;

export async function prepare(_: Benchmark, data: string): Promise<void> {
  const done = join(pdfs(data), ".unpacked");
  if (existsSync(done)) return;
  console.log("readoc: unpacking the archives");
  for (const name of SUBSETS)
    python(PROJECT, [
      "-m",
      "zipfile",
      "-e",
      join(data, `${name}.zip`),
      pdfs(data),
    ]);
  await writeFile(done, "");
}

export async function inputs(data: string): Promise<Input[]> {
  const found: Input[] = [];
  for (const name of SUBSETS)
    for (const file of await readdir(join(pdfs(data), name, "pdf")))
      if (file.endsWith(".pdf")) {
        const input = { file: `${name}/pdf/${file}`, category: name };
        if (!existsSync(truth(data, input.file)))
          throw new Error(`${input.file} has no ground truth`);
        found.push(input);
      }
  return found.sort((a, z) => (a.file < z.file ? -1 : 1));
}

/** How many stretches of a document are held against its text layer, at
 *  most, taken evenly along it, and how long each is, in words. */
const QUOTES = 200;
const WORDS = 8;

/** What a document's ground truth says it holds, for the text-layer
 *  split: stretches of its prose, eight words at a time. Formulas are
 *  left out, with whatever else is written in LaTeX -- tables, figures --
 *  since their source is not text the page prints; so are images and the
 *  addresses of links. */
function quotes(markdown: string): Quote[] {
  const prose = markdown
    .replace(/\\begin\{(\w+\*?)\}[\s\S]*?\\end\{\1\}/g, "\n\n")
    .replace(/\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$/g, "\0")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\]\([^)]*\)/g, "] ")
    .replace(/<[^>]+>/g, " ");
  const all: Quote[] = [];
  // A stretch never runs across a formula or from one paragraph into the
  // next: only words the page sets one after another.
  for (const run of prose.split(/\0|\n\s*\n/)) {
    const words = run.split(/\s+/).filter(Boolean);
    for (let i = 0; i + WORDS <= words.length; i += WORDS) {
      const text = words.slice(i, i + WORDS).join(" ");
      if (
        !/[\\$]/.test(text) &&
        text.replace(/[^\p{L}\p{N}]/gu, "").length >= 24
      )
        all.push({ text });
    }
  }
  if (all.length <= QUOTES) return all;
  return Array.from(
    { length: QUOTES },
    (_, i) => all[Math.floor((i * all.length) / QUOTES)],
  );
}

export async function quoted(data: string): Promise<Map<string, Quote[]>> {
  const found = new Map<string, Quote[]>();
  for (const { file } of await inputs(data))
    found.set(file, quotes(await readFile(truth(data, file), "utf8")));
  return found;
}

interface Suite {
  /** The suite's own folder of scripts. */
  scripts: string;
  /** What its runs need in their environment: pandoc on the path, and
   *  where NLTK's word list is. */
  env: Record<string, string>;
  name: string;
}

/** The suite, ready: checked out at the pinned commit, with the pandoc
 *  and the word list its measures use. Done once a process. */
let ready: Suite | null = null;
function suite(b: Benchmark): Suite {
  if (ready) return ready;
  const pin = b.scorer.git;
  if (!pin) throw new Error("the manifest names no commit of READoc's suite");
  const dir = scorerDir(b);
  const git = (...args: string[]) =>
    execFileSync("git", args, { encoding: "utf8" }).trim();
  if (!existsSync(dir)) {
    git("clone", "--quiet", pin.url, dir);
    git("-C", dir, "checkout", "--quiet", pin.commit);
  }
  if (
    git("-C", dir, "rev-parse", "HEAD") !== pin.commit ||
    git("-C", dir, "status", "--porcelain") !== ""
  )
    throw new Error(`${dir} is not READoc's suite at ${pin.commit}`);

  // METEOR, which the suite works out beside its other text measures,
  // looks words up in WordNet; NLTK fetches it, once.
  const words = join(envDir(PROJECT), "nltk_data");
  if (!existsSync(join(words, "corpora", "wordnet.zip")))
    python(PROJECT, ["-m", "nltk.downloader", "-q", "-d", words, "wordnet"]);
  const pandoc = python(PROJECT, [
    "-c",
    "import pypandoc; print(pypandoc.get_pandoc_path())",
  ]).trim();
  return (ready = {
    scripts: join(dir, "src", "evaluation"),
    env: {
      PATH: `${dirname(pandoc)}:${process.env.PATH}`,
      NLTK_DATA: words,
    },
    name: `${b.scorer.package} ${b.scorer.version}`,
  });
}

export async function score(
  b: Benchmark,
  data: string,
  tool: string,
  out: string,
  files: string[],
  set: string,
): Promise<Scored> {
  const { scripts, env, name } = suite(b);
  const work = workDir(b, tool, set);
  await rm(work, { recursive: true, force: true });
  const measures: Record<string, number> = {};
  // The two subsets at once: the suite reads its documents one at a time.
  await Promise.all(
    SUBSETS.map(async (part) => {
      const mine = files.filter((file) => subset(file) === part);
      if (!mine.length) return;
      const gold = join(work, part, "gold");
      const pred = join(work, part, "pred");
      await mkdir(gold, { recursive: true });
      await mkdir(pred, { recursive: true });
      for (const file of mine) {
        await symlink(truth(data, file), join(gold, `${id(file)}.md`));
        await copyFile(
          join(out, `${stem(file)}.md`),
          join(pred, `${id(file)}.md`),
        );
      }
      const result = join(work, `${part}.json`);
      await pythonBeside(
        PROJECT,
        [
          "-W",
          "ignore",
          join(scripts, "suite_e2e.py"),
          "--gold_dir",
          gold,
          "--pred_dir",
          pred,
          "--result_json",
          result,
        ],
        env,
      );
      const written = JSON.parse(await readFile(result, "utf8")) as Record<
        string,
        number
      >;
      for (const [measure, value] of Object.entries(written))
        measures[`${part}.${measure}`] = value;
      const tabled = TABLED.filter((measure) => measure in written);
      measures[`${part}.average`] =
        tabled.reduce((sum, measure) => sum + written[measure], 0) /
        tabled.length;
    }),
  );
  return {
    inputs: files.length,
    measures: Object.fromEntries(
      Object.entries(measures).sort(([a], [z]) => (a < z ? -1 : 1)),
    ),
    scorer: name,
  };
}
