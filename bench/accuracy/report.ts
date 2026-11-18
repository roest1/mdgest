/** `bun run bench:report <benchmark>`: the review report of the last full
 *  run of mdgest on a benchmark made of tests.
 *
 *  A page of HTML, written to `bench/accuracy/out/<benchmark>/` and not
 *  committed: every page with a failed test, drawn, with the reader's
 *  blocks boxed on it and numbered as the markdown counts them, the
 *  markdown beside it, and under them the tests that failed and why. At
 *  its top, the tests whose verdict is not the one the run before gave.
 *
 *  It is for looking. Nothing here decides a pass: the verdicts are the
 *  scorer's, kept by the run (`run.ts`) with what it was a run of, which
 *  is what the page says it shows. The pictures are made by reading the
 *  failed pages once more, with the reader as the tree has it now; a page
 *  that no longer reads as the run scored it is marked. */

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Verdict } from "./adapter.ts";
import { keptDir } from "./cache.ts";
import { fetchData } from "./fetch.ts";
import * as frBench from "./fr-bench/adapter.ts";
import { stem, type Drawn } from "./job.ts";
import { benchmark } from "./manifest.ts";
import * as olmocr from "./olmocr/adapter.ts";
import { tree, type KeptRun } from "./results.ts";
import { drawn, hashOf } from "./tools.ts";

/** The benchmarks made of tests, which are the ones with verdicts. */
const PDFS: Record<string, (data: string) => string> = {
  olmocr: olmocr.pdfs,
  "fr-bench": frBench.pdfs,
};

const escape = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!,
  );

const STYLE = `
  body { font: 14px/1.45 system-ui, sans-serif; margin: 2rem; color: #1b1b1b; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.05rem; margin: 0 0 .25rem; }
  .meta, .why { color: #666; }
  section { border-top: 1px solid #ddd; padding: 1.5rem 0; }
  .sides { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1rem; }
  .page { position: relative; border: 1px solid #ccc; align-self: start; }
  .page img { display: block; width: 100%; }
  .box { position: absolute; border: 1px solid #c2410c; box-sizing: border-box; }
  .box.none { border-style: dashed; border-color: #999; }
  .box span { position: absolute; left: 0; top: -1.15em; font-size: 10px;
    background: #c2410c; color: #fff; padding: 0 3px; }
  pre { margin: 0; padding: .75rem; background: #f6f6f6; white-space: pre-wrap;
    overflow-wrap: anywhere; max-height: 70rem; overflow: auto; }
  table { border-collapse: collapse; margin-top: .75rem; width: 100%; }
  td, th { border-top: 1px solid #eee; padding: .25rem .5rem; text-align: left;
    vertical-align: top; overflow-wrap: anywhere; }
  td:first-child, th:first-child { white-space: nowrap; overflow-wrap: normal; }
  td:last-child, th:last-child { width: 35%; }
  .lost { color: #b91c1c; } .won { color: #15803d; }
  .stale { color: #b45309; }
`;

/** A kept run, as the page names it. */
const told = (run: KeptRun) =>
  `mdgest at ${run.commit}` +
  (run.unrepeatable ? ` (${run.unrepeatable}; not in the history)` : "") +
  `, ${run.date}, ${Object.entries(run.made)
    .map(([key, value]) => `${key} ${value}`)
    .join(", ")}`;

async function json<T>(at: string): Promise<T | null> {
  return existsSync(at) ? (JSON.parse(await readFile(at, "utf8")) as T) : null;
}

async function report(name: string): Promise<string> {
  const b = benchmark(name);
  const pdfs = PDFS[name];
  if (!pdfs)
    throw new Error(
      `${name} is not made of tests: there is a report for ${Object.keys(PDFS).join(", ")}`,
    );
  const kept = keptDir(b, "mdgest");
  const verdicts = await json<Verdict[]>(join(kept, "verdicts.json"));
  const run = await json<KeptRun>(join(kept, "run.json"));
  if (!verdicts || !run)
    throw new Error(
      `no run of ${name} to report on: bun run bench:accuracy ${name} first`,
    );
  const ranBefore = await json<KeptRun>(join(kept, "run.before.json"));
  const before = new Map(
    ((await json<Verdict[]>(join(kept, "verdicts.before.json"))) ?? []).map(
      (verdict) => [verdict.id, verdict.passed],
    ),
  );

  const failed = verdicts.filter((verdict) => !verdict.passed);
  const files = [...new Set(failed.map((verdict) => verdict.file))].sort();
  console.log(
    `${name}: ${failed.length} of ${verdicts.length} tests failed, on ${files.length} pages; drawing them`,
  );
  const pictures = await drawn(b, pdfs(await fetchData(b)), files);

  const out = fileURLToPath(new URL(`out/${name}/`, import.meta.url));
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "pages"), { recursive: true });

  const anchor = new Map(files.map((file, i) => [file, `p${i + 1}`]));
  const changed = verdicts.filter(
    (verdict) =>
      before.has(verdict.id) && before.get(verdict.id) !== verdict.passed,
  );
  const change = (verdict: Verdict) =>
    `<li class="${verdict.passed ? "won" : "lost"}">${verdict.passed ? "now passes" : "now fails"}: ` +
    (anchor.has(verdict.file)
      ? `<a href="#${anchor.get(verdict.file)}">${escape(verdict.file)}</a>`
      : escape(verdict.file)) +
    ` &middot; ${escape(verdict.type)} &middot; ${escape(verdict.wants)}</li>`;

  const sections: string[] = [];
  // Pages the reader no longer writes as the run scored them.
  const stale: string[] = [];
  for (const [i, file] of files.entries()) {
    const picture = join(pictures, `${stem(file)}.jpg`);
    const has = existsSync(picture);
    if (has) await copyFile(picture, join(out, "pages", `${i + 1}.jpg`));
    const page = has
      ? (JSON.parse(
          await readFile(join(pictures, `${stem(file)}.blocks.json`), "utf8"),
        ) as Drawn)
      : null;
    const markdown = await readFile(join(pictures, `${stem(file)}.md`), "utf8");
    // As the scorers are given it: white space alone is nothing.
    const same = hashOf(markdown.trim() ? markdown : "") === run.hashes[file];
    if (!same) stale.push(file);
    const mine = verdicts.filter((verdict) => verdict.file === file);
    const boxes = (page?.blocks ?? [])
      .map(({ n, role, box }) => {
        const percent = (part: number, whole: number) =>
          `${((part / whole) * 100).toFixed(2)}%`;
        return (
          `<div class="box${n ? "" : " none"}" title="${escape(role)}" style="left:${percent(box.x, page!.width)};top:${percent(box.y, page!.height)};` +
          `width:${percent(box.w, page!.width)};height:${percent(box.h, page!.height)}">${n ? `<span>${n}</span>` : ""}</div>`
        );
      })
      .join("");
    sections.push(
      `<section id="p${i + 1}"><h2>${escape(file)}</h2>` +
        `<p class="meta">${escape(mine[0].category)} &middot; ${mine.filter((v) => !v.passed).length} of ${mine.length} tests failed</p>` +
        (same
          ? ""
          : `<p class="stale">The reader writes this page differently now: the picture and the markdown are today's, the verdicts the run's.</p>`) +
        `<div class="sides"><div class="page">${has ? `<img loading="lazy" src="pages/${i + 1}.jpg" alt="">${boxes}` : "<p>this page could not be read</p>"}</div>` +
        `<pre>${escape(markdown)}</pre></div><table><tr><th>test</th><th>wants</th><th>why it failed</th></tr>` +
        mine
          .filter((verdict) => !verdict.passed)
          .map(
            (verdict) =>
              `<tr><td>${escape(verdict.type)}</td><td>${escape(verdict.wants)}</td><td class="why">${escape(verdict.why ?? "")}</td></tr>`,
          )
          .join("") +
        "</table></section>",
    );
  }

  const now = tree();
  if (stale.length)
    console.log(
      `  ${stale.length} of the ${files.length} pages read differently now than in the run (${run.commit}); the tree is at ${now.commit}${now.dirty ? ", with changes" : ""}`,
    );
  const html =
    `<!doctype html><meta charset="utf-8"><title>${escape(name)}: review</title><style>${STYLE}</style>` +
    `<h1>${escape(name)}: ${failed.length} of ${verdicts.length} tests failed, on ${files.length} pages</h1>` +
    `<p class="meta">${escape(told(run))}; the scorer is ${escape(run.scorer)}. ` +
    `Boxes are the reader's blocks, numbered as the markdown counts them; a dashed one is written nowhere.</p>` +
    (stale.length
      ? `<p class="stale">${stale.length} of the ${files.length} pages drawn read differently now than in the run: the reader has changed since (the tree is at ${escape(now.commit)}${now.dirty ? ", with changes" : ""}). Each is marked.</p>`
      : "") +
    (before.size
      ? `<h2>Changed since the run before: ${changed.length}</h2>` +
        (ranBefore ? `<p class="meta">${escape(told(ranBefore))}.</p>` : "") +
        `<ul>${changed.map(change).join("")}</ul>`
      : `<p class="meta">No run before this one to compare with.</p>`) +
    sections.join("");
  await writeFile(join(out, "index.html"), html);
  return join(out, "index.html");
}

try {
  const names = process.argv.slice(2);
  if (!names.length)
    throw new Error(
      `usage: bun run bench:report <${Object.keys(PDFS).join("|")}>`,
    );
  for (const name of names) console.log(`written to ${await report(name)}`);
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exit(1);
}
