/** The converters: mdgest, and the peers it is held against. Each takes the
 *  same job -- a folder of PDFs and which of them to convert -- and leaves
 *  `<input>.md` for each in its folder of the cache, with `run.json` on how
 *  it went. Everything after that, the adapter and the scorer, is the same
 *  for all of them, so their scores are made the same way on the same
 *  pages. */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { outDir } from "./cache.ts";
import type { FileRun, Job, MdgestRun, PeerRun } from "./job.ts";
import type { Benchmark } from "./manifest.ts";
import { python } from "./python.ts";

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
  /** A hash of every input's markdown, in the inputs' order: the same for
   *  two runs that wrote the same markdown. */
  markdown: string;
}

export interface Tool {
  name: string;
  convert(b: Benchmark, pdfs: string, files: string[]): Promise<Conversion>;
}

/** `file` without its `.pdf`. */
export const stem = (file: string) => file.replace(/\.pdf$/i, "");

async function conversion(
  out: string,
  files: string[],
  runs: Record<string, FileRun>,
  made: Conversion["made"],
): Promise<Conversion> {
  const hash = createHash("sha256");
  const errors: Record<string, string> = {};
  let pages = 0;
  let ms = 0;
  for (const file of files) {
    const run = runs[file];
    if (!run) throw new Error(`${file} was not converted`);
    if (run.error) errors[file] = run.error;
    pages += run.pages;
    ms += run.ms;
    hash.update(`${file}\0`);
    hash.update(await readFile(join(out, `${stem(file)}.md`)));
    hash.update("\0");
  }
  return {
    out,
    made,
    pages,
    seconds: ms / 1000,
    errors,
    markdown: hash.digest("hex"),
  };
}

async function writeJob(out: string, job: Job, name = "job.json") {
  await mkdir(out, { recursive: true });
  const at = join(out, name);
  await writeFile(at, JSON.stringify(job));
  return at;
}

/** How many converters read at once, each in a browser of its own: reading
 *  is one thread's work, and the long benchmarks are tens of thousands of
 *  pages. A small job is not split. */
const BROWSERS = 6;
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

/** mdgest, as the working tree has it: `convert.run.ts` in headless
 *  Chromium, under Vitest. Converted afresh every run -- it is what is
 *  being measured. A long job is dealt out to several browsers, a
 *  document each in turn; a document is read the same whichever reads it,
 *  and its time is its own reading's. */
export const mdgest: Tool = {
  name: "mdgest",
  async convert(b, pdfs, files) {
    const out = outDir(b, "mdgest");
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
        const job = { pdfs, out, files: list, run: `run-${k}.json` };
        await browser(await writeJob(out, job, `job-${k}.json`), n > 1);
        if (n > 1) console.log(`  browser ${k + 1} of ${n} is done`);
      }),
    );
    const runs = await Promise.all(
      hands.map(
        async (_, k) =>
          JSON.parse(
            await readFile(join(out, `run-${k}.json`), "utf8"),
          ) as MdgestRun,
      ),
    );
    return conversion(
      out,
      files,
      Object.assign({}, ...runs.map((run) => run.files)),
      { reader: runs[0].reader, pdfjs: runs[0].pdfjs },
    );
  },
};

/** What is kept of a peer's conversions, beside its markdown. */
interface Kept {
  /** The dataset revision converted, the peer's version, and a hash of the
   *  lock it was installed from: a change in any starts over. */
  revision: string;
  version: string;
  lock: string;
  files: Record<string, FileRun>;
}

/** A peer that is a pinned Python project at `tools/<name>`, with a
 *  `convert.py` that takes a job. What it made of a dataset revision is
 *  kept: neither it nor the inputs change until a pin does, so it runs
 *  again only for inputs it has not converted yet. */
function peer(name: string): Tool {
  const project = `tools/${name}`;
  const file = (path: string) =>
    fileURLToPath(new URL(`${project}/${path}`, import.meta.url));
  return {
    name,
    async convert(b, pdfs, files) {
      const out = outDir(b, name);
      const at = join(out, "kept.json");
      const lock = createHash("sha256")
        .update(await readFile(file("uv.lock")))
        .digest("hex");
      let kept: Kept | null = existsSync(at)
        ? (JSON.parse(await readFile(at, "utf8")) as Kept)
        : null;
      if (kept && (kept.revision !== b.revision || kept.lock !== lock))
        kept = null;
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
        kept = {
          revision: b.revision,
          version: run.version,
          lock,
          files: { ...kept?.files, ...run.files },
        };
        await writeFile(at, JSON.stringify(kept));
      } else console.log(`${name}: kept from an earlier run`);
      return conversion(out, files, kept!.files, { version: kept!.version });
    },
  };
}

export const TOOLS: Tool[] = [mdgest, peer("pymupdf4llm")];

export function tool(name: string): Tool {
  const found = TOOLS.find((t) => t.name === name);
  if (!found)
    throw new Error(
      `no tool "${name}": there is ${TOOLS.map((t) => t.name).join(", ")}`,
    );
  return found;
}
