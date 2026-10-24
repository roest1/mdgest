/** The editor over the real engine, at the address it is opened on: one
 *  the workspace holds opens as a tab, and one it does not -- mistyped, or
 *  kept from before a document went -- is let go of rather than opened.
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
import Editor from "src/routes/Editor";

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

/** A workspace of `names`, committed. */
async function workspace(...names: string[]): Promise<void> {
  await engine.stage(names.map((n) => new File([n], n)));
  await engine.commit();
}

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
