import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Where a slide is: shown at all, and arrived. */
export interface SlideState {
  /** Open, or sliding either way. */
  shown: boolean;
  /** Open and done sliding in, or on its way out from there: what is costly
   *  to draw -- a strip of thumbnails -- is drawn while it is. */
  arrived: boolean;
}

/** A sidebar's frame, whose width slides between nothing and `width` CSS
 *  px. What sits beside it reflows every frame of the slide, as it does for
 *  a dragged split: the PDF pane's observer re-lays its pages each frame
 *  and draws them again once the slide ends.
 *
 * Its own width, animated, rather than a view transition: one cross-fades a
 * snapshot of the layout before into the layout after, and the pages in it
 * are stretched until they are drawn again partway through the fade. The
 * contents keep the full width and are clipped, so only what is beside the
 * frame reflows, and they ride its moving edge.
 *
 * The contents are there while the frame is closed, only hidden, so they
 * keep their own state -- which folders or outline entries were open. */
export function Slide({
  open,
  width,
  className = "",
  children,
}: {
  open: boolean;
  width: number;
  /** The contents' box: its look, and its display while shown. */
  className?: string;
  children?: ReactNode | ((state: SlideState) => ReactNode);
}) {
  const frame = useRef<HTMLDivElement>(null);
  const running = useRef<Animation | null>(null);
  // Sliding from the render that turns it, not from the effect after: a
  // render that has it neither open nor sliding hides the contents, and
  // whatever they have drawn would be dropped and drawn again.
  const [turned, setTurned] = useState(open);
  const [sliding, setSliding] = useState(false);
  if (turned !== open) {
    setTurned(open);
    setSliding(true);
  }
  // Set when a slide ends, so a slide out keeps what is drawn and a slide in
  // turned back before it ends never draws anything.
  const [arrived, setArrived] = useState(open);
  const was = useRef(open);

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el || was.current === open) return;
    was.current = open;
    const to = open ? width : 0;
    // From wherever it is: turned back mid-slide, the width the slide has
    // reached, which the animation holds over the style until it is
    // cancelled.
    const from = running.current
      ? el.getBoundingClientRect().width
      : width - to;
    running.current?.cancel();
    // The editor's own timing for things that come and go (index.css).
    // `--shift-time` is in ms. Without the stylesheet, no slide at all:
    // `animate` refuses an empty easing or a duration that is not a number.
    const css = getComputedStyle(el);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const slide = el.animate(
      { width: [`${from}px`, `${to}px`] },
      {
        duration: still.matches
          ? 0
          : Number.parseFloat(css.getPropertyValue("--shift-time")) || 0,
        easing: css.getPropertyValue("--shift-ease").trim() || "linear",
      },
    );
    running.current = slide;
    slide.finished.then(
      () => {
        if (running.current !== slide) return;
        running.current = null;
        setSliding(false);
        setArrived(open);
      },
      // Cancelled: turned back, and the slide that replaced it carries on.
      () => {},
    );
  }, [open, width]);

  const shown = open || sliding;
  return (
    <div
      ref={frame}
      className="flex shrink-0 justify-end overflow-hidden"
      style={{ width: open ? width : 0 }}
    >
      <div
        className={`shrink-0 ${className}`}
        style={{ width, display: shown ? undefined : "none" }}
      >
        {typeof children === "function"
          ? children({ shown, arrived })
          : children}
      </div>
    </div>
  );
}
