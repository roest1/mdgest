/** The converters: mdgest, and the peers it is held against. Each takes the
 *  same job -- a folder of PDFs and which of them to convert -- and leaves
 *  `<input>.md` for each in its folder of the cache, with `run.json` on how
 *  it went. Everything after that, the adapter and the scorer, is the same
 *  for all of them, so their scores are made the same way on the same
 *  pages. */

import { spawnSync } from "node:child_process";
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

async function writeJob(out: string, job: Job): Promise<string> {
  await mkdir(out, { recursive: true });
  const at = join(out, "job.json");
  await writeFile(at, JSON.stringify(job));
  return at;
}

/** mdgest, as the working tree has it: `convert.run.ts` in headless
 *  Chromium, under Vitest. Converted afresh every run -- it is what is
 *  being measured. */
export const mdgest: Tool = {
  name: "mdgest",
  async convert(b, pdfs, files) {
    const out = outDir(b, "mdgest");
    const job = await writeJob(out, { pdfs, out, files });
    const ran = spawnSync(
      join(ROOT, "node_modules/.bin/vitest"),
      ["run", "--config", "bench/accuracy/vitest.config.ts"],
      { cwd: ROOT, env: { ...process.env, BENCH_JOB: job }, stdio: "inherit" },
    );
    if (ran.error) throw ran.error;
    if (ran.status !== 0) throw new Error("the converter did not finish");
    const run = JSON.parse(
      await readFile(join(out, "run.json"), "utf8"),
    ) as MdgestRun;
    return conversion(out, files, run.files, {
      reader: run.reader,
      pdfjs: run.pdfjs,
    });
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
        const job = await writeJob(out, { pdfs, out, files: todo });
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
