import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { InkFilter } from "src/components/landing/Marks";
import { STEPS, type Spot, type State } from "src/components/editor/tour-steps";
import { useEditor, type Boxes, type View } from "src/lib/store";
import { TOUR_DOC } from "src/lib/tour-doc";

/** The walkthrough: a few hand-drawn arrows to the things a person would
 *  not find by looking, over the live page. It runs from the header's help
 *  icon, on the bundled example document rather than anyone's own, so it
 *  can put the page in whatever state a step talks about without undoing
 *  a person's work.
 *
 * A step that asks for something ends when it is done, and only then: the
 * range step waits for a shift-click, the box steps for the toggle, the
 * clear step for the cross. One
 * that only shows something ends by itself after a moment. Nothing has to
 * be clicked to move on, and Escape ends the whole thing. Nothing else
 * can be clicked either: only the thing a step asks for takes a click, so
 * the tour goes the same way for everyone.
 *
 * The steps themselves are in `tour-steps.ts`; this is the drawing of
 * them. */

// ---- geometry -----------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function same(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Where `selector` is on screen, re-measured every frame while the tour
 *  runs: the page scrolls, the split moves, the block may not exist yet.
 *  One `getBoundingClientRect` a frame is nothing. */
function useAnchor(selector: string | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    let frame = 0;
    // Unset, not null: the first look always lands, so a new selector that
    // matches nothing clears the last one's rectangle.
    let last: Rect | null | undefined;
    const look = () => {
      const el = selector ? document.querySelector(selector) : null;
      let next: Rect | null = null;
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) next = { x: r.left, y: r.top, w: r.width, h: r.height };
      }
      if (last === undefined || !same(next, last)) {
        last = next;
        setRect(next);
      }
      frame = requestAnimationFrame(look);
    };
    look();
    return () => cancelAnimationFrame(frame);
  }, [selector]);
  return rect;
}

/** The callout's size, near enough: Caveat is narrow, and a few words fit
 *  on one line. */
function calloutBox(text: string): { w: number; h: number } {
  const w = Math.min(260, text.length * 11.5 + 10);
  return { w, h: w < 260 ? 32 : 60 };
}

interface Point {
  x: number;
  y: number;
}

/** The callout's box and the arrow's run, for a thing at `rect` and the
 *  step's spot. The box is kept on screen. The arrow bows so it reads as
 *  thrown rather than plotted: to the side it dips a little on the way;
 *  over, it rises, crosses and comes down onto the top; under, the mirror. */
function layout(
  rect: Rect,
  text: string,
  spot: Spot,
  size: { w: number; h: number },
  drawn: { w: number; h: number } | null,
) {
  // A drop sits in tight room at the screen's edge, so it goes by the
  // words as drawn once they are.
  const { w, h } = (spot.arrow === "drop" && drawn) || calloutBox(text);
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  const margin = 8;
  const box: Rect = {
    x:
      spot.arrow === "drop"
        ? rect.x + spot.dx
        : spot.side === "right"
          ? right + spot.dx
          : rect.x - spot.dx - w,
    y: rect.y + spot.dy,
    w,
    h,
  };
  box.x = Math.max(margin, Math.min(size.w - margin - w, box.x));
  box.y = Math.max(margin, Math.min(size.h - margin - h, box.y));

  const onRight = spot.side === "right";
  let from: Point = { x: onRight ? box.x - 4 : box.x + w + 4, y: box.y + h / 2 };
  let to: Point;
  let c1: Point;
  let c2: Point;
  if (spot.arrow === "side") {
    to = { x: onRight ? right + 6 : rect.x - 6, y: rect.y + Math.min(rect.h / 3, 18) };
    const dx = to.x - from.x;
    c1 = { x: from.x + dx * 0.3, y: from.y + 10 };
    c2 = { x: from.x + dx * 0.75, y: to.y + 6 };
  } else if (spot.arrow === "over") {
    // Up, across and down onto the top. Drawn from partway along, so the
    // arrow is the landing, not the whole journey -- and the words then
    // move up to where it starts.
    to = { x: rect.x + Math.min(rect.w / 2, 40), y: rect.y - 8 };
    const dx = to.x - from.x;
    const apex = Math.min(from.y, to.y) - 34;
    [from, c1, c2] = tail(
      from,
      { x: from.x + dx * 0.3, y: apex },
      { x: to.x - dx * 0.05, y: to.y - 46 },
      to,
      0.4,
    );
    box.x = from.x - w - 8;
    box.y = from.y - h / 2 - 4;
  } else if (spot.arrow === "drop") {
    // From under the first words, falling with a little lean onto the top.
    from = { x: box.x + Math.min(w * 0.25, 40), y: box.y + h + 2 };
    to = { x: rect.x + Math.min(rect.w / 2, 40), y: rect.y - 8 };
    c1 = { x: from.x - 14, y: from.y + 20 };
    c2 = { x: to.x - 8, y: to.y - 24 };
  } else {
    // One easy curve from under the last word, sagging a little and
    // arriving from the lower left, at the thing's underside.
    from = { x: box.x + w * 0.8, y: box.y + h - 2 };
    to = { x: rect.x + rect.w * 0.3, y: bottom + 5 };
    const dx = to.x - from.x;
    c1 = { x: from.x + dx * 0.35, y: from.y + 14 };
    c2 = { x: to.x - 12, y: to.y + 14 };
  }
  const angle = (Math.atan2(to.y - c2.y, to.x - c2.x) * 180) / Math.PI;
  return { box, from, to, c1, c2, angle };
}

/** The last part of a cubic curve, from `t` to its end, as a cubic of its
 *  own (de Casteljau): the same line, started later. */
function tail(p0: Point, p1: Point, p2: Point, p3: Point, t: number): [Point, Point, Point] {
  const mix = (a: Point, b: Point): Point => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const p01 = mix(p0, p1);
  const p12 = mix(p1, p2);
  const p23 = mix(p2, p3);
  const p012 = mix(p01, p12);
  const p123 = mix(p12, p23);
  return [mix(p012, p123), p123, p23];
}

function pad(r: Rect, x: number, y = x): Rect {
  return { x: r.x - x, y: r.y - y, w: r.w + 2 * x, h: r.h + 2 * y };
}

/** The smallest rectangle holding all of `points`. */
function span(points: Point[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The smallest rectangle holding all of `rects`. */
function around(rects: Rect[]): Rect {
  return span(rects.flatMap((r) => [r, { x: r.x + r.w, y: r.y + r.h }]));
}

// ---- the overlay ----------------------------------------------------------------

/** Four walls around `hole`, taking every click that lands outside it; with
 *  no hole, one wall over everything, for a step that only shows. */
function Walls({ hole }: { hole: Rect | null }) {
  const wall = "pointer-events-auto absolute";
  if (!hole) return <div className={`${wall} inset-0`} />;
  const bottom = hole.y + hole.h;
  return (
    <>
      <div className={`${wall} inset-x-0 top-0`} style={{ height: Math.max(0, hole.y) }} />
      <div className={`${wall} inset-x-0 bottom-0`} style={{ top: bottom }} />
      <div className={wall} style={{ left: 0, top: hole.y, width: Math.max(0, hole.x), height: hole.h }} />
      <div className={`${wall} right-0`} style={{ left: hole.x + hole.w, top: hole.y, height: hole.h }} />
    </>
  );
}

export function Tour() {
  const step = useEditor((s) => s.tour);
  const setTour = useEditor((s) => s.setTour);
  const reading = useEditor((s) => s.readings[TOUR_DOC]);
  const selection = useEditor((s) => s.selection);
  const boxes = useEditor((s) => s.boxes);
  const notes = useEditor((s) => s.notes);
  const view = useEditor((s) => s.view);
  const focus = selection?.docId === TOUR_DOC ? selection.focus : null;

  const order = useMemo(
    () => (reading?.status === "ready" ? reading.markdown.order : []),
    [reading],
  );
  const ready = order.length > 0;
  const current = step === null ? null : (STEPS[step] ?? null);
  const selected = selection?.docId === TOUR_DOC ? selection.ids.length : 0;
  const edits = reading?.status === "ready" ? reading.edits : null;
  const state: State = useMemo(
    () => ({ selected, focus, boxes, notes, edits }),
    [selected, focus, boxes, notes, edits],
  );
  const next = () => setTour(step !== null && step + 1 < STEPS.length ? step + 1 : null);

  // The handwriting, fetched when it is first needed and never otherwise.
  useEffect(() => {
    if (step !== null) void import("@fontsource-variable/caveat");
  }, [step]);

  // Escape ends it.
  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTour(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, setTour]);

  // The tour shows the boxes, the indices and the rendered markdown,
  // whatever the person had them at, and puts them back as they were when
  // it ends.
  const kept = useRef<{ boxes: Boxes; notes: boolean; view: View } | null>(null);
  useEffect(() => {
    const { setBoxes, setNotes, setView } = useEditor.getState();
    if (step !== null && kept.current === null) {
      kept.current = { boxes, notes, view };
      setBoxes({ text: true, images: true });
      setNotes(true);
      setView("rendered");
    }
    if (step === null && kept.current !== null) {
      setBoxes(kept.current.boxes);
      setNotes(kept.current.notes);
      setView(kept.current.view);
      kept.current = null;
    }
    // `boxes`, `notes` and `view` are read only on the way in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Each step sets the example up as it needs, once the example is read --
  // and again when the person did something else instead.
  const [prepared, setPrepared] = useState<number | null>(null);
  const [hinted, setHinted] = useState<number | null>(null);
  const needsReset = prepared === step && current?.reset?.(state, order) === true;
  useEffect(() => {
    if (step === null || !current || !ready || (prepared === step && !needsReset)) return;
    const { pick, deselect, setBoxes, setNotes } = useEditor.getState();
    current.prepare?.(order, {
      select: (ids) => {
        deselect();
        ids.forEach((id, i) => pick(TOUR_DOC, id, { range: false, toggle: i > 0 }, "page"));
      },
      clear: deselect,
      boxes: setBoxes,
      notes: setNotes,
    });
    if (needsReset) setHinted(step);
    setPrepared(step);
  }, [step, current, ready, prepared, needsReset, order]);
  useEffect(() => {
    if (step === null) {
      setPrepared(null);
      setHinted(null);
    }
  }, [step]);

  const selector = useMemo(
    () => (current && prepared === step ? current.anchor(order) : null),
    [current, prepared, step, order],
  );
  const rect = useAnchor(selector);
  const also = useAnchor(current && prepared === step ? (current.also ?? null) : null);

  // A step that asks for something ends when it is done...
  useEffect(() => {
    if (step === null || prepared !== step || !current?.done) return;
    if (current.done(state)) next();
    // `next` closes over `step`, which is a dependency already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, prepared, current, state]);

  // ...and one that shows something ends after a moment, counted from when
  // its arrow is drawn.
  const drawn = rect !== null;
  useEffect(() => {
    if (step === null || prepared !== step || !current?.after || !drawn) return;
    const timer = setTimeout(next, current.after);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, prepared, current, drawn]);

  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The words as drawn, for a wide spotlight to fit: `calloutBox` is only
  // a guess, made before there is anything to measure, and a generous one.
  // Layout sizes, not the box's, which is moving while it fades in.
  const said = useRef<HTMLDivElement>(null);
  const [saidSize, setSaidSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = said.current;
    const next = el ? { w: el.offsetWidth, h: el.offsetHeight } : null;
    if (next?.w !== saidSize?.w || next?.h !== saidSize?.h) setSaidSize(next);
    // The words change with the step and the hint, and are there once drawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, hinted, drawn]);

  if (step === null || !current) return null;
  // Until the thing is found, nothing takes a click.
  if (!rect) return <div className="fixed inset-0 z-30" aria-hidden />;
  const words = hinted === step && current.hint ? current.hint : current.callout;
  const { box, from, to, c1, c2, angle } = layout(rect, words, current.spot, size, saidSize);
  // The spotlight: a little around the thing, and where the thing has an
  // index note hanging off its top-left corner, that too.
  let cut: Rect = current.noted
    ? { x: rect.x - 30, y: rect.y - 14, w: rect.w + 38, h: rect.h + 20 }
    : { x: rect.x - 6, y: rect.y - 6, w: rect.w + 12, h: rect.h + 12 };
  if (also) cut = around([cut, pad(also, 6)]);
  if (current.wide) {
    const w = saidSize?.w ?? box.w;
    const h = saidSize?.h ?? box.h;
    const text = { x: current.spot.side === "left" ? box.x + box.w - w : box.x, y: box.y, w, h };
    // The words' line box has room enough above and below; more would
    // reach off the dock when they sit on it. The curve stays inside the
    // box of its four points.
    cut = around([cut, pad(text, 8, 0), pad(span([from, c1, c2, to]), 6)]);
  }
  const dim = current.wide ? 0.55 : 0.28;
  const d = `M ${from.x} ${from.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}`;

  return (
    <div className="pointer-events-none fixed inset-0 z-30" aria-hidden>
      <Walls hole={current.done ? rect : null} />
      <svg width={size.w} height={size.h} className="absolute inset-0">
        <defs>
          <InkFilter
            id="tour-ink"
            frequency={0.02}
            seed={step + 3}
            scale={2.5}
            region={["-20%", "-40%", "140%", "180%"]}
          />
          {/* Everything but the thing itself, a little dimmed. */}
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect x={cut.x} y={cut.y} width={cut.w} height={cut.h} rx="6" fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill={`rgb(0 0 0 / ${dim})`} mask="url(#tour-mask)" />
        <g
          key={`${step}-${words}`}
          className="stroke-brand"
          filter="url(#tour-ink)"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity="0.85"
        >
          <path className="tour-shaft" pathLength="1" d={d} />
          <g transform={`translate(${to.x} ${to.y}) rotate(${angle})`}>
            <path
              className="tour-head"
              pathLength="1"
              d="M -16 -7 C -11.5 -5.5 -6 -2.5 0 0 C -5 2 -10 3.8 -14 6"
            />
          </g>
        </g>
      </svg>
      <div
        key={words}
        ref={said}
        className={`tour-callout animate-fade-in absolute max-w-[260px] ${current.paper ? "on-paper" : ""}`}
        style={{
          top: box.y,
          ...(current.spot.side === "left"
            ? { right: size.w - box.x - box.w, textAlign: "right" }
            : { left: box.x }),
        }}
      >
        {words}
      </div>
    </div>
  );
}
