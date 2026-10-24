/** The editor over the real engine, at the address it is opened on: one
 *  the workspace holds opens as a tab, and one it does not -- mistyped, or
 *  kept from before a document went -- is let go of rather than opened. An
 *  open document's pages are drawn in the PDF pane, through pdf.js.
 *
 * As in `landing.test.ts`, nothing is mocked between the page and OPFS. The
 * workspace is committed through the engine, and the browser's copy of it
 * discarded after each test, so the next starts from nothing. */

import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { engine } from "src/lib/engine";
import { inView, layout } from "src/components/editor/column";
import Editor from "src/routes/Editor";
import { pdfOf } from "./harness";

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

afterEach(async () => {
  root?.unmount();
  host?.remove();
  root = host = router = null;
  // The browser's workspace is staged on a first look, and discarding it
  // empties OPFS.
  await engine.stageView();
  await engine.discardWorkspace();
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

/** The pages laid out in the PDF pane, and how many of them are drawn. */
const laidOut = () => document.querySelectorAll("[data-page]").length;
const drawn = () => document.querySelectorAll("[data-page] canvas").length;

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
  await workspace(new File([pdfOf(LETTER, LETTER, LETTER)], "a.pdf"));
  mount("/edit/a");
  await expect.element(page.getByText("/ 3")).toBeVisible();
  expect(laidOut()).toBe(3);
  await expect.poll(drawn).toBeGreaterThan(0);
  await expect.element(page.getByLabelText("Page")).toHaveValue("1");
});

test("the zoom steps from the fit, and two-page view pairs the pages", async () => {
  await workspace(new File([pdfOf(LETTER, LETTER, LETTER)], "a.pdf"));
  mount("/edit/a");
  await expect.poll(drawn).toBeGreaterThan(0);
  const width = () =>
    document.querySelector<HTMLElement>("[data-page]")!.offsetWidth;
  const before = width();
  await page.getByTitle("Zoom in").click();
  await expect.poll(width).toBeGreaterThan(before);

  // The PDF pane's, the first of the two panes' menus.
  await page.getByTitle("More").first().click();
  await page.getByRole("menuitemcheckbox", { name: "Two page view" }).click();
  // Three pages in two rows: the first two side by side, the third alone.
  await expect
    .poll(
      () =>
        document.querySelector("[data-page]")!.parentElement!.children.length,
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

test("a file that is not a PDF opens to a word on why, not a spinner", async () => {
  await workspace("a.pdf");
  mount("/edit/a");
  await expect
    .element(
      page.getByText(
        "This file is damaged or is not a PDF, and could not be opened.",
      ),
    )
    .toBeVisible();
  expect(laidOut()).toBe(0);
});
