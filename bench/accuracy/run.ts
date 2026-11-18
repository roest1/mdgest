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
 *  whose score no commit could give again. */

import { fetchData } from "./fetch.ts";
import { BENCHMARKS, benchmark, type Benchmark } from "./manifest.ts";
import * as olmocr from "./olmocr/adapter.ts";
import { append, line, show, tree } from "./results.ts";
import { makeSplit, storedSplit } from "./split.ts";
import { mdgest, tool, type Conversion, type Tool } from "./tools.ts";

const ADAPTERS: Record<string, typeof olmocr> = { olmocr };

interface Options {
  tool: Tool;
  only: string | null;
  limit: number | null;
}

async function run(b: Benchmark, { tool: t, only, limit }: Options) {
  const adapter = ADAPTERS[b.name];
  const data = await fetchData(b);
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
  const everything = await adapter.score(
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
    ? await adapter.score(b, data, t.name, made.out, withLayer, "text-layer")
    : null;

  const entry = line(b, everything.scorer, t.name, made, everything, textLayer);
  console.log(`\n${show(entry)}`);
  for (const [file, why] of Object.entries(made.errors))
    console.log(`  unread: ${file}: ${why}`);
  if (slice) console.log("\na slice: not added to the history");
  else if (tree().dirty)
    console.log("\nthe tree has changes: not added to the history");
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
