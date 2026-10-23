/** The landing over the real engine: what a drop lists, how a conflict is
 *  settled from the page, what commit and discard ask first, and what each
 *  leaves on screen.
 *
 * The engine's own decisions are `stage.test.ts`'s to check. This asks the
 * one thing it cannot: that the page shows those decisions, and that every
 * button reaches the engine and comes back as the next view. So the files
 * go in the way they do in the app -- a drop on the zone -- and nothing is
 * mocked between the page and OPFS.
 *
 * `engine.ts` is one worker for the life of the page, seeded from OPFS on
 * its first look. The unreadable case needs that first look to find a bad
 * manifest, so it goes first; every test after it starts from a stage
 * drained through the engine's own calls. The worker outlives a mount, so
 * `revisit` is a second visit to the landing, not a second engine. */

import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import type * as Opfs from "src/lib/opfs";
import { engine } from "src/lib/engine";
import { MANIFEST as MANIFEST_NAME } from "src/lib/workspace";
import Landing from "src/routes/Landing";
import { Client } from "./harness";

/** Writes beside the engine, into the same OPFS, the way another tab would. */
const opfs = new Client(new URL("./worker.ts", import.meta.url)).bind<
  typeof Opfs
>("opfs");

let root: Root | null = null;
let host: HTMLElement | null = null;

/** The landing at its route, and anywhere else as a stand-in for the
 *  editor, so a commit leaves the landing the way it does in the app. */
function mount(): void {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const router = createMemoryRouter([
    { path: "/", element: createElement(Landing) },
    { path: "*", element: createElement("p", null, "the editor") },
  ]);
  root.render(createElement(RouterProvider, { router }));
}

function unmount(): void {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
}

/** Coming back to the landing, which after a commit is the only way to it:
 *  one more first look, seeded from OPFS the way an earlier visit leaves it. */
function revisit(): void {
  unmount();
  mount();
}

/** The landing has gone, which is the last thing a commit does. */
async function left(): Promise<void> {
  await expect
    .element(page.getByText("the editor", { exact: true }))
    .toBeVisible();
}

/** Everything staged, taken out through the engine, so the next test's
 *  first look finds nothing. A workspace is discarded whole; unstaging a
 *  kept copy brings back what `keep` set aside, so that goes round until
 *  the listing is empty. */
async function drain(): Promise<void> {
  let view = await engine.discardWorkspace();
  for (let i = 0; i < 20 && view.rows.length; i++)
    for (const row of view.rows)
      for (const c of row.candidates)
        view = await engine.unstage(row.docId, c.sha256);
  if (view.rows.length) throw new Error("the stage would not drain");
}

afterEach(async () => {
  unmount();
  await drain();
});

/** A file as the drop zone hands it on: its name is its path in the drop. */
const file = (path: string, text = path) => new File([text], path);

/** A drop on the zone. Synthetic items carry no entry, so the zone takes
 *  each as a plain file, which is the path a picked file takes too. */
async function drop(...files: File[]): Promise<void> {
  // The first render is not synchronous with `mount`.
  const zone = await vi.waitFor(() => {
    const el = document.querySelector(".upload-zone");
    if (!el) throw new Error("no drop zone on the page");
    return el;
  });
  const dataTransfer = new DataTransfer();
  for (const f of files) dataTransfer.items.add(f);
  zone.dispatchEvent(
    new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
  );
}

/** The tree as drawn: each row's name and its mark, in order. */
function rows(): string[] {
  return Array.from(document.querySelectorAll('li[role="treeitem"]')).map(
    (li) => {
      const name = li.querySelector(".marquee-view > span")?.textContent ?? "";
      const mark = li.querySelector(":scope > div span.uppercase")?.textContent;
      return mark ? `${name} [${mark}]` : name;
    },
  );
}

const button = (name: string | RegExp) => page.getByRole("button", { name });
const text = (t: string | RegExp) => page.getByText(t);

test("a workspace that cannot be read is said first, and discarding it clears the way", async () => {
  await opfs("writeText", [MANIFEST_NAME], "{");
  mount();
  await expect.element(text(/could not be opened/)).toBeVisible();
  expect(rows()).toEqual([]);

  // The one copy of whatever was in the browser: asked about, then gone.
  await button("discard").click();
  await expect.element(text("Discard it from this browser?")).toBeVisible();
  await button("Discard").click();
  await expect.element(text(/could not be opened/)).not.toBeInTheDocument();

  await drop(file("a.pdf"));
  await expect.poll(rows).toEqual(["a"]);
  expect(await opfs("manifestText")).toBeNull();
});

test("a drop lists its files, folders folded, and taking one out is a round trip", async () => {
  mount();
  await drop(file("deep/b.pdf"), file("a.pdf"));
  // A fresh workspace marks nothing: every row is new.
  await expect.poll(rows).toEqual(["deep/", "b", "a"]);
  await expect.element(button("Create new workspace")).toBeEnabled();

  await button("Remove b").click();
  await expect.poll(rows).toEqual(["a"]);
  expect((await engine.stageView()).rows.map((r) => r.docId)).toEqual(["a"]);
});

test("a conflict blocks the button until one copy is kept or renamed", async () => {
  mount();
  await drop(file("a.pdf", "x"), file("A.PDF", "y"), file("b.pdf"));
  await expect.poll(rows).toEqual(["a [conflict]", "b"]);
  await expect.element(text("1 conflict")).toBeVisible();
  await expect.element(button("Create new workspace")).toBeDisabled();
  await expect.element(text("Resolve 1 conflict to continue.")).toBeVisible();

  // Renaming onto a listed id is refused as it is typed, before the engine
  // is asked.
  await button(/^Rename A\.PDF/).click();
  const name = page.getByRole("textbox", { name: "New name for A.PDF" });
  await name.fill("b");
  await expect.element(text("b is already taken.")).toBeVisible();
  await expect.element(button("Rename")).toBeDisabled();

  await name.fill("a-copy");
  await expect.element(text("→ a-copy")).toBeVisible();
  await button("Rename").click();
  await expect.poll(rows).toEqual(["a", "a-copy", "b"]);
  await expect.element(button("Create new workspace")).toBeEnabled();
});

test("keep settles a conflict the other way", async () => {
  mount();
  await drop(file("a.pdf", "x"), file("A.PDF", "y"));
  await expect.poll(rows).toEqual(["a [conflict]"]);
  await button(/^Keep A\.PDF/).click();
  await expect.poll(rows).toEqual(["a"]);
  const [row] = (await engine.stageView()).rows;
  expect(row.candidates.map((c) => c.name)).toEqual(["A.PDF"]);
});

test("commit writes the workspace", async () => {
  mount();
  await drop(file("a.pdf"), file("deep/b.pdf"));
  // Folders first, as a file manager lists them.
  await expect.poll(rows).toEqual(["deep/", "b", "a"]);
  await button("Create new workspace").click();
  // The handler commits and then leaves, in that order.
  await left();
  expect(await engine.docs()).toEqual(["a", "deep/b"]);
});

test("a revised source is asked about before it is replaced", async () => {
  mount();
  await drop(file("a.pdf", "v1"));
  await expect.poll(rows).toEqual(["a"]);
  await button("Create new workspace").click();
  await left();

  // A later visit is where the committed workspace is seen listed, and
  // where a revision of it is dropped.
  revisit();
  await expect.element(text(/Workspace in this browser/)).toBeVisible();
  await expect.element(text(/1 document/)).toBeVisible();
  await expect.poll(rows).toEqual(["a"]);
  await expect.element(button("Continue workspace")).toBeVisible();
  // The browser's own documents are the editor's to remove, not the landing's.
  expect(document.querySelector('[aria-label="Remove a"]')).toBeNull();

  // Other bytes under the browser's own id are a conflict first: the copy in
  // the browser against the one dropped. Only the arriving copy can be
  // renamed away; keeping it is what makes the row a revision.
  await drop(file("a.pdf", "v2"));
  await expect.poll(rows).toEqual(["a [conflict]"]);
  await expect.element(button(/^Keep copy in this browser/)).toBeVisible();
  expect(
    document.querySelector('[aria-label^="Rename copy in this browser"]'),
  ).toBeNull();
  await expect.element(button(/^Rename a\.pdf/)).toBeVisible();
  await button(/^Keep a\.pdf/).click();
  await expect.poll(rows).toEqual(["a [revised]"]);
  await expect.element(text("1 revised")).toBeVisible();
  await button("Continue workspace").click();
  await expect.element(text(/This will replace/)).toBeVisible();
  await expect.element(text("a.pdf")).toBeVisible();

  // Cancelled: nothing written, the row still revised.
  await button("Cancel").click();
  await expect.poll(rows).toEqual(["a [revised]"]);
  expect(await opfs("readText", ["sources", "a.pdf"])).toBe("v1");

  await button("Continue workspace").click();
  await button("Replace and continue").click();
  // Confirmed, and this time the bytes in the browser are the ones dropped.
  // The listing is not looked at again: replacing leaves for the editor.
  await expect.poll(() => opfs("readText", ["sources", "a.pdf"])).toBe("v2");
});

test("discarding the browser's workspace is confirmed, and keeps loose copies", async () => {
  mount();
  await drop(file("a.pdf"));
  await expect.poll(rows).toEqual(["a"]);
  await button("Create new workspace").click();
  await left();
  revisit();
  await expect.element(button("Continue workspace")).toBeVisible();
  await drop(file("b.pdf"));
  await expect.poll(rows).toEqual(["a", "b [new]"]);

  await button("discard").click();
  await expect.element(text("Discard it from this browser?")).toBeVisible();
  await button("Keep").click();
  await expect
    .element(text("Discard it from this browser?"))
    .not.toBeInTheDocument();
  await expect.poll(rows).toEqual(["a", "b [new]"]);

  await button("discard").click();
  await button("Discard").click();
  await expect.poll(rows).toEqual(["b"]);
  await expect.element(button("Create new workspace")).toBeVisible();
  expect(await opfs("manifestText")).toBeNull();
});

test("an uploaded workspace is forgotten without a question", async () => {
  mount();
  await drop(
    file(`ws/${MANIFEST_NAME}`, JSON.stringify({ format: 1, documents: {} })),
    file("ws/sources/one.pdf"),
  );
  await expect.element(text(/^ws\//)).toBeVisible();
  // The count is what the manifest lists, not what arrived beside it.
  await expect.element(text(/0 documents/)).toBeVisible();
  await expect.poll(rows).toEqual(["one [new]"]);
  await button("discard").click();
  await expect.poll(rows).toEqual([]);
  await expect.element(text(/^ws\//)).not.toBeInTheDocument();
});
