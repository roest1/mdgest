/** Where the suite keeps what it does not commit: the datasets, what each
 *  tool made of them, the folders laid out for the scorers, and the
 *  scorers' Python environments. All of it can be fetched or made again,
 *  and none of it is ours to put in the repo. */

import { homedir } from "node:os";
import { join } from "node:path";
import { revisionOf, type Benchmark } from "./manifest.ts";

/** `~/.cache/mdgest-bench`, or wherever `MDGEST_BENCH_CACHE` says. */
export const CACHE =
  process.env.MDGEST_BENCH_CACHE || join(homedir(), ".cache", "mdgest-bench");

/** A benchmark's files, as its repo lays them out, at the pinned revisions. */
export const dataDir = (b: Benchmark) =>
  join(CACHE, "data", b.name, revisionOf(b));

/** What `tool` made of a benchmark's inputs: `<input>.md` for each, and
 *  `run.json` on how the conversion went. */
export const outDir = (b: Benchmark, tool: string) =>
  join(CACHE, "out", b.name, tool);

/** The folder laid out for the scorer, for one tool and one set of pages. */
export const workDir = (b: Benchmark, tool: string, set: string) =>
  join(CACHE, "work", b.name, tool, set);

/** The uv environment of the Python project at `bench/accuracy/<project>`. */
export const envDir = (project: string) =>
  join(CACHE, "envs", project.replaceAll("/", "-"));

/** A scorer that is a repository of scripts, checked out at its pinned
 *  commit. */
export const scorerDir = (b: Benchmark) =>
  join(CACHE, "scorers", b.name, b.scorer.git?.commit ?? "");
