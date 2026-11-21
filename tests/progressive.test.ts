/** A long list drawn a batch at a time (`useProgressive`), and drawn again
 *  the same way when what it shows changes: each item as it was until its
 *  turn, the ones in view first.
 *
 * How many a batch draws is learned from how long the batches before took,
 * and which items count as near the view is the browser's to say -- both
 * differ between machines, and an order asserted through them passed here
 * and failed on CI. So the hook is held to what holds anywhere: nothing
 * goes back to a placeholder, everything ends drawn as it now is, in order
 * from the top; and which are drawn, given the budget and which are near,
 * is held on `step` alone. */

import { createElement, useLayoutEffect, useMemo, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import {
  step,
  useProgressive,
  type Item,
  type Prepare,
} from "src/components/editor/progressive";

const COUNT = 20;
/** Each item's height, and the view's: two items show at once. */
const ROW = 100;
const VIEW = 200;

/** Items 1 to `COUNT`, each showing `version`, each more than the first
 *  batch may spend. */
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

/** Whether every item is drawn, showing `version`. */
const allAt = (version: string) =>
  shown().length === COUNT &&
  shown().every(([, v]) => v?.startsWith(`${version}-`));

test("a change is drawn again a batch at a time, each item as it was until then", async () => {
  const render = mount();
  render(itemsAt("a"));
  await expect.poll(() => allAt("a")).toBe(true);

  const order: number[] = [];
  /** Items seen without a value since the change: a placeholder put back. */
  const lost: number[] = [];
  const watch = new MutationObserver((changes) => {
    for (const c of changes) {
      const el = c.target as HTMLElement;
      const key = Number(el.dataset.key);
      if (el.dataset.value === undefined) lost.push(key);
      else if (el.dataset.value.startsWith("b-")) order.push(key);
    }
  });
  watch.observe(host!, {
    subtree: true,
    attributes: true,
    attributeFilter: ["data-value"],
  });
  try {
    render(itemsAt("b"));
    await expect.poll(() => order.length, { timeout: 5_000 }).toBe(COUNT);
    expect(lost).toEqual([]);
    expect(stale).toBe(0);
    expect(shown()).toEqual(
      Array.from({ length: COUNT }, (_, i) => [i + 1, `b-${i + 1}`]),
    );
    // At the top, what is near the view comes first and the rest after it:
    // in order, however many a batch drew.
    expect(order).toEqual(Array.from({ length: COUNT }, (_, i) => i + 1));
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

// ---- which are drawn, given which are near the view -------------------------

/** `count` items at `version`, each costing 1. */
const cheap = (version: string, count = 10): Item<string>[] =>
  Array.from({ length: count }, (_, i) => ({
    key: i + 1,
    cost: 1,
    value: `${version}-${i + 1}`,
  }));
const drawnAs = (items: Item<string>[]) =>
  new Map(items.map((i) => [i.key, i.value]));
const changed = (m: Map<number, string>) =>
  [...m].filter(([, v]) => v.startsWith("b-")).map(([k]) => k);

test("those near the view are drawn again first, then the rest in order, within the budget", () => {
  const { drawn, cost } = step(
    cheap("b"),
    drawnAs(cheap("a")),
    new Set([7, 8]),
    3,
    Object.is,
  );
  expect(changed(drawn)).toEqual([1, 7, 8]);
  expect(cost).toBe(3);
  // The rest drawn as they were, none let go to a placeholder.
  expect(drawn.size).toBe(10);
  expect(drawn.get(2)).toBe("a-2");
});

test("an item that draws the same is handed its new value, costing nothing", () => {
  const same = (a: string, b: string) => a.slice(2) === b.slice(2);
  const { drawn, cost } = step(
    cheap("b"),
    drawnAs(cheap("a")),
    new Set(),
    0,
    same,
  );
  expect(changed(drawn)).toHaveLength(10);
  expect(cost).toBe(0);
});

test("one not ready waits; at least one ready is drawn however small the budget", () => {
  const { drawn } = step(
    cheap("b"),
    drawnAs(cheap("a")),
    new Set([5]),
    0,
    Object.is,
    (key) => key !== 5,
  );
  expect(changed(drawn)).toEqual([1]);
});

test("an item no longer in the list is let go; one not drawn yet is drawn", () => {
  const { drawn } = step(
    cheap("a", 3),
    new Map([
      [1, "a-1"],
      [9, "a-9"],
    ]),
    new Set(),
    10,
    Object.is,
  );
  expect([...drawn.keys()].sort()).toEqual([1, 2, 3]);
});
