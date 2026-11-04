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

/** One thing to draw: its key, and what it costs to draw, in any unit
 *  that grows with the work -- the markdown pane counts characters. */
export interface Item {
  key: number;
  cost: number;
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

/** Which of `items` to draw now: the ones whose placeholders are in or
 *  near `root`'s view first, then the rest in order -- within `budget`,
 *  but always at least one. */
function take(
  items: readonly Item[],
  shown: ReadonlySet<number>,
  near: ReadonlySet<number>,
  budget: number,
): Set<number> {
  const out = new Set(shown);
  let spent = 0;
  const fits = (item: Item) => {
    if (out.has(item.key)) return true;
    if (spent > 0 && spent + item.cost > budget) return false;
    out.add(item.key);
    spent += item.cost;
    return true;
  };
  for (const item of items) if (near.has(item.key) && !fits(item)) return out;
  for (const item of items) if (!fits(item)) return out;
  return out;
}

/** Draw `items` a batch at a time, each batch inside a budget -- a frame's
 *  while a person's input waits, a few frames' while none does -- so a long
 *  document never holds the page for longer than that: what is in view
 *  first, the rest after, until all are drawn. What is not drawn yet
 *  stands in a placeholder given `wait(key)` as its ref, which is how this
 *  knows which are in view.
 *
 * The budget is in ms; what it buys is learned as it goes, from how long
 * each batch took to render and commit, so the batches size themselves to
 * the machine. Keyed, so `items` may change -- the same document written
 * anew after an edit -- and what was drawn stays drawn. */
export function useProgressive(
  items: readonly Item[],
  root: RefObject<HTMLElement | null>,
): {
  shown: ReadonlySet<number>;
  wait: (key: number) => RefCallback<HTMLElement>;
  filling: boolean;
} {
  const rate = useRef(GUESS_MS);
  const [shown, setShown] = useState<ReadonlySet<number>>(() =>
    take(items, new Set(), new Set(), FIRST_MS / GUESS_MS),
  );
  const near = useRef(new Set<number>());
  const placeholders = useRef(new Map<number, HTMLElement>());
  const observer = useRef<IntersectionObserver | null>(null);
  const refs = useRef(new Map<number, RefCallback<HTMLElement>>());
  const timing = useRef<{ start: number; cost: number } | null>(null);
  /** When a person last did something to the page, by `performance.now`. */
  const lastInput = useRef(-Infinity);

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

  // The observer wants its root, which is set after the placeholders'
  // refs run on the first commit: those found before it are observed now.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const key = Number((e.target as HTMLElement).dataset.wait);
          if (e.isIntersecting) near.current.add(key);
          else near.current.delete(key);
        }
      },
      { root: root.current, rootMargin: NEAR },
    );
    for (const el of placeholders.current.values()) io.observe(el);
    observer.current = io;
    return () => {
      io.disconnect();
      observer.current = null;
    };
  }, [root]);

  const wait = useCallback((key: number) => {
    let ref = refs.current.get(key);
    if (!ref) {
      ref = (el) => {
        if (!el) return;
        placeholders.current.set(key, el);
        observer.current?.observe(el);
        return () => {
          placeholders.current.delete(key);
          near.current.delete(key);
          observer.current?.unobserve(el);
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
  }, [shown]);

  const filling = items.some((item) => !shown.has(item.key));
  useEffect(() => {
    if (!filling) return;
    // A task of its own, after this frame's: the browser paints and takes
    // input between batches. What is near the view is asked at the last
    // moment, so a jump made meanwhile is drawn next.
    const id = setTimeout(() => {
      const busy =
        inputPending() || performance.now() - lastInput.current < RECENT_MS;
      const budget = busy ? BUSY_MS : IDLE_MS;
      const next = take(items, shown, near.current, budget / rate.current);
      let cost = 0;
      for (const item of items)
        if (next.has(item.key) && !shown.has(item.key)) cost += item.cost;
      timing.current = { start: performance.now(), cost };
      // Drawn now, in this task, so the time taken is the batch's own.
      flushSync(() => setShown(next));
    });
    return () => clearTimeout(id);
  }, [items, shown, filling]);

  return { shown, wait, filling };
}
