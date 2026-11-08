/** A page of the markdown parsed for the rendered view (`hast.ts`), and the
 *  pages parsed ahead of it in workers (`parse.ts`).
 *
 * That the trees draw as react-markdown drew is `pieces.test.ts`'s. Here:
 * the URL check copied from react-markdown answers as react-markdown's
 * does; a tree keeps no more of where it came from than the pane reads; and
 * the parse runs in a worker as the app builds one -- whose DOM-free build
 * of the entity decoder is the one thing a worker could not do without --
 * to the tree the page's thread parses, pages wanted first parsed first. */

import { defaultUrlTransform } from "react-markdown";
import { afterEach, expect, test, vi } from "vitest";
import { safeUrl, toHast } from "src/lib/hast";
import {
  parseAhead,
  ready,
  releaseAllParsed,
  releaseParsed,
  treeOf,
} from "src/lib/parse";

afterEach(() => releaseAllParsed());

test("a URL is kept or emptied as react-markdown keeps or empties it", () => {
  const urls = [
    "",
    "https://example.com",
    "HTTP://EXAMPLE.COM",
    "mailto:x@example.com",
    "ircs://irc.example.com",
    "xmpp:x@example.com",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "vbscript:x",
    "data:text/html,x",
    "tel:123",
    "ftp://example.com",
    "file:///etc/passwd",
    "/relative:colon",
    "rel/a:b",
    "?q=a:b",
    "#frag:x",
    "doc.assets/p1-i0.png",
    "doc%20name.assets/p1-i0.png",
  ];
  for (const url of urls)
    expect(safeUrl(url), url).toBe(defaultUrlTransform(url));
});

test("a tree keeps where each element starts and ends, by line, and nothing else of where it came from", () => {
  const tree = toHast(
    "# Title\n\nSome *words* and [a link](https://example.com).\n",
  );
  const seen: unknown[] = [];
  const visit = (node: {
    type: string;
    position?: unknown;
    children?: unknown[];
  }) => {
    if (node.type === "element") seen.push(node.position);
    else expect(node.position, node.type).toBeUndefined();
    for (const child of node.children ?? []) visit(child as typeof node);
  };
  visit(tree);
  // The paragraph: the third line, to its end.
  expect(seen).toContainEqual({
    start: { line: 3, column: 1 },
    end: { line: 3, column: 48 },
  });
  for (const position of seen)
    expect(Object.keys((position as { start: object }).start)).toEqual([
      "line",
      "column",
    ]);
});

/** `n` pages of about a book's, each its own, with the named and numbered
 *  references the entity decoder is there for. */
function pages(n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) =>
      `## Page ${i + 1}\n\nWords &copy; &amp; &#123; and *more* words, ${"a [link](https://example.com) and padding ".repeat(60)}\n\n- an item\n- another\n`,
  );
}

test("pages are parsed ahead in workers to the tree the page's thread parses, the ones wanted first first", async () => {
  // A worker that cannot start, or cannot parse, gives the pool up -- and
  // every page is then "ready" to parse on the page's thread, which would
  // pass the rest of this unseen. So: it says so, and must not.
  const warn = vi.spyOn(console, "warn");
  const texts = pages(400);
  // The last pages first, as a view taken to the end of a book wants.
  const wanted = [...texts].reverse();
  const isReady = (t: string) => ready("doc", t);
  let first: boolean[] | null = null;
  let done!: () => void;
  const all = new Promise<void>((resolve) => (done = resolve));
  const stop = parseAhead(
    "doc",
    () => wanted.filter((t) => !isReady(t)),
    () => {
      first ??= [isReady(texts[0]), isReady(texts.at(-1)!)];
      if (texts.every(isReady)) done();
    },
  );
  await all;
  stop();
  expect(warn).not.toHaveBeenCalled();
  // Told of the first batches before the last: the page wanted first was
  // parsed, the page wanted last not yet.
  expect(first).toEqual([false, true]);
  for (const text of texts) expect(treeOf("doc", text)).toEqual(toHast(text));
});

test("a document let go of mid-parse keeps nothing that lands after", async () => {
  // Another document still open keeps the pool, and the batches out for
  // this one, alive: they land after it has gone.
  treeOf("kept", "# Kept\n");
  const texts = pages(400);
  const stop = parseAhead(
    "gone",
    () => texts,
    () => {},
  );
  releaseParsed("gone");
  stop();
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const text of texts) expect(ready("gone", text)).toBe(false);
  expect(ready("kept", "# Kept\n")).toBe(true);
});
