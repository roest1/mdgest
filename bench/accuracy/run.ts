/** `bun run bench:accuracy <benchmark>`: one benchmark, end to end.
 *
 *    bun run bench:accuracy olmocr                       mdgest, every input
 *    bun run bench:accuracy olmocr --tool pymupdf4llm    a peer, through the same steps
 *    bun run bench:accuracy olmocr --only arxiv_math --limit 50
 *    bun run bench:accuracy all
 *
 *  Fetch the data on a cache miss, convert it with the tool, lay the
 *  markdown out for the benchmark's scorer and run it -- on every input,
 *  then on the inputs with a text layer -- and add a line to the history.
 *
 *  A slice (`--only`, `--limit`) is for working on one thing and is never
 *  added to the history; neither is a run from a tree with changes in it,
 *  whose score no commit could give again, nor one the tree changed
 *  under, nor one that gave up on a document at the converter's limit on
 *  its time, which is the machine's doing. */

import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Adapter } from "./adapter.ts";
import { keptDir, outDir } from "./cache.ts";
import { coverage, tallies } from "./coverage.ts";
import { fetchData } from "./fetch.ts";
import * as frBench from "./fr-bench/adapter.ts";
import { BENCHMARKS, benchmark, type Benchmark } from "./manifest.ts";
import * as olmocr from "./olmocr/adapter.ts";
import * as omnidocbench from "./omnidocbench/adapter.ts";
import * as readoc from "./readoc/adapter.ts";
import {
  append,
  line,
  show,
  tree,
  type KeptRun,
  type Tree,
} from "./results.ts";
import { makeSplit, storedSplit } from "./split.ts";
import { mdgest, tool, type Conversion, type Tool } from "./tools.ts";

const ADAPTERS: Record<string, Adapter> = {
  olmocr,
  "fr-bench": frBench,
  readoc,
  omnidocbench,
};

interface Options {
  tool: Tool;
  only: string | null;
  limit: number | null;
}

/** Why a run of every input is not one for the history, or null. */
function unrepeatable(began: Tree, made: Conversion): string | null {
  const now = tree();
  if (began.dirty) return "the tree has changes";
  if (now.commit !== began.commit || now.dirty)
    return `the tree changed during the run, which began at ${began.commit}`;
  if (made.gaveUp.length)
    return `${made.gaveUp.length} given up on at the limit on a document's time, which a slower machine does to more`;
  return null;
}

async function run(b: Benchmark, { tool: t, only, limit }: Options) {
  // Before anything is converted: the working tree is what is run, for as
  // long as the run takes.
  const began = tree();
  if (began.dirty && !only && !limit)
    console.log(
      `${b.name}: the tree has changes, so this run will not be added to the history`,
    );
  const adapter = ADAPTERS[b.name];
  const data = await fetchData(b);
  await adapter.prepare?.(b, data);
  const pdfs = adapter.pdfs(data);
  const all = await adapter.inputs(data);

  // The split first: it is made from the text layers, which the mdgest
  // converter writes beside its markdown, of every input.
  let split = await storedSplit(b);
  let whole: Conversion | null = null;
  if (!split) {
    console.log(`${b.name}: no text-layer split for this revision; making it`);
    whole = await mdgest.convert(
      b,
      pdfs,
      all.map((input) => input.file),
    );
    // A page is in or out by what its PDF carries. One whose text layer
    // was not taken would be out for every tool, for good, by an accident
    // of this run.
    const lost = Object.entries(whole.noLayer);
    if (lost.length)
      throw new Error(
        `no split made: the text layer of ${lost.length} of ${all.length} inputs could not be taken\n` +
          lost.map(([file, why]) => `  ${file}: ${why}`).join("\n"),
      );
    split = await makeSplit(
      b,
      await adapter.quoted(data),
      whole.out,
      String(whole.made.pdfjs),
    );
    console.log(`  ${split.pages.length} of ${split.inputs} have a text layer`);
  }

  let chosen = all;
  if (only) {
    chosen = chosen.filter((input) => input.category === only);
    if (!chosen.length)
      throw new Error(
        `no category "${only}" in ${b.name}: there is ${[...new Set(all.map((i) => i.category))].join(", ")}`,
      );
  }
  if (limit && limit < chosen.length) {
    // Spread over the whole list, so every category is in a small run.
    const from = chosen;
    chosen = Array.from(
      { length: limit },
      (_, i) => from[Math.floor((i * from.length) / limit)],
    );
  }
  const slice = chosen.length !== all.length;
  const files = chosen.map((input) => input.file);

  const made =
    whole && t === mdgest && !slice ? whole : await t.convert(b, pdfs, files);
  const { verdicts, ...everything } = await adapter.score(
    b,
    data,
    t.name,
    made.out,
    files,
    "all",
  );
  const layered = new Set(split.pages);
  const withLayer = files.filter((file) => layered.has(file));
  const textLayer = withLayer.length
    ? await adapter
        .score(b, data, t.name, made.out, withLayer, "text-layer")
        .then((scored) => ({ ...scored, verdicts: undefined }))
    : null;

  // Held against the text layers mdgest's converter wrote, whichever tool
  // this is: what the PDF carries is the same for all of them.
  const each = await tallies(outDir(b, mdgest.name), made.out, files);
  const entry = line(
    b,
    everything.scorer,
    t.name,
    made,
    everything,
    textLayer,
    began.commit,
    {
      all: coverage(each, files),
      text_layer: withLayer.length ? coverage(each, withLayer) : null,
    },
  );
  console.log(`\n${show(entry)}`);
  for (const [file, why] of Object.entries(made.errors))
    console.log(`  unread: ${file}: ${why}`);
  if (slice) {
    console.log("\na slice: not added to the history");
    return;
  }
  const why = unrepeatable(began, made);

  // A run of every input leaves its verdicts, with the ones the run
  // before left and what each was a run of: what the review report shows
  // and compares. Kept out of the scorer's folder, which the next scoring
  // empties, a slice's too.
  if (verdicts) {
    const kept = keptDir(b, t.name);
    await mkdir(kept, { recursive: true });
    for (const name of ["verdicts", "run"])
      if (existsSync(join(kept, `${name}.json`)))
        await copyFile(
          join(kept, `${name}.json`),
          join(kept, `${name}.before.json`),
        );
    const run: KeptRun = {
      date: entry.date,
      commit: began.commit,
      unrepeatable: why,
      scorer: everything.scorer,
      made: made.made,
      hashes: made.hashes,
    };
    await writeFile(join(kept, "verdicts.json"), JSON.stringify(verdicts));
    await writeFile(join(kept, "run.json"), JSON.stringify(run));
  }

  if (why) console.log(`\n${why}: not added to the history`);
  else console.log(`\nadded to ${await append(b, entry)}`);
}

function options(args: string[]): { names: string[]; options: Options } {
  const names: string[] = [];
  let t = mdgest;
  let only: string | null = null;
  let limit: number | null = null;
  for (let i = 0; i < args.length; i++) {
    const value = () => {
      if (i + 1 >= args.length) throw new Error(`${args[i]} needs a value`);
      return args[++i];
    };
    if (args[i] === "--tool") t = tool(value());
    else if (args[i] === "--only") only = value();
    else if (args[i] === "--limit") {
      limit = Number(value());
      if (!Number.isInteger(limit) || limit < 1)
        throw new Error("--limit takes a whole number of inputs");
    } else if (args[i].startsWith("-")) throw new Error(`no option ${args[i]}`);
    else names.push(args[i]);
  }
  return { names, options: { tool: t, only, limit } };
}

try {
  const { names, options: chosen } = options(process.argv.slice(2));
  if (names.length !== 1)
    throw new Error(
      `usage: bun run bench:accuracy <${BENCHMARKS.map((b) => b.name).join("|")}|all> [--tool <name>] [--only <category>] [--limit <n>]`,
    );
  const todo = names[0] === "all" ? BENCHMARKS : [benchmark(names[0])];
  for (const b of todo) await run(b, chosen);
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exit(1);
}
