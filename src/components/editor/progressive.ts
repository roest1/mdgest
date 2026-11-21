import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefCallback,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";

/** One thing to draw: its key, what it costs to draw, in any unit that
 *  grows with the work -- the markdown pane counts characters -- and what
 *  is drawn for it. */
export interface Item<T> {
  key: number;
  cost: number;
  value: T;
}

/** Work done for an item somewhere else before it is drawn -- the markdown
 *  pane's pages parsed in workers -- so drawing it holds the page for less.
 *  Only the first draw does that work itself, on the page's thread, so a
 *  document that fits in it is there at once and asks nothing of this. */
export interface Prepare {
  /** Whether `key` is ready to be drawn. One that is not waits its turn
   *  in its placeholder, however near the view, until it is. */
  ready(key: number): boolean;
  /** Start preparing what is still to draw, in the order `order` gives
   *  their keys -- in or near the view first, asked again each time, so it
   *  is the order of that moment -- calling `wake` when more is ready.
   *  Returns how to stop. */
  ahead(order: () => Iterable<number>, wake: () => void): () => void;
}

/** How long the first draw may hold the page, in ms: whatever fits is
 *  there in the first frame, and a document that fits whole -- most do --
 *  is drawn in one go, as if nothing were drawn a piece at a time. */
const FIRST_MS = 50;
/** How long each later batch may hold it while a person's input waits to
 *  be answered, in ms: inside a frame, with room left for the browser to
 *  lay out, paint, and answer the scroll or the key. */
const BUSY_MS = 12;
/** How long one may hold it while nothing waits: a few frames. Around each
 *  batch's drawing the page pays about as much again -- the timer, the list
 *  rendered anew, style and layout -- so a book drawn a frame at a time took
 *  twice its parsing to fill, and drawn a few frames at a time takes close
 *  to it. Nothing is waiting, so nothing is held up; an input that arrives
 *  mid-batch waits the batch out, once, and the batches after are a
 *  frame's for a while (`RECENT_MS`). */
const IDLE_MS = 40;
/** What a unit costs before any has been timed: a character of the
 *  markdown pane, parsed and committed, on a laptop. Each batch timed
 *  replaces it, so a slower machine draws smaller batches. */
const GUESS_MS = 0.004;
/** A batch smaller than this many units times too noisily to learn from. */
const TIMED_ABOVE = 2_000;
/** How far outside the view a waiting piece is drawn first: a screen
 *  above and below, so a scroll arrives on what is drawn. */
const NEAR = "100% 0px";

/** How long after a person's last input a batch is still sized to a frame,
 *  in ms. Input is not only what waits when a batch starts: a wheel turned
 *  through the fill sends a tick every few dozen ms, each landing inside
 *  whatever batch is running and waiting it out -- a third of the frames
 *  dropped, measured, with batches of a few frames and only the pending
 *  check below. So a person seen at the page keeps the batches small for
 *  a moment after, long enough for the next tick of a wheel or the next
 *  key, and the fill goes back to its stride once they stop. */
const RECENT_MS = 250;
/** The events a person's input arrives as: on the scroller, its scroll,
 *  whatever moved it -- wheel, keys, the scrollbar, the other pane --
 *  and on the window the rest, since the panes share one page. */
const INPUT = ["wheel", "keydown", "pointerdown", "touchmove"] as const;

/** Whether a person's input is waiting to be handled -- a scroll, a key, a
 *  click the page has not answered yet -- as Chromium says
 *  (`navigator.scheduling.isInputPending`). A browser that cannot say is
 *  taken to have none waiting, and relies on `RECENT_MS`. */
function inputPending(): boolean {
  const scheduling = (
    navigator as { scheduling?: { isInputPending?: () => boolean } }
  ).scheduling;
  return scheduling?.isInputPending?.() ?? false;
}

/** What to draw for each of `items` now, from what is drawn: an item drawn
 *  as it is stays so; of the rest -- not drawn yet, or drawn as it was
 *  before it changed -- those in or near `root`'s view first, then the
 *  rest in order, within `budget`, but always at least one of those
 *  `ready` says may be. One not taken stays as it was drawn, or waits in
 *  its placeholder. An item no longer in `items` is let go. */
function step<T>(
  items: readonly Item<T>[],
  drawn: ReadonlyMap<number, T>,
  near: ReadonlySet<number>,
  budget: number,
  same: (a: T, b: T) => boolean,
  ready: (key: number) => boolean = () => true,
): { drawn: Map<number, T>; cost: number } {
  const out = new Map<number, T>();
  const pending: Item<T>[] = [];
  for (const item of items) {
    const was = drawn.get(item.key);
    if (was === undefined) {
      pending.push(item);
      continue;
    }
    // Drawn as it is, if it would draw the same: handed what it is now.
    if (was === item.value || same(was, item.value))
      out.set(item.key, item.value);
    else {
      out.set(item.key, was);
      pending.push(item);
    }
  }
  let cost = 0;
  const fits = (item: Item<T>) => {
    if (!ready(item.key)) return true;
    if (cost > 0 && cost + item.cost > budget) return false;
    out.set(item.key, item.value);
    cost += item.cost;
    return true;
  };
  const taken = () => {
    for (const item of pending) if (near.has(item.key) && !fits(item)) return;
    for (const item of pending) if (!near.has(item.key) && !fits(item)) return;
  };
  taken();
  return { drawn: out, cost };
}

/** Draw `items` a batch at a time, each batch inside a budget -- a frame's
 *  while a person's input waits, a few frames' while none does -- so a long
 *  document never holds the page for longer than that: what is in view
 *  first, the rest after, until all are drawn. What is not drawn yet
 *  stands in a placeholder; every placeholder and every drawn item is
 *  given `track(key)` as its ref, which is how this knows which are in
 *  view.
 *
 * The budget is in ms; what it buys is learned as it goes, from how long
 * each batch took to render and commit, so the batches size themselves to
 * the machine. Keyed, so `items` may change -- the same document written
 * anew after an edit -- and what was drawn stays drawn: an item that would
 * draw the same, by `same`, as it is drawn is handed its new value at once,
 * and one that changed is drawn again as the first draw is, as much as
 * fits in the render that brought it, near the view first, and the rest a
 * batch at a time after. Until then it is drawn as it was: an edit that
 * changes every page of a book -- its page numbers hidden -- shows on the
 * pages in view as it is made, and on the rest a moment later, rather than
 * holding the page while the book is drawn again in one go.
 *
 * Given `prepare`, a batch after the first draws only what it says is
 * ready, and the order it is prepared in is this one's: what is near the
 * view, then the rest. */
export function useProgressive<T>(
  items: readonly Item<T>[],
  root: RefObject<HTMLElement | null>,
  {
    prepare,
    same = Object.is,
  }: {
    prepare?: Prepare;
    /** Whether an item drawn as `a` draws the same as `b`. */
    same?: (a: T, b: T) => boolean;
  } = {},
): {
  /** What to draw for each key: its value, or the one it had when it was
   *  drawn, while it waits to be drawn again. A key not here waits in its
   *  placeholder. */
  drawn: ReadonlyMap<number, T>;
  track: (key: number) => RefCallback<HTMLElement>;
  /** Whether any item is not drawn as it is. */
  filling: boolean;
  /** How many are drawn as they were, waiting to be drawn again. */
  stale: number;
} {
  const rate = useRef(GUESS_MS);
  const near = useRef(new Set<number>());
  const [state, setState] = useState(() => ({
    items,
    drawn: step(items, new Map(), new Set(), FIRST_MS / GUESS_MS, same)
      .drawn as ReadonlyMap<number, T>,
  }));
  let current = state;
  if (state.items !== items) {
    // Changed: as much drawn again as the first draw may, in this render,
    // so an edit to a short document -- or to the pages in view -- shows
    // in the frame it is made in. Set while rendering, as React has state
    // follow a prop: this render is thrown away and run again at once with
    // it, before anything is committed. Committed first with the items
    // drawn as they were, the list was rendered twice an edit, and what
    // was asked to be prepared was asked of the list as it had been, with
    // nothing left in it -- and was not asked again.
    current = {
      items,
      drawn: step(
        items,
        state.drawn,
        // Which are in view, and what a unit costs: only what is drawn
        // first, never what is drawn.
        // oxlint-disable-next-line react/refs
        near.current,
        // oxlint-disable-next-line react/refs
        FIRST_MS / rate.current,
        same,
      ).drawn,
    };
    setState(current);
  }
  const { drawn } = current;
  const elements = useRef(new Map<number, Set<HTMLElement>>());
  const keyOf = useRef(new WeakMap<Element, number>());
  const intersecting = useRef(new WeakSet<Element>());
  const observer = useRef<IntersectionObserver | null>(null);
  const refs = useRef(new Map<number, RefCallback<HTMLElement>>());
  const timing = useRef<{ start: number; cost: number } | null>(null);
  /** When a person last did something to the page, by `performance.now`. */
  const lastInput = useRef(-Infinity);
  /** Counted up when `prepare` says more is ready: a batch to try again. */
  const [woken, setWoken] = useState(0);
  // What `order` reads when it is asked, which is between renders.
  const latest = useRef(current);
  useLayoutEffect(() => {
    latest.current = current;
  });

  useEffect(() => {
    const el = root.current;
    const seen = () => {
      lastInput.current = performance.now();
    };
    const opts = { passive: true, capture: true } as const;
    el?.addEventListener("scroll", seen, opts);
    for (const type of INPUT) window.addEventListener(type, seen, opts);
    return () => {
      el?.removeEventListener("scroll", seen, opts);
      for (const type of INPUT) window.removeEventListener(type, seen, opts);
    };
  }, [root]);

  /** Whether any of `key`'s elements -- its placeholder, its drawing, or
   *  both for the moment one takes the other's place -- is near the view. */
  const recount = (key: number) => {
    const els = elements.current.get(key);
    if (els && [...els].some((el) => intersecting.current.has(el)))
      near.current.add(key);
    else near.current.delete(key);
  };

  // The observer wants its root, which is set after the refs run on the
  // first commit: those found before it are observed now.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const key = keyOf.current.get(e.target);
          if (key === undefined) continue;
          if (e.isIntersecting) intersecting.current.add(e.target);
          else intersecting.current.delete(e.target);
          recount(key);
        }
      },
      { root: root.current, rootMargin: NEAR },
    );
    for (const els of elements.current.values())
      for (const el of els) io.observe(el);
    observer.current = io;
    return () => {
      io.disconnect();
      observer.current = null;
    };
  }, [root]);

  const track = useCallback((key: number) => {
    let ref = refs.current.get(key);
    if (!ref) {
      ref = (el) => {
        if (!el) return;
        let els = elements.current.get(key);
        if (!els) elements.current.set(key, (els = new Set()));
        els.add(el);
        keyOf.current.set(el, key);
        observer.current?.observe(el);
        return () => {
          els.delete(el);
          if (els.size === 0) elements.current.delete(key);
          intersecting.current.delete(el);
          observer.current?.unobserve(el);
          recount(key);
        };
      };
      refs.current.set(key, ref);
    }
    return ref;
  }, []);

  // Committed: how long that batch held the page, per unit, folded into
  // what the next batch is sized by.
  useLayoutEffect(() => {
    const t = timing.current;
    timing.current = null;
    if (!t || t.cost < TIMED_ABOVE) return;
    const measured = (performance.now() - t.start) / t.cost;
    rate.current = (rate.current + measured) / 2;
  }, [drawn]);

  let filling = false;
  let stale = 0;
  for (const item of items) {
    const was = drawn.get(item.key);
    if (was === item.value) continue;
    filling = true;
    if (was !== undefined) stale++;
  }

  // What is still to draw, near the view first: the order it is prepared
  // in, asked each time more can be.
  const order = useCallback(function* () {
    const { items, drawn } = latest.current;
    const pending = items.filter((i) => drawn.get(i.key) !== i.value);
    for (const { key } of pending) if (near.current.has(key)) yield key;
    for (const { key } of pending) if (!near.current.has(key)) yield key;
  }, []);
  useEffect(() => {
    if (!filling || !prepare) return;
    return prepare.ahead(order, () => setWoken((n) => n + 1));
  }, [filling, prepare, order]);

  useEffect(() => {
    if (!filling) return;
    // A task of its own, after this frame's: the browser paints and takes
    // input between batches. What is near the view is asked at the last
    // moment, so a jump made meanwhile is drawn next.
    const id = setTimeout(() => {
      const busy =
        inputPending() || performance.now() - lastInput.current < RECENT_MS;
      const budget = busy ? BUSY_MS : IDLE_MS;
      const next = step(
        items,
        drawn,
        near.current,
        budget / rate.current,
        same,
        prepare && ((key) => prepare.ready(key)),
      );
      // Nothing ready: the next batch is when `prepare` wakes this.
      if (next.cost === 0) return;
      timing.current = { start: performance.now(), cost: next.cost };
      // Drawn now, in this task, so the time taken is the batch's own.
      flushSync(() => setState({ items, drawn: next.drawn }));
    });
    return () => clearTimeout(id);
  }, [items, drawn, filling, prepare, same, woken]);

  return { drawn, track, filling, stale };
}
