/** The editor over the real engine, at the address it is opened on: one
 *  the workspace holds opens as a tab, and one it does not -- mistyped, or
 *  kept from before a document went -- is let go of rather than opened. An
 *  open document's pages are drawn in the PDF pane, through pdf.js.
 *
 * As in `landing.test.ts`, nothing is mocked between the page and OPFS. The
 * workspace is committed through the engine, and the browser's copy of it
 * discarded before and after each test, so each starts from nothing. */

import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { engine } from "src/lib/engine";
import { useEditor, type Reading } from "src/lib/store";
import { inView, layout } from "src/components/editor/column";
import Editor from "src/routes/Editor";
// The app's own layout: which panes are hidden, and what scrolls.
import "src/index.css";
import { pdfOf, type PdfExtras } from "./harness";
import { prose, TOP, X } from "./cases/text";
import { buildPdf, PARAGRAPH, type Pen } from "./fixtures/pdf";

let root: Root | null = null;
let host: HTMLElement | null = null;
let router: ReturnType<typeof createMemoryRouter> | null = null;

/** The editor at `path`, routed as the app routes it. */
function mount(path: string): void {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  router = createMemoryRouter(
    [
      { path: "/edit", element: createElement(Editor) },
      { path: "/edit/*", element: createElement(Editor) },
    ],
    { initialEntries: ["/", path], initialIndex: 1 },
  );
  root.render(createElement(RouterProvider, { router }));
}

// Wide enough for the explorer, both panes and the PDF pane's sidebar, as
// on the desktops and tablets the editor is for.
beforeAll(() => page.viewport(1280, 800));

/** The browser's workspace, staged on a first look and discarded, which
 *  empties OPFS. */
async function discard(): Promise<void> {
  await engine.stageView();
  await engine.discardWorkspace();
}

// Before as well as after: test files share one OPFS, and one that runs
// earlier, like `stage.test.ts`, may leave a workspace of its own behind.
beforeEach(discard);

afterEach(async () => {
  root?.unmount();
  host?.remove();
  root = host = router = null;
  // What the page draws is the editor's, not a document's, and outlives
  // the mount.
  useEditor.getState().setBoxes({ text: true, images: true });
  useEditor.getState().setIndices(true);
  await discard();
});

/** A workspace of `files`, committed. A name alone is a file whose bytes
 *  are its name: enough to list and open, not to draw. */
async function workspace(...files: (string | File)[]): Promise<void> {
  await engine.stage(
    files.map((f) => (typeof f === "string" ? new File([f], f) : f)),
  );
  await engine.commit();
}

/** US Letter, in points. */
const LETTER: [number, number] = [612, 792];

/** `a.pdf`, of `pages` letter pages, with `extras`. */
const pdf = (pages: number, extras?: PdfExtras) =>
  new File([pdfOf(Array(pages).fill(LETTER), extras)], "a.pdf");

/** The page the PDF pane says is current, once it says `n`. */
const onPage = (n: number) =>
  expect.element(page.getByLabelText("Page")).toHaveValue(String(n));

/** The PDF pane's three dots: the first of the two panes' menus. */
const pdfMenu = () => page.getByTitle("More").first();

/** The pages laid out in the PDF pane, and how many of them are drawn. */
const laidOut = () => document.querySelectorAll("[data-paper]").length;
const drawn = () => document.querySelectorAll("[data-paper] canvas").length;

/** Until the PDF pane has drawn a page. Longer than a poll's own second:
 *  the first document a test run opens starts pdf.js's worker. */
const pagesDrawn = () =>
  expect.poll(drawn, { timeout: 15_000 }).toBeGreaterThan(0);

/** The open tabs, by the id each one's title carries. */
const tabs = () =>
  Array.from(document.querySelectorAll('[role="tab"]')).map((t) =>
    t.getAttribute("title"),
  );

test("a document the workspace holds opens as a tab", async () => {
  await workspace("a.pdf", "deep/b.pdf");
  mount("/edit/deep/b");
  await expect.poll(tabs).toEqual(["deep/b"]);
  expect(router!.state.location.pathname).toBe("/edit/deep/b");
});

test("the autosave note stays clear of export, however long the workspace's name", async () => {
  await workspace("a.pdf");
  // As wide as the name is ever drawn: it is cut off past 24rem.
  await engine.renameWorkspace(
    "A workspace with a name long enough to be cut off",
  );
  mount("/edit");
  const note = page.getByText("Autosaved in this browser · export to keep it");
  const exportButton = page.getByRole("button", { name: "export" });
  // The narrowest window it is shown in, where it comes closest.
  await expect.element(note).toBeVisible();
  expect(note.element().getBoundingClientRect().right).toBeLessThan(
    exportButton.element().getBoundingClientRect().left,
  );
  // Any narrower, and it is not shown at all.
  await page.viewport(1279, 800);
  try {
    await expect.element(note).not.toBeVisible();
  } finally {
    await page.viewport(1280, 800);
  }
});

test("an address the workspace does not hold opens nothing, and says so", async () => {
  await workspace("a.pdf");
  mount("/edit/gone/missing");
  await expect.element(page.getByText("No such document")).toBeVisible();
  await expect.element(page.getByText("gone/missing")).toBeVisible();
  expect(router!.state.location.pathname).toBe("/edit");
  expect(tabs()).toEqual([]);
  // In place of the address, so Back does not return to it.
  expect(router!.state.historyAction).toBe("REPLACE");
});

test("an open document's pages are laid out, and the ones in view drawn", async () => {
  await workspace(new File([pdfOf([LETTER, LETTER, LETTER])], "a.pdf"));
  mount("/edit/a");
  await expect.element(page.getByText("/ 3")).toBeVisible();
  expect(laidOut()).toBe(3);
  await pagesDrawn();
  await expect.element(page.getByLabelText("Page")).toHaveValue("1");
});

test("the zoom steps from the fit, and two-page view pairs the pages", async () => {
  await workspace(new File([pdfOf([LETTER, LETTER, LETTER])], "a.pdf"));
  mount("/edit/a");
  await pagesDrawn();
  const width = () =>
    document.querySelector<HTMLElement>("[data-paper]")!.offsetWidth;
  const before = width();
  await page.getByTitle("Zoom in").click();
  await expect.poll(width).toBeGreaterThan(before);

  await pdfMenu().click();
  await page.getByRole("menuitemcheckbox", { name: "Two page view" }).click();
  // Three pages in two rows: the first two side by side, the third alone.
  await expect
    .poll(
      () =>
        document.querySelector("[data-paper]")!.parentElement!.children.length,
    )
    .toBe(2);
});

test("a page typed into the bar is the one it shows, however short the pages", () => {
  // Twelve Letter pages at 25%: rows about 264px tall, and a 900px view
  // whose probe, a third of the way down, falls in the row after the top one.
  const rows = layout(
    Array(12).fill({ w: 612, h: 792 }),
    0.25 * (96 / 72),
    false,
  );
  const top = rows[4].top - 8; // where `goTo(5)` scrolls
  expect(inView(rows, top, 900, false).current).toBe(5);
  // A tall page holding the probe, with the next starting below it, stays.
  const tall = layout(Array(3).fill({ w: 612, h: 792 }), 1.5, false);
  expect(inView(tall, tall[0].top + 200, 900, false).current).toBe(1);
});

test("fitted, two-page view fits both pages in the pane", async () => {
  await workspace(pdf(4));
  mount("/edit/a");
  await pagesDrawn();
  const zoom = () => document.querySelector("[data-paper]")!.clientWidth;
  const single = zoom();
  await pdfMenu().click();
  await page.getByRole("menuitemcheckbox", { name: "Two page view" }).click();
  await expect.poll(zoom).toBeLessThan(single);
  // Nothing to scroll sideways to.
  const column = document
    .querySelector("[data-paper]")!
    .closest(".overflow-auto")!;
  expect(column.scrollWidth).toBeLessThanOrEqual(column.clientWidth);
});

test("two-page view goes back to fitting, whatever zoom was picked", async () => {
  await workspace(pdf(4));
  mount("/edit/a");
  await pagesDrawn();
  await page.getByTitle("Zoom in").click();
  await page.getByTitle("Zoom in").click();
  await pdfMenu().click();
  await page.getByRole("menuitemcheckbox", { name: "Two page view" }).click();
  const column = () =>
    document.querySelector("[data-paper]")!.closest(".overflow-auto")!;
  await expect
    .poll(() => column().scrollWidth <= column().clientWidth)
    .toBe(true);
});

test("dragging the split moves the pages with it, and draws them once, after", async () => {
  await workspace(pdf(4));
  mount("/edit/a");
  await pagesDrawn();
  const paper = () => document.querySelector<HTMLElement>("[data-paper]")!;
  // Every canvas put into the first page's slot is one drawing of it.
  let drawings = 0;
  new MutationObserver(() => drawings++).observe(paper().firstElementChild!, {
    childList: true,
  });
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const divider = document.querySelector('[role="separator"]')!;
  const widths: number[] = [paper().offsetWidth];
  // A step a frame, as a drag moves it: each one re-lays the page by the
  // frame after, well inside the beat a drawing waits for.
  for (let i = 0; i < 4; i++) {
    divider.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    await frame();
    await frame();
    widths.push(paper().offsetWidth);
  }
  for (let i = 1; i < widths.length; i++)
    expect(widths[i]).toBeLessThan(widths[i - 1]);
  expect(drawings).toBe(0);
  await expect.poll(() => drawings).toBe(1);
});

test("the sidebar slides in, the pages follow it every frame, and both are drawn after", async () => {
  await workspace(pdf(4));
  mount("/edit/a");
  await pagesDrawn();
  const paper = () => document.querySelector<HTMLElement>("[data-paper]")!;
  // Every canvas put into the first page's slot is one drawing of it.
  let drawings = 0;
  new MutationObserver(() => drawings++).observe(paper().firstElementChild!, {
    childList: true,
  });
  const thumbs = () =>
    document.querySelectorAll('[role="tabpanel"] canvas').length;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const widths: number[] = [paper().offsetWidth];
  await page.getByTitle("Show sidebar").click();
  for (let i = 0; i < 5; i++) {
    await frame();
    widths.push(paper().offsetWidth);
  }
  // Narrower a step at a time, not all at once -- each frame's re-lay lands
  // after that frame's callback, so a reading can repeat -- and nothing
  // drawn meanwhile.
  const steps = widths.filter((w, i) => i === 0 || w !== widths[i - 1]);
  expect(steps.length).toBeGreaterThanOrEqual(4);
  for (let i = 1; i < steps.length; i++)
    expect(steps[i]).toBeLessThan(steps[i - 1]);
  expect(drawings).toBe(0);
  expect(thumbs()).toBe(0);
  await expect.poll(() => drawings).toBe(1);
  await expect.poll(thumbs).toBeGreaterThan(0);
});

test("the explorer slides away, and the pages follow it every frame and are drawn after", async () => {
  await workspace(pdf(4));
  mount("/edit/a");
  await pagesDrawn();
  const paper = () => document.querySelector<HTMLElement>("[data-paper]")!;
  let drawings = 0;
  new MutationObserver(() => drawings++).observe(paper().firstElementChild!, {
    childList: true,
  });
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const widths: number[] = [paper().offsetWidth];
  await page.getByTitle("Hide explorer").click();
  for (let i = 0; i < 5; i++) {
    await frame();
    widths.push(paper().offsetWidth);
  }
  // Wider a step at a time, as the split widens with the editor.
  const steps = widths.filter((w, i) => i === 0 || w !== widths[i - 1]);
  expect(steps.length).toBeGreaterThanOrEqual(4);
  for (let i = 1; i < steps.length; i++)
    expect(steps[i]).toBeGreaterThan(steps[i - 1]);
  expect(drawings).toBe(0);
  await expect.poll(() => drawings).toBe(1);
});

test("a picked zoom is drawn again on a screen of another pixel density", async () => {
  // The queries the pane asks the ratio through, so a change of screen can
  // be announced on them; and the ratio itself, put back after.
  const queries: MediaQueryList[] = [];
  const matchMedia = window.matchMedia.bind(window);
  const spy = vi.spyOn(window, "matchMedia").mockImplementation((q: string) => {
    const mql = matchMedia(q);
    if (q.includes("dppx")) queries.push(mql);
    return mql;
  });
  const ratio = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  try {
    await workspace(pdf(1));
    mount("/edit/a");
    await pagesDrawn();
    await page.getByTitle("Zoom in").click();
    const backing = () =>
      document.querySelector<HTMLCanvasElement>("[data-paper] canvas")!.width;
    const css = () =>
      document.querySelector<HTMLElement>("[data-paper]")!.clientWidth;
    await expect.poll(() => Math.abs(backing() - css())).toBeLessThan(2);

    Object.defineProperty(window, "devicePixelRatio", {
      value: 2,
      configurable: true,
    });
    for (const mql of [...queries]) mql.dispatchEvent(new Event("change"));
    await expect.poll(() => Math.abs(backing() - 2 * css())).toBeLessThan(3);
  } finally {
    spy.mockRestore();
    if (ratio) Object.defineProperty(window, "devicePixelRatio", ratio);
    else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
  }
});

test("a long document holds only the pages near the view", async () => {
  await workspace(pdf(60));
  mount("/edit/a");
  await pagesDrawn();
  expect(laidOut()).toBeLessThan(10);
  const input = page.getByLabelText("Page");
  await input.fill("45");
  await userEvent.keyboard("{Enter}");
  await onPage(45);
  await expect
    .poll(() => document.querySelector('[data-paper="45"] canvas'))
    .not.toBeNull();
  expect(document.querySelector('[data-paper="1"]')).toBeNull();
  expect(laidOut()).toBeLessThan(10);
});

test("a file that is not a PDF opens to a word on why, not a spinner", async () => {
  await workspace("a.pdf");
  mount("/edit/a");
  await expect
    .element(
      page.getByText(
        "This file is damaged or is not a PDF, and could not be opened.",
        { exact: true },
      ),
    )
    .toBeVisible();
  expect(laidOut()).toBe(0);
  // Nor is it read: the markdown pane says why instead of spinning.
  await expect
    .element(
      page.getByText(
        "Not read: This file is damaged or is not a PDF, and could not be opened.",
      ),
    )
    .toBeVisible();
  expect(document.querySelector('[role="status"]')).toBeNull();
});

test("document properties are the file's own, and close again", async () => {
  await workspace(pdf(2, { info: { Title: "Pump manual", Author: "Acme" } }));
  mount("/edit/a");
  await pagesDrawn();
  await pdfMenu().click();
  await page.getByRole("menuitem", { name: "Document properties" }).click();
  const dialog = page.getByRole("dialog");
  await expect.element(dialog.getByText("Pump manual")).toBeVisible();
  await expect.element(dialog.getByText("Acme")).toBeVisible();
  await expect.element(dialog.getByText("a.pdf")).toBeVisible();
  await expect
    .element(dialog.getByText("8.50 × 11.00 in (portrait)"))
    .toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect.element(dialog).not.toBeInTheDocument();
});

test("document properties close from the backdrop, not from a selection dragged onto it", async () => {
  await workspace(pdf(1, { info: { Title: "Pump manual" } }));
  mount("/edit/a");
  await pagesDrawn();
  await pdfMenu().click();
  await page.getByRole("menuitem", { name: "Document properties" }).click();
  const dialog = page.getByRole("dialog");
  await expect.element(dialog).toBeVisible();
  const box = dialog.element() as HTMLDialogElement;
  const title = dialog.getByText("Pump manual").element();
  // Pressed on the title, let go of over the backdrop: the click is the
  // dialog's own, as a backdrop click is.
  title.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  box.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(box.open).toBe(true);
  box.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  box.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await expect.element(dialog).not.toBeInTheDocument();
});

test("the thumbnails are drawn when shown, follow the page, and go to one", async () => {
  await workspace(pdf(10));
  mount("/edit/a");
  await pagesDrawn();
  const thumbs = () =>
    document.querySelectorAll('[role="tabpanel"] [data-page] canvas').length;
  // Hidden, none is drawn.
  expect(thumbs()).toBe(0);

  await page.getByTitle("Show sidebar").click();
  await expect.poll(thumbs).toBeGreaterThan(0);
  await page.getByTitle("Page 6").click();
  await onPage(6);
  await expect
    .element(page.getByTitle("Page 6"))
    .toHaveAttribute("aria-current", "page");
});

test("an outline entry goes to where it points", async () => {
  await workspace(
    pdf(10, {
      outline: [
        { title: "Intake", page: 4 },
        { title: "Outlet", page: 7 },
      ],
    }),
  );
  mount("/edit/a");
  await pagesDrawn();
  await page.getByTitle("Show sidebar").click();
  await page.getByRole("tab", { name: "Outline" }).click();
  await page.getByRole("button", { name: "Outlet" }).click();
  await onPage(7);
  await page.getByRole("button", { name: "Intake" }).click();
  await onPage(4);
});

test("a document with no outline has its tab, disabled", async () => {
  await workspace(pdf(2));
  mount("/edit/a");
  await pagesDrawn();
  await page.getByTitle("Show sidebar").click();
  await expect
    .element(page.getByTitle("This document has no outline"))
    .toBeDisabled();
});

// ---- the markdown pane ----------------------------------------------------

const GUIDE = "https://example.com/pumps/guide";

/** `a.pdf`: a title, three paragraphs -- the first a link to the guide --
 *  and a picture, drawn so the reader has something to read. */
const written = async (title = "Pump Care", name = "a.pdf") =>
  new File(
    [
      await buildPdf([
        (pen) => {
          pen.text(X, TOP, title, { size: 16, face: "bold" });
          pen.lines(X, TOP + PARAGRAPH, prose(3), { leading: PARAGRAPH });
          pen.link(X - 2, TOP + PARAGRAPH - 10, 420, 14, GUIDE);
          pen.image(X, TOP + 5 * PARAGRAPH, 200, 120, [100, 60]);
        },
      ]),
    ],
    name,
  );

/** Where `a`'s reading stands in the store. */
const readingOf = (doc = "a") => useEditor.getState().readings[doc];

/** The raw view's lines, as written. */
const sourceLines = () =>
  Array.from(document.querySelectorAll(".source > li")).map(
    (li) => li.textContent,
  );

test("an open document is read, and its markdown shown as it reads and as its source", async () => {
  await workspace(await written());
  mount("/edit/a");
  await expect
    .element(page.getByRole("heading", { name: "Pump Care" }), {
      timeout: 15_000,
    })
    .toBeVisible();
  await expect.element(page.getByText(prose(1)[0])).toBeVisible();
  // A link the document carries opens in a tab of its own, not over the
  // editor and every document open in it.
  const link = page.getByRole("link", { name: prose(1)[0] });
  await expect.element(link).toHaveAttribute("href", GUIDE);
  await expect.element(link).toHaveAttribute("target", "_blank");
  await expect.element(link).toHaveAttribute("rel", "noopener noreferrer");
  // The figure, from the workspace, at the size it is printed: 200pt wide
  // is 267 CSS px, whatever pixels it was drawn at.
  await expect
    .poll(() => document.querySelector<HTMLImageElement>(".markdown img")?.src)
    .toMatch(/^blob:/);
  expect(document.querySelector(".markdown img")?.getAttribute("width")).toBe(
    "267",
  );

  await page.getByRole("radio", { name: "raw" }).click();
  await expect.poll(sourceLines).toContain("# Pump Care");
  // A blank line copies as nothing, not a space.
  expect(sourceLines()[1]).toBe("");
  const rows = document.querySelectorAll<HTMLElement>(".source > li");
  expect(rows[1].offsetHeight).toBe(rows[0].offsetHeight);
  expect(sourceLines()).toContain("![page 1 figure 1](a.assets/p1-i0.png)");
});

test("the markdown's document properties measure what was written, figures and all", async () => {
  await workspace(await written());
  mount("/edit/a");
  // Nothing to measure until the markdown is there.
  const menu = page.getByTitle("More").last();
  await expect.element(menu).toBeDisabled();
  await expect.element(menu, { timeout: 15_000 }).toBeEnabled();
  await menu.click();
  await page.getByRole("menuitem", { name: "Document properties" }).click();
  const dialog = page.getByRole("dialog");
  const reading = readingOf();
  if (reading?.status !== "ready") throw new Error("not read");
  const text = reading.markdown.text;
  const row = (label: string) =>
    dialog.getByText(`${label}:`).element().nextElementSibling?.textContent;
  await expect.element(dialog.getByText("a.md")).toBeVisible();
  // Every line ends in a break, the last one included.
  expect(row("Lines")).toBe(String(text.split("\n").length - 1));
  expect(row("Text")).toBe(`${new TextEncoder().encode(text).length} B`);
  await expect.poll(() => row("Media")).toMatch(/ \(1 figure\)$/);
  expect(row("Renders in")).toBe("CommonMark");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect.element(dialog).not.toBeInTheDocument();
});

test("a reading goes on while its tab is switched away from, and the next pane shows it", async () => {
  // The reading is held at its last step -- the engine writing it down --
  // long enough to switch tabs under it.
  const write = engine.convert.bind(engine);
  const convert = vi
    .spyOn(engine, "convert")
    .mockImplementation(async (...args) => {
      await new Promise((r) => setTimeout(r, 600));
      return write(...args);
    });
  const forgotten: boolean[] = [];
  const unsubscribe = useEditor.subscribe((s) =>
    forgotten.push(s.readings["a"] === undefined),
  );
  try {
    await workspace(await written(), await written("Valve Care", "b.pdf"));
    mount("/edit/a");
    await expect
      .poll(
        () => {
          const reading = readingOf();
          return reading?.status === "reading" && reading.page >= reading.pages;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await router!.navigate("/edit/b");
    await expect.poll(() => tabs().slice(0, 2)).toEqual(["a", "b"]);
    await expect
      .element(page.getByRole("heading", { name: "Valve Care" }), {
        timeout: 15_000,
      })
      .toBeVisible();
    await router!.navigate("/edit/a");
    await expect
      .element(page.getByRole("heading", { name: "Pump Care" }), {
        timeout: 15_000,
      })
      .toBeVisible();
    // Read once, never from page one again, and never shown as unread.
    expect(convert).toHaveBeenCalledTimes(2); // Once each document.
    expect(forgotten).not.toContain(true);
  } finally {
    unsubscribe();
    convert.mockRestore();
  }
});

test("closing a tab mid-read gives the reading up, and the next open reads afresh", async () => {
  // The first reading held before its first page until the close has
  // landed, so the close is mid-read however long the click takes -- held
  // for a time instead, a slow click lands after the reading has got as far
  // as the write, which it then finishes, unshown, as it should.
  const analysis = engine.analysis.bind(engine);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const spy = vi
    .spyOn(engine, "analysis")
    .mockImplementationOnce(async (id) => {
      await held;
      return analysis(id);
    });
  const convert = vi.spyOn(engine, "convert");
  try {
    await workspace(await written());
    mount("/edit/a");
    await expect.poll(() => readingOf()?.status).toBe("reading");
    await page.getByRole("button", { name: "Close a" }).click();
    await expect.poll(tabs).toEqual([]);
    await expect.poll(() => readingOf()).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    release();
    // Given up, so nothing was written down for it: it stops as its
    // analysis comes back, before any page.
    await spy.mock.results[0].value;
    await new Promise((r) => setTimeout(r, 0));
    // By count: the calls themselves hold bytes sent to the worker, which
    // cannot be printed.
    expect(convert.mock.calls.length).toBe(0);
    expect(readingOf()).toBeUndefined();

    await router!.navigate("/edit/a");
    await expect
      .element(page.getByRole("heading", { name: "Pump Care" }), {
        timeout: 15_000,
      })
      .toBeVisible();
    expect(convert.mock.calls.length).toBe(1);
  } finally {
    release();
    convert.mockRestore();
    spy.mockRestore();
  }
});

test("a figure holds its place at its size while its pixels are read", async () => {
  const asset = vi
    .spyOn(engine, "asset")
    .mockImplementation(() => new Promise(() => {}));
  try {
    await workspace(await written());
    mount("/edit/a");
    await expect
      .poll(() => document.querySelector<HTMLElement>(".figure-wait"), {
        timeout: 15_000,
      })
      .not.toBeNull();
    expect(
      document.querySelector<HTMLElement>(".figure-wait")!.style.width,
    ).toBe("267px");
    expect(document.querySelector(".markdown img")).toBeNull();
    expect(document.querySelector(".markdown")!.textContent).not.toContain(
      "[page 1 figure 1]",
    );
  } finally {
    asset.mockRestore();
  }
});

test("a document that cannot be read says why in the markdown pane", async () => {
  const convert = vi
    .spyOn(engine, "convert")
    .mockRejectedValue(new Error("no room"));
  try {
    await workspace(await written());
    mount("/edit/a");
    await expect
      .element(page.getByText("This document could not be read (no room)."), {
        timeout: 15_000,
      })
      .toBeVisible();
  } finally {
    convert.mockRestore();
  }
});

test("closing a document's tab lets go of its reading", async () => {
  await workspace(await written());
  mount("/edit/a");
  await expect
    .element(page.getByRole("heading", { name: "Pump Care" }), {
      timeout: 15_000,
    })
    .toBeVisible();
  expect(useEditor.getState().readings["a"]?.status).toBe("ready");
  await page.getByRole("button", { name: "Close a" }).click();
  await expect.poll(tabs).toEqual([]);
  // Once the tab's panes are gone, which is after the tab is.
  await expect.poll(() => useEditor.getState().readings["a"]).toBeUndefined();
});

test("a document of the same name in the next workspace is read afresh", async () => {
  await workspace(await written());
  mount("/edit/a");
  await expect
    .element(page.getByRole("heading", { name: "Pump Care" }), {
      timeout: 15_000,
    })
    .toBeVisible();
  // Out to the landing, where the workspace is discarded and another made.
  root!.unmount();
  host!.remove();
  await engine.stageView();
  await engine.discardWorkspace();
  await workspace(await written("Valve Care"));
  mount("/edit/a");
  await expect
    .element(page.getByRole("heading", { name: "Valve Care" }), {
      timeout: 15_000,
    })
    .toBeVisible();
});

// ---- the blocks on the page -----------------------------------------------

/** Page `n` as laid out in the PDF pane. */
const paper = (n = 1) =>
  document.querySelector<HTMLElement>(`[data-paper="${n}"]`)!;
/** The boxes drawn over page `n`, in the order they are stacked. */
const boxesOn = (n = 1) =>
  Array.from(paper(n).querySelectorAll<HTMLElement>(".hit"));
/** The numbers on page `n`'s boxes, in the order they are stacked. */
const numbersOn = (n = 1) =>
  boxesOn(n).flatMap((b) => {
    const note = b.querySelector(".note");
    return note ? [note.textContent] : [];
  });
/** `a`'s reading, once it is ready. */
async function ready(): Promise<Extract<Reading, { status: "ready" }>> {
  await expect
    .poll(() => readingOf()?.status, { timeout: 15_000 })
    .toBe("ready");
  return readingOf() as Extract<Reading, { status: "ready" }>;
}
/** Where `el` is on page `n`, in CSS px. */
function onPaper(el: Element, n = 1) {
  const at = el.getBoundingClientRect();
  const p = paper(n).getBoundingClientRect();
  return {
    x: at.left - p.left,
    y: at.top - p.top,
    right: at.right - p.left,
    w: at.width,
    h: at.height,
  };
}
/** Toggle the Boxes flyout's option for `kind`, leaving it open: what is
 *  clicked next in the bar must be reachable with it so. */
async function toggleBoxes(kind: "text" | "images"): Promise<void> {
  await page.getByRole("button", { name: "Boxes" }).click();
  await page
    .getByRole("group", { name: "Boxes on the page" })
    .getByRole("button", { name: kind, exact: true })
    .click();
}

test("every block the page read is boxed where it is printed, numbered as the markdown counts it", async () => {
  await workspace(await written());
  mount("/edit/a");
  const { analysis, markdown } = await ready();
  await pagesDrawn();
  const blocks = analysis.pages[0].blocks;
  expect(blocks.map((b) => b.kind)).toContain("image");
  await expect.poll(() => boxesOn().length).toBe(blocks.length);

  // Each box is its block's, a hair outside the box the reading gave at the
  // page's scale: at 3px and 2px, whatever the zoom.
  const check = () => {
    const scale = paper().getBoundingClientRect().width / LETTER[0];
    for (const block of blocks) {
      const at = onPaper(paper().querySelector(`[data-block="${block.id}"]`)!);
      expect(Math.abs(at.x - (block.box.x * scale - 3))).toBeLessThan(1);
      expect(Math.abs(at.y - (block.box.y * scale - 2))).toBeLessThan(1);
      expect(Math.abs(at.w - (block.box.w * scale + 6))).toBeLessThan(1);
      expect(Math.abs(at.h - (block.box.h * scale + 4))).toBeLessThan(1);
    }
  };
  check();
  const before = paper().getBoundingClientRect().width;
  await page.getByTitle("Zoom in").click();
  await expect
    .poll(() => paper().getBoundingClientRect().width)
    .toBeGreaterThan(before);
  check();

  // The number on a box is the one the markdown counts its block by: one
  // list, from 1 on the page, the picture's under the text's.
  for (const el of boxesOn())
    expect(el.querySelector(".note")?.textContent).toBe(
      String(markdown.blocks[el.dataset.block!].n),
    );
  expect(
    numbersOn()
      .map(Number)
      .sort((a, b) => a - b),
  ).toEqual(blocks.map((_, i) => i + 1));
  expect(boxesOn()[0].dataset.kind).toBe("image");

  // Drawn only: what is under a box is what a click reaches.
  const box = boxesOn()[0].getBoundingClientRect();
  const under = document.elementFromPoint(
    box.left + box.width / 2,
    box.top + box.height / 2,
  );
  expect(under?.closest(".hit")).toBeNull();
});

test("the tool bar turns the boxes and the numbers off and on, for every document", async () => {
  await workspace(await written());
  mount("/edit/a");
  const { analysis } = await ready();
  await pagesDrawn();
  const all = analysis.pages[0].blocks.length;
  await expect.poll(() => boxesOn().length).toBe(all);
  const ringed = () => boxesOn().filter((b) => !b.matches(".quiet"));

  // The numbers off: every box, none numbered.
  await page.getByRole("button", { name: "Indices" }).click();
  await expect.poll(() => numbersOn()).toEqual([]);
  expect(boxesOn()).toHaveLength(all);

  // The text's boxes off: the picture's alone.
  await toggleBoxes("text");
  await expect
    .poll(() => boxesOn().map((b) => b.dataset.kind))
    .toEqual(["image"]);

  // Both off: nothing over the page at all.
  await toggleBoxes("images");
  await expect.poll(() => boxesOn().length).toBe(0);
  expect(paper().querySelector("[aria-hidden] [data-block]")).toBeNull();

  // The numbers on again, with no boxes: each on a box that draws nothing.
  // Clicked with the flyout still open, which lies clear of the button.
  await expect
    .element(page.getByRole("group", { name: "Boxes on the page" }))
    .toBeVisible();
  await page.getByRole("button", { name: "Indices" }).click();
  await expect.poll(() => numbersOn().length).toBe(all);
  expect(ringed()).toEqual([]);

  // And it is the editor's setting, not the document's: the next document
  // opened is drawn the same.
  expect(useEditor.getState().boxes).toEqual({ text: false, images: false });
  expect(useEditor.getState().indices).toBe(true);
});

test("a number hangs in the margin, and a block printed to the edge is boxed and numbered on the paper", async () => {
  await workspace(
    new File(
      [
        await buildPdf([
          (pen) => {
            pen.text(X, TOP, "Edge to Edge", { size: 16, face: "bold" });
            pen.lines(X, TOP + PARAGRAPH, prose(10), { leading: PARAGRAPH });
            // Full bleed, after enough blocks that its number has two
            // digits: no margin to the left of it at all.
            pen.image(0, TOP + 11 * PARAGRAPH, LETTER[0], 160, [100, 60]);
          },
        ]),
      ],
      "a.pdf",
    ),
  );
  mount("/edit/a");
  await ready();
  await pagesDrawn();
  await expect.poll(() => numbersOn().length).toBe(12);

  const [picture, heading] = boxesOn();
  expect(picture.dataset.kind).toBe("image");
  const noteOf = (b: HTMLElement) => b.querySelector(".note")!;
  expect(noteOf(picture).textContent).toBe("12");
  // The heading's number left of its box, clear of the words in it.
  const words = onPaper(heading);
  const hung = onPaper(noteOf(heading));
  expect(hung.right).toBeLessThanOrEqual(words.x + 3);
  expect(hung.x).toBeGreaterThan(0);
  // The picture's box on the paper, ring and all, though the picture
  // runs to both its edges -- and its number slid back over its corner,
  // its whole width on the page, not cut off past the page's edge.
  const bleed = onPaper(picture);
  const width = paper().getBoundingClientRect().width;
  expect(bleed.x).toBeGreaterThanOrEqual(1);
  expect(bleed.right).toBeLessThanOrEqual(width - 1);
  const slid = onPaper(noteOf(picture));
  expect(slid.x).toBeGreaterThanOrEqual(0);
  expect(slid.x).toBeLessThan(2);
});

// ---- the scroll sync ------------------------------------------------------

/** `a.pdf`: `count` pages, three unless said, each a section title over a
 *  column of paragraphs, long enough that both panes scroll. */
const sections = async (count = 3) =>
  new File(
    [
      await buildPdf(
        Array.from({ length: count }, (_, i) => i + 1).map(
          (n) => (pen: Pen) => {
            pen.text(X, TOP, `Section ${n}`, { size: 16, face: "bold" });
            pen.lines(X, TOP + PARAGRAPH, prose(24, n), { leading: PARAGRAPH });
          },
        ),
      ),
    ],
    "a.pdf",
  );

const pdfScroller = () =>
  document
    .querySelector("[data-paper]")!
    .closest<HTMLElement>(".overflow-auto")!;
const markdownScroller = () =>
  document.querySelector(".markdown")!.parentElement!;
/** Scroll `el` to `top`, as a person would: nothing else is needed for
 *  it to lead, whatever moved it. */
async function scrollTo(el: HTMLElement, top: number): Promise<void> {
  el.scrollTop = top;
  // A scroll event is sent before the next frame is drawn -- or not at all,
  // if it was there already.
  await new Promise((done) =>
    requestAnimationFrame(() => requestAnimationFrame(done)),
  );
}
const room = (el: HTMLElement) => el.scrollHeight - el.clientHeight;
/** How long to wait on the other pane: a follow may wait on the layout
 *  holding still and a frame after, which under the whole suite's load runs
 *  well past the default second. */
const settle = { timeout: 5_000 };

test("scrolling either pane takes the other to the same place", async () => {
  await workspace(await sections());
  mount("/edit/a");
  await expect
    .element(page.getByRole("heading", { name: "Section 1" }), {
      timeout: 15_000,
    })
    .toBeVisible();
  await pagesDrawn();
  const [pdf, md] = [pdfScroller(), markdownScroller()];
  expect(room(pdf)).toBeGreaterThan(0);
  expect(room(md)).toBeGreaterThan(0);

  // The ends go to the ends.
  await scrollTo(pdf, room(pdf));
  await expect.poll(() => md.scrollTop, settle).toBeCloseTo(room(md), 0);
  await scrollTo(pdf, 0);
  await expect.poll(() => md.scrollTop, settle).toBe(0);

  // The sync lines up the line each pane is looking at: from the view's
  // top edge when scrolled to the top to its bottom edge at the bottom.
  const probe = (el: HTMLElement) =>
    el.scrollTop + (el.scrollTop / room(el)) * el.clientHeight;
  /** Where `el`'s child starts in its content. */
  const inContent = (el: HTMLElement, child: Element) =>
    child.getBoundingClientRect().top -
    el.getBoundingClientRect().top +
    el.scrollTop;
  // Section 2's title on the markdown's line puts the PDF's on page 2,
  // near its top: where that title is printed.
  const heading = await page
    .getByRole("heading", { name: "Section 2" })
    .element();
  // Aimed at where the title is printed once the pages above it are laid
  // out, which until a scroll brings them into view they may not be: a
  // page out of view is skipped at an estimate, and laid out as it comes
  // in -- moving the title down past where it was aimed at. So scrolled
  // again, as a person would, until the title and the markdown's length
  // hold still.
  let aimed = "";
  for (let tries = 0; tries < 5; tries++) {
    const at = inContent(md, heading);
    const now = `${Math.round(at)}:${md.scrollHeight}`;
    if (now === aimed) break;
    aimed = now;
    await scrollTo(md, at / (1 + md.clientHeight / room(md)));
  }
  // By number: the column holds only the pages near the view, so which is
  // second in the DOM depends on where it is scrolled.
  const second = document.querySelector('[data-paper="2"]')!;
  const pageTop = inContent(pdf, second);
  const pageHeight = second.getBoundingClientRect().height;
  // Both bounds in the one poll: the pages may be seen on their way.
  await expect
    .poll(() => probe(pdf) - pageTop, settle)
    .toSatisfy((into: number) => into > 0 && into < pageHeight / 4);

  // And the markdown leads as well as follows.
  await scrollTo(md, room(md));
  await expect.poll(() => pdf.scrollTop, settle).toBeCloseTo(room(pdf), 0);

  // Whatever moves it -- keys, a trackpad's glide, the scrollbar -- with no
  // pointer anywhere near: a pane that scrolls on its own leads.
  await scrollTo(pdf, 0);
  await expect.poll(() => md.scrollTop, settle).toBe(0);
  md.scrollTop = room(md);
  await expect.poll(() => pdf.scrollTop, settle).toBeCloseTo(room(pdf), 0);

  // The source view is followed too, laid out anew -- and put where the
  // pages are as soon as it is, not left at the rendered view's offset.
  await scrollTo(pdf, room(pdf));
  await page.getByRole("radio", { name: "raw" }).click();
  await expect.poll(sourceLines).toContain("# Section 2");
  await expect.poll(() => md.scrollTop, settle).toBeCloseTo(room(md), 0);
  await scrollTo(pdf, 0);
  await expect.poll(() => md.scrollTop, settle).toBe(0);
  await scrollTo(pdf, room(pdf));
  await expect.poll(() => md.scrollTop, settle).toBeCloseTo(room(md), 0);
}, 30_000);

test("a long document's markdown is there at once, and the rest drawn in while the panes keep in step", async () => {
  // Sixty pages are more than the pane draws in one go, so it draws the
  // first and waits the rest -- each a placeholder named by its page.
  await workspace(await sections(60));
  const seen = new Set<string>();
  const watch = new MutationObserver((changes) => {
    for (const change of changes)
      for (const node of change.addedNodes)
        if (node instanceof HTMLElement)
          for (const el of [
            node,
            ...node.querySelectorAll<HTMLElement>("[data-wait]"),
          ])
            if (el.dataset.wait) seen.add(el.dataset.wait);
  });
  watch.observe(document.body, { childList: true, subtree: true });
  try {
    mount("/edit/a");
    await expect
      .element(page.getByRole("heading", { name: "Section 1", exact: true }), {
        timeout: 30_000,
      })
      .toBeVisible();
    await pagesDrawn();
    const [pdf, md] = [pdfScroller(), markdownScroller()];
    // Taken to the end while the pages are drawn in: the markdown is put at
    // its end, however much of it is drawn yet, and stays there as the
    // rest arrives.
    await scrollTo(pdf, room(pdf));
    await expect
      .poll(
        () => document.querySelector(".markdown")!.getAttribute("aria-busy"),
        {
          timeout: 15_000,
        },
      )
      .toBe("false");
    expect(seen.size).toBeGreaterThan(0);
    expect(seen.has("1")).toBe(false);
    expect(document.querySelector("[data-wait]")).toBeNull();
    await expect.poll(() => md.scrollTop, settle).toBeCloseTo(room(md), 0);
    const last = Array.from(
      document.querySelectorAll('.markdown [data-block^="p60b"]'),
    ).at(-1)!;
    await expect.element(page.elementLocator(last)).toBeInViewport();
    // Every page's markdown is there, once each, in order.
    const titles = Array.from(
      document.querySelectorAll(".markdown h1, .markdown h2"),
      (h) => h.textContent,
    );
    expect(titles).toEqual(
      Array.from({ length: 60 }, (_, i) => `Section ${i + 1}`),
    );
  } finally {
    watch.disconnect();
  }
}, 90_000);
