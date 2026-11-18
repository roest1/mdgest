/** The converters: mdgest, and the peers it is held against. Each takes the
 *  same job -- a folder of PDFs and which of them to convert -- and leaves
 *  `<input>.md` for each in its folder of the cache, with `run.json` on how
 *  it went. Everything after that, the adapter and the scorer, is the same
 *  for all of them, so their scores are made the same way on the same
 *  pages. */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { outDir } from "./cache.ts";
import {
  stem,
  type FileRun,
  type Job,
  type MdgestRun,
  type PeerRun,
} from "./job.ts";
import { revisionOf, type Benchmark } from "./manifest.ts";
import { installed, python } from "./python.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** How a conversion went. */
export interface Conversion {
  /** The folder the markdown is in: `<input>.md` for each input. */
  out: string;
  /** What made it, for the results line: `{ pdfjs, reader }` or
   *  `{ version }`. */
  made: Record<string, string | number>;
  pages: number;
  /** The time spent converting, in seconds: reading alone, without
   *  starting the tool or moving files. */
  seconds: number;
  /** The inputs that could not be converted, and why. */
  errors: Record<string, string>;
  /** Those of them given up on at the converter's limit on a document's
   *  time, which is the clock's verdict and not the tool's. */
  gaveUp: string[];
  /** The inputs whose text layer could not be taken, and why: mdgest's
   *  converter takes it, for the split. */
  noLayer: Record<string, string>;
  /** A hash of every input's markdown, in the inputs' order: the same for
   *  two runs that wrote the same markdown. */
  markdown: string;
  /** Each input's own. */
  hashes: Record<string, string>;
  /** How many browsers read side by side, for mdgest. */
  browsers?: number;
}

export interface Tool {
  name: string;
  convert(b: Benchmark, pdfs: string, files: string[]): Promise<Conversion>;
}

/** The hash of markdown as the scorers are given it (`written`). */
export const hashOf = (markdown: string | Buffer) =>
  createHash("sha256").update(markdown).digest("hex");

async function conversion(
  out: string,
  files: string[],
  runs: Record<string, FileRun>,
  made: Conversion["made"],
): Promise<Conversion> {
  const hash = createHash("sha256");
  const hashes: Record<string, string> = {};
  const errors: Record<string, string> = {};
  const gaveUp: string[] = [];
  const noLayer: Record<string, string> = {};
  let pages = 0;
  let ms = 0;
  for (const file of files) {
    const run = runs[file];
    if (!run) throw new Error(`${file} was not converted`);
    if (run.error) errors[file] = run.error;
    if (run.gaveUp) gaveUp.push(file);
    if (run.layer) noLayer[file] = run.layer;
    pages += run.pages;
    ms += run.ms;
    const markdown = await written(join(out, `${stem(file)}.md`));
    hashes[file] = hashOf(markdown);
    hash.update(`${file}\0`);
    hash.update(markdown);
    hash.update("\0");
  }
  return {
    out,
    made,
    pages,
    seconds: ms / 1000,
    errors,
    gaveUp,
    noLayer,
    markdown: hash.digest("hex"),
    hashes,
  };
}

/** The markdown at `at`, as the scorers are given it. Markdown that is
 *  nothing but white space is left as an empty file: a tool that wrote a
 *  line break for a page it found no text on converted nothing, and at
 *  least one scorer tells the two apart -- olmOCR-bench's looks for a
 *  test's text with a fuzzy match that a single space satisfies, so a
 *  blank page passes its "present" tests where an empty one fails them. */
async function written(at: string): Promise<Buffer> {
  const markdown = await readFile(at);
  if (!markdown.length || markdown.toString("utf8").trim()) return markdown;
  await writeFile(at, "");
  return Buffer.alloc(0);
}

async function writeJob(out: string, job: Job, name = "job.json") {
  await mkdir(out, { recursive: true });
  const at = join(out, name);
  await writeFile(at, JSON.stringify(job));
  return at;
}

/** How many converters read at once, each in a browser of its own: reading
 *  is one thread's work, and the long benchmarks are tens of thousands of
 *  pages. A browser and the server it reads from keep two cores busy, so
 *  there is one for every two the machine has, and never more than six:
 *  more on fewer cores and a document's reading waits its turn, runs into
 *  the converter's limit on its time and is scored as empty. A small job
 *  is not split. */
const BROWSERS = Math.max(
  1,
  Math.min(6, Math.floor(availableParallelism() / 2)),
);
const SPLIT_FROM = 60;

/** One converter at work on the job in the file `job`. Each starts a
 *  server of its own, on the next port free. */
function browser(job: string, quiet: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      join(ROOT, "node_modules/.bin/vitest"),
      ["run", "--config", "bench/accuracy/vitest.config.ts"],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          BENCH_JOB: job,
          ...(quiet ? { BENCH_QUIET: "1" } : {}),
        },
        stdio: quiet ? ["ignore", "ignore", "inherit"] : "inherit",
      },
    );
    child.on("error", reject);
    child.on("exit", (status) =>
      status === 0
        ? resolve()
        : reject(new Error("the converter did not finish")),
    );
  });
}

/** mdgest over `files`, into `out`, in as many browsers as the job is
 *  worth. With `draw`, each PDF's first page is left as a picture too,
 *  with where the reader's blocks are on it. */
async function read(
  pdfs: string,
  files: string[],
  out: string,
  draw = false,
): Promise<MdgestRun[]> {
  const n = files.length < SPLIT_FROM ? 1 : BROWSERS;
  const hands = Array.from({ length: n }, (_, k) =>
    files.filter((_, i) => i % n === k),
  );
  if (n > 1) {
    // Once on nothing, alone: the first server to start settles Vite's
    // cache of dependencies, which several starting together would race
    // to write.
    const idle = { pdfs, out, files: [], run: "run-idle.json" };
    await browser(await writeJob(out, idle, "job-idle.json"), true);
    console.log(`mdgest: ${files.length} PDFs, in ${n} browsers`);
  }
  await Promise.all(
    hands.map(async (list, k) => {
      const job = { pdfs, out, files: list, run: `run-${k}.json`, draw };
      await browser(await writeJob(out, job, `job-${k}.json`), n > 1);
      if (n > 1) console.log(`  browser ${k + 1} of ${n} is done`);
    }),
  );
  return Promise.all(
    hands.map(
      async (_, k) =>
        JSON.parse(
          await readFile(join(out, `run-${k}.json`), "utf8"),
        ) as MdgestRun,
    ),
  );
}

/** mdgest, as the working tree has it: `convert.run.ts` in headless
 *  Chromium, under Vitest. Converted afresh every run -- it is what is
 *  being measured. A long job is dealt out to several browsers, a
 *  document each in turn; a document is read the same whichever reads it,
 *  and its time is its own reading's. */
export const mdgest: Tool = {
  name: "mdgest",
  async convert(b, pdfs, files) {
    const out = outDir(b, "mdgest");
    const runs = await read(pdfs, files, out);
    return {
      ...(await conversion(
        out,
        files,
        Object.assign({}, ...runs.map((run) => run.files)),
        { reader: runs[0].reader, pdfjs: runs[0].pdfjs },
      )),
      browsers: runs.length,
    };
  },
};

/** `files` read by mdgest for the review report: the folder each is left
 *  in as `<input>.md`, `<input>.jpg` and `<input>.blocks.json`. */
export async function drawn(
  b: Benchmark,
  pdfs: string,
  files: string[],
): Promise<string> {
  const out = join(outDir(b, "mdgest"), "..", "mdgest-drawn");
  await read(pdfs, files, out, true);
  return out;
}

/** What is kept of a peer's conversions, beside its markdown. */
interface Kept {
  /** The dataset revision converted, the peer's version, and a hash of
   *  what it was run by (`pins`): a change in any starts over. */
  revision: string;
  version: string;
  pins: string;
  files: Record<string, FileRun>;
}

/** The version of the system's Poppler, as `pdftotext -v` gives it. */
function poppler(): string {
  const said = spawnSync("pdftotext", ["-v"], { encoding: "utf8" });
  if (said.error) throw said.error;
  return said.stderr.split("\n")[0].replace("pdftotext version ", "").trim();
}

/** A peer that is a pinned Python project at `tools/<name>`, with a
 *  `convert.py` that takes a job. What it made of a dataset revision is
 *  kept, and it runs again only for inputs it has not converted yet --
 *  until the revision changes, or what the peer is: its version, the lock
 *  it is installed from, its `convert.py`, which holds its settings, or
 *  the `peer.py` they all share.
 *
 *  `version` asks the peer what it is before anything kept is believed:
 *  the package of its own name in its environment, unless it is not a
 *  package at all, as the system's `pdftotext` is not, which no lock
 *  pins. */
function peer(name: string, version?: () => string): Tool {
  const project = `tools/${name}`;
  const file = (path: string) =>
    fileURLToPath(new URL(`${project}/${path}`, import.meta.url));
  return {
    name,
    async convert(b, pdfs, files) {
      const out = outDir(b, name);
      const at = join(out, "kept.json");
      const hash = createHash("sha256");
      for (const path of ["uv.lock", "convert.py", "../peer.py"])
        hash.update(await readFile(file(path))).update("\0");
      const pins = hash.digest("hex");
      const now = version ? version() : installed(project, name);
      let kept: Kept | null = existsSync(at)
        ? (JSON.parse(await readFile(at, "utf8")) as Kept)
        : null;
      if (
        kept &&
        (kept.revision !== revisionOf(b) ||
          kept.pins !== pins ||
          kept.version !== now)
      ) {
        console.log(
          `${name}: it or the data has changed; nothing kept is used`,
        );
        kept = null;
      }
      const todo = files.filter((f) => !kept?.files[f]);
      if (todo.length) {
        console.log(`${name}: converting ${todo.length} PDFs`);
        const job = await writeJob(out, {
          pdfs,
          out,
          files: todo,
          run: "run.json",
        });
        python(project, [file("convert.py"), job], true);
        const run = JSON.parse(
          await readFile(join(out, "run.json"), "utf8"),
        ) as PeerRun;
        if (run.version !== now)
          throw new Error(
            `${name} says it is ${run.version}, and was asked as ${now}`,
          );
        kept = {
          revision: revisionOf(b),
          version: now,
          pins,
          files: { ...kept?.files, ...run.files },
        };
        await writeFile(at, JSON.stringify(kept));
      } else console.log(`${name}: kept from an earlier run`);
      return conversion(out, files, kept!.files, { version: now });
    },
  };
}

export const TOOLS: Tool[] = [
  mdgest,
  peer("pymupdf4llm"),
  peer("markitdown"),
  peer("docling"),
  peer("pdftotext", poppler),
];

export function tool(name: string): Tool {
  const found = TOOLS.find((t) => t.name === name);
  if (!found)
    throw new Error(
      `no tool "${name}": there is ${TOOLS.map((t) => t.name).join(", ")}`,
    );
  return found;
}
