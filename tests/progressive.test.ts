/** A long list drawn a batch at a time (`useProgressive`), and drawn again
 *  the same way when what it shows changes: each item as it was until its
 *  turn, the ones in view first. Every item here costs more than a batch
 *  may spend, so each batch draws exactly one, and the order they are
 *  drawn in is what is tested. */

import { createElement, useLayoutEffect, useMemo, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import {
  useProgressive,
  type Item,
  type Prepare,
} from "src/components/editor/progressive";

const COUNT = 20;
/** Each item's height, and the view's: two items show at once. */
const ROW = 100;
const VIEW = 200;

/** Items 1 to `COUNT`, each showing `version`, each too dear to share a
 *  batch. */
const itemsAt = (version: string): Item<string>[] =>
  Array.from({ length: COUNT }, (_, i) => ({
    key: i + 1,
    cost: 1e9,
    value: `${version}-${i + 1}`,
  }));

let stale = -1;

/** The values prepared, as the markdown pane's pages are parsed. */
const prepared = new Set<string>();

/** Work done for `items` ahead of drawing them, as the markdown pane's
 *  workers parse its pages: an item at a time, in the order asked for at
 *  that moment, the first at once, until that order has nothing left in
 *  it -- and nothing more until asked again. */
function preparing(items: Item<string>[]): Prepare {
  const valueOf = new Map(items.map((i) => [i.key, i.value]));
  return {
    ready: (key) => prepared.has(valueOf.get(key)!),
    ahead(order, wake) {
      let stopped = false;
      const next = () => {
        if (stopped) return;
        for (const key of order()) {
          const value = valueOf.get(key)!;
          if (prepared.has(value)) continue;
          prepared.add(value);
          wake();
          setTimeout(next);
          return;
        }
      };
      // Asked at once, as `parseAhead` asks for its first batches.
      next();
      return () => {
        stopped = true;
      };
    },
  };
}

function List({
  items,
  root,
  prepares,
}: {
  items: Item<string>[];
  root: RefObject<HTMLElement | null>;
  prepares: boolean;
}) {
  const prepare = useMemo(
    () => (prepares ? preparing(items) : undefined),
    [items, prepares],
  );
  const progress = useProgressive(items, root, { prepare });
  useLayoutEffect(() => {
    stale = progress.stale;
  });
  return items.map(({ key }) => {
    const value = progress.drawn.get(key);
    return createElement("div", {
      key,
      ref: progress.track(key),
      "data-key": key,
      "data-value": value,
      style: { height: ROW },
    });
  });
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  prepared.clear();
  root?.unmount();
  host?.remove();
  root = host = null;
});

/** The list in a scroller of its own, two items tall: its items prepared
 *  ahead of being drawn, if `prepares`. */
function mount(prepares = false) {
  host = document.createElement("div");
  host.style.height = `${VIEW}px`;
  host.style.overflowY = "auto";
  document.body.append(host);
  const scroller: RefObject<HTMLElement | null> = { current: host };
  root = createRoot(host);
  function Host({ items }: { items: Item<string>[] }) {
    return createElement(List, {
      items,
      root: scroller,
      prepares,
    });
  }
  return (items: Item<string>[]) =>
    root!.render(createElement(Host, { items }));
}

/** What each item shows, by key: undefined while it waits. */
const shown = () =>
  Array.from(
    host!.querySelectorAll<HTMLElement>("[data-key]"),
    (el): [number, string | undefined] => [
      Number(el.dataset.key),
      el.dataset.value,
    ],
  );

/** Until an observer of the list's own -- made after the hook's, so told
 *  after it in the same round -- sees item `key` near the view. Two frames
 *  after a scroll was not always enough on CI: the hook was told of the
 *  scroll after the change below was drawn, and drew item 1 first. */
function seenNear(key: number): Promise<void> {
  const el = host!.querySelector(`[data-key="${key}"]`)!;
  return new Promise((done) => {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          done();
        }
      },
      { root: host, rootMargin: "100% 0px" },
    );
    io.observe(el);
  });
}

/** Whether every item is drawn, showing `version`. */
const allAt = (version: string) =>
  shown().length === COUNT &&
  shown().every(([, v]) => v?.startsWith(`${version}-`));

test("a change is drawn again a batch at a time, what is in view first, each item as it was until then", async () => {
  const render = mount();
  render(itemsAt("a"));
  await expect.poll(() => allAt("a")).toBe(true);

  // Near the end, off the items' edges: 18 to 20 in view, and 16 and 17
  // within a screen above it.
  host!.scrollTop = 1750;
  await seenNear(16);

  const order: number[] = [];
  const watch = new MutationObserver((changes) => {
    for (const c of changes) {
      const el = c.target as HTMLElement;
      if (el.dataset.value?.startsWith("b-"))
        order.push(Number(el.dataset.key));
    }
  });
  watch.observe(host!, {
    subtree: true,
    attributes: true,
    attributeFilter: ["data-value"],
  });
  try {
    render(itemsAt("b"));
    // The render that brought the change drew one item again, near the
    // view; every other item still shows what it did, none a placeholder.
    await expect.poll(() => order.length).toBeGreaterThan(0);
    expect(shown().every(([, v]) => v !== undefined)).toBe(true);
    await expect.poll(() => order.length, { timeout: 5_000 }).toBe(COUNT);
    expect(stale).toBe(0);
    expect(shown()).toEqual(
      Array.from({ length: COUNT }, (_, i) => [i + 1, `b-${i + 1}`]),
    );
    // Those within a screen of the view first, then the rest in order.
    expect(order.slice(0, 5).sort((x, y) => x - y)).toEqual([
      16, 17, 18, 19, 20,
    ]);
    expect(order.slice(5)).toEqual(
      Array.from({ length: COUNT - 5 }, (_, i) => i + 1),
    );
  } finally {
    watch.disconnect();
  }
});

test("a change that must be prepared first is prepared and drawn, every item of it", async () => {
  const render = mount(true);
  render(itemsAt("a"));
  await expect.poll(() => allAt("a")).toBe(true);
  render(itemsAt("b"));
  // Asked for what is left as soon as there is any: not only for what was
  // left before the change, which is nothing.
  await expect.poll(() => allAt("b"), { timeout: 5_000 }).toBe(true);
  expect(stale).toBe(0);
});
