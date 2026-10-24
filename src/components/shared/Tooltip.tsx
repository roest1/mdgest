import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** How long the pointer rests before a tip shows, and how long after one
 *  hides that the next shows at once -- running along a toolbar reads each
 *  button without waiting at every one. */
const DELAY = 450;
const WARM = 300;
/** Taller than a control, a thing is a surface -- a block on the page, a
 *  thumbnail -- and its tip goes by the pointer, not under the whole box. */
const SURFACE = 48;
const GAP = 6;
const MARGIN = 8;
/** A tip by the pointer sits clear of the cursor below it, and nearer above
 *  where the cursor's tip is the arrow's point. */
const CURSOR_BELOW = 18;
const CURSOR_ABOVE = 10;

type Tip = {
  text: string;
  key: string | null;
  anchor: DOMRect;
  pointer: { x: number; y: number };
};

/** A short, unspaced trailing `(…)` is a key or the markdown a button
 *  writes -- `(Esc)`, `(Ctrl+Shift+Z)`, `(---)` -- and is set as a key cap.
 *  Anything longer in parentheses is prose and stays in the sentence. */
function split(title: string): { text: string; key: string | null } {
  const m = /^(.*\S)\s*\(([^\s()]{1,16})\)$/.exec(title);
  return m ? { text: m[1], key: m[2] } : { text: title, key: null };
}

/** The app's tooltips. Mounted once; every `title` attribute in the app is
 *  drawn through it, so a button keeps saying what it does with a plain
 *  `title` and gets mdgest's tip instead of the browser's.
 *
 *  While the pointer is over an element its `title` is parked in
 *  `data-title` -- that is what keeps the native tip from showing on top --
 *  and put back on the way out, so the attribute is there for everything
 *  else that reads it. An element with no text and no `aria-label` is named
 *  by its `title` alone, so while parked the title stands in as its label. */
export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let el: HTMLElement | null = null;
    let timer: number | undefined;
    let hiddenAt = 0;
    let pointer = { x: 0, y: 0 };

    const park = (target: HTMLElement) => {
      const title = target.getAttribute("title");
      if (title === null) return;
      target.dataset.title = title;
      target.removeAttribute("title");
      if (!target.hasAttribute("aria-label") && !target.textContent?.trim()) {
        target.setAttribute("aria-label", title);
        target.dataset.titleLabel = "";
      }
    };
    const restore = (target: HTMLElement) => {
      // React may have written a new title meanwhile; that one wins.
      if (target.dataset.title !== undefined && !target.hasAttribute("title")) {
        target.setAttribute("title", target.dataset.title);
      }
      if (target.dataset.titleLabel !== undefined) {
        target.removeAttribute("aria-label");
      }
      delete target.dataset.title;
      delete target.dataset.titleLabel;
    };
    const show = () => {
      if (!el?.isConnected) return;
      const title = el.dataset.title;
      if (!title) return;
      setTip({ ...split(title), anchor: el.getBoundingClientRect(), pointer });
    };
    const hide = () => {
      window.clearTimeout(timer);
      if (el) restore(el);
      el = null;
      setTip((t) => {
        if (t) hiddenAt = performance.now();
        return null;
      });
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const target = (e.target as Element).closest<HTMLElement>(
        "[title], [data-title]",
      );
      if (target === el) return;
      hide();
      if (!target) return;
      el = target;
      park(target);
      pointer = { x: e.clientX, y: e.clientY };
      timer = window.setTimeout(
        show,
        performance.now() - hiddenAt < WARM ? 0 : DELAY,
      );
    };
    const onMove = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      // A React re-render can hand the hovered element its title back.
      if (el?.hasAttribute("title")) park(el);
    };
    const onOut = (e: PointerEvent) => {
      if (el && !el.contains(e.relatedTarget as Node | null)) hide();
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerout", onOut);
    // Anything done to the page puts the tip away rather than leave it
    // pointing at where something was.
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  return tip && createPortal(<Bubble tip={tip} />, document.body);
}

/** Under its anchor, centered; over it when there is no room below; kept
 *  inside the window either way. Measured before paint so it never shows
 *  in the wrong place first. */
function Bubble({ tip }: { tip: Tip }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const box = ref.current!.getBoundingClientRect();
    const surface = tip.anchor.height > SURFACE;
    const x = surface ? tip.pointer.x : tip.anchor.left + tip.anchor.width / 2;
    const below = surface
      ? tip.pointer.y + CURSOR_BELOW
      : tip.anchor.bottom + GAP;
    const above =
      (surface ? tip.pointer.y - CURSOR_ABOVE : tip.anchor.top - GAP) -
      box.height;
    const top =
      below + box.height + MARGIN <= window.innerHeight
        ? below
        : Math.max(MARGIN, above);
    const left = Math.min(
      Math.max(MARGIN, x - box.width / 2),
      window.innerWidth - box.width - MARGIN,
    );
    setAt({ left, top });
  }, [tip]);

  return (
    <div
      ref={ref}
      role="tooltip"
      style={at ?? { left: 0, top: 0, visibility: "hidden" }}
      className="pointer-events-none fixed z-[1000] flex max-w-72 items-center gap-1.5
        rounded-md border border-edge-strong bg-raised px-2 py-1 text-xs leading-snug text-ink
        shadow-lg shadow-black/50 animate-fade"
    >
      <span>{tip.text}</span>
      {tip.key && (
        <kbd className="shrink-0 rounded border border-edge bg-ground/70 px-1 py-px font-mono text-[10px] text-muted">
          {tip.key}
        </kbd>
      )}
    </div>
  );
}
