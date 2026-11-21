/** How long an edit takes to show on a long book, each scenario timed from
 *  the press to the frame painted after it. The book is whatever PDF is at
 *  `.vitest/bench/book.pdf`; README.md says how to run it and read it. */

import { beforeAll, expect, test } from "vitest";
import { commands, page } from "vitest/browser";
import { createRoot } from "react-dom/client";
import { act, createElement } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { blocksById } from "src/lib/analysis";
import {
  actOnSelection,
  formatSelection,
  redoEdit,
  revertEdits,
  saved,
  setFurnitureEdit,
  setLineEdit,
  undoEdit,
} from "src/lib/editing";
import { emit } from "src/lib/emit";
import { repeatedLines } from "src/lib/furniture";
import { engine } from "src/lib/engine";
import { useEditor, type Reading } from "src/lib/store";
import { assetsPrefix } from "src/lib/workspace";
import Editor from "src/routes/Editor";
import "src/index.css";

declare const __BENCH__: { rev: string; build: "production" | "dev" };

type Ready = Extract<Reading, { status: "ready" }>;
const DOC = "book";
const RESULTS = ".vitest/bench/results.txt";
/** What a press may take on the production build, in ms, before its row
 *  is flagged: about what reads as at once, and a long task's threshold. */
const BUDGET = 50;
/** Runs a scenario, the median kept. Even, so a toggle ends where it began. */
const RUNS = 6;
/** Only the scenarios whose names match, when set. */
const only = import.meta.env.VITE_BENCH
  ? new RegExp(import.meta.env.VITE_BENCH as string)
  : null;

beforeAll(() => page.viewport(1280, 800));

/** Until the frame after this one has been painted: a task posted from a
 *  frame's rAF callback runs once that frame's rendering is done. */
const painted = () =>
  new Promise<void>((r) =>
    requestAnimationFrame(() => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => r();
      ch.port2.postMessage(0);
    }),
  );
const idle = (ms: number) => new Promise((r) => setTimeout(r, ms));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const reading = () => useEditor.getState().readings[DOC] as Ready;

let log: string | null = null;
/** A line of the results, added to those of the runs before, beside the
 *  book: Vitest does not always relay a browser test's console. */
async function say(line: string) {
  console.log(line);
  log ??= await commands.readFile(RESULTS).catch(() => "");
  log += `${line}\n`;
  await commands.writeFile(RESULTS, log);
}

type Press = () => void;

/** Until no pane is drawing anything in -- a page waiting, or drawn as it
 *  was before the edit (`useProgressive`) -- checked each frame. */
async function drawnIn(): Promise<void> {
  while (document.querySelector('[aria-busy="true"]'))
    await new Promise((r) => requestAnimationFrame(r));
}

/** `press` timed `RUNS` times: the call itself, the frame painted after it,
 *  the save behind it, every page drawn as it now is, and the longest task
 *  in the second after -- what follows the paint, like the scroll sync
 *  measuring again. The first press is given on its own as well: what it
 *  draws is parsed for the first time, and later presses that take it back
 *  and make it again find it parsed. */
async function scenario(name: string, ids: string[], press: Press) {
  if (only && !only.test(name)) return;
  useEditor.setState({
    selection: { docId: DOC, ids, focus: ids[0], anchor: ids[0], from: "page" },
  });
  await idle(500);
  const runs: Record<
    "call" | "paint" | "saved" | "drawn" | "longest",
    number
  >[] = [];
  for (let i = 0; i < RUNS; i++) {
    const longs: number[] = [];
    const po = new PerformanceObserver((l) =>
      l.getEntries().forEach((e) => longs.push(e.duration)),
    );
    po.observe({ type: "longtask" });
    const t0 = performance.now();
    press();
    const call = performance.now() - t0;
    await painted();
    const paint = performance.now() - t0;
    const drawing = drawnIn().then(() => performance.now() - t0);
    await saved(DOC);
    const done = performance.now() - t0;
    const drawn = await drawing;
    await idle(1000);
    po.disconnect();
    runs.push({
      call,
      paint,
      saved: done,
      drawn,
      longest: Math.max(0, ...longs),
    });
  }
  const m = (k: keyof (typeof runs)[number]) =>
    Math.round(median(runs.map((r) => r[k])));
  const over =
    __BENCH__.build === "production" &&
    (m("paint") > BUDGET || m("longest") > BUDGET);
  await say(
    [
      name.padEnd(28),
      `${m("call")}`.padStart(6),
      `${m("paint")}`.padStart(6),
      `${m("saved")}`.padStart(6),
      `${m("drawn")}`.padStart(6),
      `${m("longest")}`.padStart(8),
      `${Math.round(runs[0].paint)}/${Math.round(runs[0].drawn)}`.padStart(12),
      over ? "  OVER" : "",
    ].join(""),
  );
}

const button =
  (which: "hide" | "del"): Press =>
  () =>
    actOnSelection(which);
/** `first`, then `then`, then `first` again: two that take each other
 *  back, so a run of presses ends where it began. */
function alternate(first: Press, then: Press): Press {
  let n = 0;
  return () => (n++ % 2 === 0 ? first : then)();
}
/** A paragraph made a heading and back: what the format bar's buttons
 *  cost, each press a real edit. */
const headingPara = alternate(
  () => formatSelection("h2"),
  () => formatSelection("para"),
);
/** Every page number hidden, then kept: the whole book written again. */
const pageNumbersHideKeep = alternate(
  () => setFurnitureEdit(DOC, "page_numbers", "hide"),
  () => setFurnitureEdit(DOC, "page_numbers", "keep"),
);
const undoRedo = alternate(
  () => undoEdit(DOC),
  () => redoEdit(DOC),
);
const revertUndo = alternate(
  () => revertEdits(DOC),
  () => undoEdit(DOC),
);
/** `ids` selected and hidden or deleted, as one step: what undo, redo and
 *  revert are then timed taking back. Not timed itself. */
async function made(ids: string[], which: "hide" | "del") {
  useEditor.setState({
    selection: { docId: DOC, ids, focus: ids[0], anchor: ids[0], from: "page" },
  });
  actOnSelection(which);
  await saved(DOC);
}

test("edits on a long book", async () => {
  // The build asked for is the build running: production React has no act.
  let build = "dev";
  try {
    act(() => {});
  } catch {
    build = "production";
  }
  expect(build).toBe(__BENCH__.build);

  const bytes = await (await fetch("/.vitest/bench/book.pdf")).arrayBuffer();
  await engine.stageView();
  await engine.discardWorkspace();
  await engine.stage([new File([bytes], "book.pdf")]);
  await engine.commit();
  const host = document.createElement("div");
  document.body.append(host);
  const router = createMemoryRouter(
    [{ path: "/edit/*", element: createElement(Editor) }],
    { initialEntries: [`/edit/${DOC}`] },
  );
  createRoot(host).render(createElement(RouterProvider, { router }));

  const t = performance.now();
  await expect
    .poll(() => reading()?.status, { timeout: 1_200_000, interval: 1000 })
    .toBe("ready");
  const r = reading();
  await say(
    `${new Date().toISOString().slice(0, 16)}  ${__BENCH__.rev}  React ${build}`,
  );
  await say(
    `book: ${r.analysis.pages.length} pages read in ${Math.round((performance.now() - t) / 1000)}s, ` +
      `${(r.markdown.text.length / 1e6).toFixed(1)}MB of markdown, ${r.markdown.lines.length} lines, ${r.markdown.order.length} blocks`,
  );
  const emits = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    emit(r.analysis, assetsPrefix(DOC), r.edits);
    emits.push(performance.now() - t0);
  }
  await say(`emit alone: ${Math.round(median(emits))}ms`);
  await say(
    `${"scenario (median ms)".padEnd(28)}${"call".padStart(6)}${"paint".padStart(6)}${"saved".padStart(6)}${"drawn".padStart(6)}${"longest".padStart(8)}${"first".padStart(12)}`,
  );

  // A block early in the book and one in the middle, both written: an
  // edit early moves more of what comes after it.
  const written = r.markdown.order.filter((id) => r.markdown.blocks[id].n > 0);
  const early = written[5];
  const mid = written[written.length >> 1];
  // A paragraph near `early`, for the format bar: a role a press changes.
  const byId = blocksById(r.analysis);
  const para = written.slice(5).find((id) => byId.get(id)?.role === "para")!;

  const filled = (sel: string) =>
    expect
      .poll(() => document.querySelector(sel)?.getAttribute("aria-busy"), {
        timeout: 600_000,
        interval: 500,
      })
      .toBe("false");

  // Every page drawn: the most an edit can have to draw again.
  await filled("article.markdown");
  await scenario("rendered: hide early", [early], button("hide"));
  await scenario("rendered: hide mid", [mid], button("hide"));
  await scenario("rendered: delete early", [early], button("del"));
  await scenario("rendered: H2/¶ early", [para], headingPara);
  await scenario("rendered: hide page numbers", [early], pageNumbersHideKeep);
  // The book's first repeated header or footer, deleted then kept.
  const line = repeatedLines(r.analysis)[0];
  if (line)
    await scenario(
      "rendered: delete a repeated line",
      [early],
      alternate(
        () => setLineEdit(DOC, line.key, "delete"),
        () => setLineEdit(DOC, line.key, "keep"),
      ),
    );
  if (!only || only.test("rendered: undo")) {
    await made([early], "del");
    await scenario("rendered: undo/redo delete", [early], undoRedo);
    await made([early], "del"); // restored
  }
  // A hundred blocks across the book hidden, as one step, then reverted.
  const spread = written.filter(
    (_, i) => i % Math.floor(written.length / 100) === 0,
  );
  if (!only || only.test("rendered: revert")) {
    await made(spread, "hide");
    await scenario("rendered: revert 100 hidden", spread, revertUndo);
    await made(spread, "hide"); // shown
  }

  await page.getByRole("radio", { name: "raw" }).click();
  await filled("div[aria-busy]:has(> ol.source)");
  await idle(2000);
  await scenario("raw: hide early", [early], button("hide"));
  await scenario("raw: delete early", [early], button("del"));
  await scenario("raw: delete mid", [mid], button("del"));
  await scenario("raw: H2/¶ early", [para], headingPara);
  await scenario("raw: hide page numbers", [early], pageNumbersHideKeep);
  if (!only || only.test("raw: undo")) {
    await made([early], "del");
    await scenario("raw: undo/redo delete", [early], undoRedo);
    await made([early], "del");
  }
  if (!only || only.test("raw: revert")) {
    await made(spread, "hide");
    await scenario("raw: revert 100 hidden", spread, revertUndo);
    await made(spread, "hide");
  }
  await say("");
}, 1_800_000);
