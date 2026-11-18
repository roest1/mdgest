import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { Eye, EyeOff, RotateCcw, Trash2 } from "lucide-react";
import { actOnSelection } from "src/lib/editing";
import { actionsFor } from "src/lib/hiding";
import { ACTIONS_OUT } from "./blocks";
import { useEditor } from "src/lib/store";

/** A selected block as each surface marks it: ringed in the rendered view
 *  and on the page, lit as a row in the source. */
const SELECTED = ".selection[data-block], [data-block][data-selected]";

/** How near the buttons come to an edge of the pane's view, in px. */
const EDGE = 4;

/** The hide and delete buttons of the selection, on the selected block
 *  under the pointer, in one pane's scroller: the page's, or the
 *  markdown's in either view. They act on the whole selection, whichever
 *  selected block they are shown on (`hiding.ts`), and what they offer is
 *  what it is: Hide or Show, Delete or Restore.
 *
 * One set for the scroller rather than one a block, so the pages, which
 * are memoised, draw nothing again as the pointer moves. Placed in the
 * scroller's content, so it scrolls with the block it is on, and drawn last
 * in it: the scroll sync reads the scroller's first child as its content.
 *
 * `corner` hangs it off the block's top-right corner, across from its
 * note, `out` past the ring `reach` px out, each button labeled; `line` sets it at
 * the right end of the row, in it -- a source line, which is a row tall --
 * as icons alone, each saying what it does in its tip. */
export function BlockActions({
  docId,
  scroller,
  placement,
  reach = 0,
  out = ACTIONS_OUT.markdown,
}: {
  docId: string;
  scroller: RefObject<HTMLElement | null>;
  placement: "corner" | "line";
  reach?: number;
  out?: { x: number; y: number };
}) {
  // The block the pointer is on: the innermost one under it -- a list
  // item's paragraph is the item's. Kept whether or not it is selected, so
  // a click that selects it shows the buttons without the pointer moving.
  const [hovered, setHovered] = useState<HTMLElement | null>(null);
  const selection = useEditor((s) =>
    s.selection?.docId === docId ? s.selection : null,
  );
  const reading = useEditor((s) => s.readings[docId]);
  const placed = reading?.status === "ready" ? reading.markdown.blocks : null;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const over = (e: Event) => {
      const target = e.target as Element;
      if (target.closest("[data-block-actions]")) return;
      setHovered(target.closest<HTMLElement>("[data-block]"));
    };
    const leave = () => setHovered(null);
    el.addEventListener("pointerover", over);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointerover", over);
      el.removeEventListener("pointerleave", leave);
    };
  }, [scroller]);

  // Where it goes, measured once the block is laid out and lit -- after an
  // edit too, which can take the block out of the view or redraw it -- and
  // on every scroll and every change in the content's size, since what is
  // laid out above it can move it. Written
  // to the element, not kept as state: it is the DOM's, read off the DOM.
  const box = useRef<HTMLDivElement>(null);
  const id = hovered?.dataset.block;
  const offered =
    id !== undefined && selection?.ids.includes(id) && placed
      ? actionsFor(selection.ids, placed)
      : null;
  useLayoutEffect(() => {
    const el = scroller.current;
    const me = box.current;
    if (!el || !me || !hovered) return;
    // What the selection lights: the block itself, or the list item a
    // paragraph is the block of.
    const lit = () => {
      const on = hovered.closest<HTMLElement>(SELECTED);
      return hovered.isConnected && on?.dataset.block === id ? on : null;
    };
    const place = () => {
      const on = lit();
      if (!on) {
        me.hidden = true;
        return;
      }
      const at = on.getBoundingClientRect();
      const frame = el.getBoundingClientRect();
      const x = at.right - frame.left - el.clientLeft + el.scrollLeft;
      const y = at.top - frame.top - el.clientTop + el.scrollTop;
      const [left, top] =
        placement === "corner"
          ? [x + reach + out.x, y - reach - out.y]
          : [x - 8, y + at.height / 2];
      // Shown to be measured: until it is drawn, it has no size.
      me.hidden = false;
      // And kept in the pane's view, as a block's note is kept on its
      // paper: past an edge, the scroller would cut it off -- a block at
      // the top of the view, or one as wide as its page. `left` is its
      // right edge and `top` its middle (the translate in its class).
      const w = me.offsetWidth;
      const h = me.offsetHeight;
      const clamp = (v: number, lo: number, hi: number) =>
        Math.min(Math.max(v, lo), Math.max(lo, hi));
      me.style.left = `${clamp(
        left,
        el.scrollLeft + w + EDGE,
        el.scrollLeft + el.clientWidth - EDGE,
      )}px`;
      me.style.top = `${clamp(
        top,
        el.scrollTop + h / 2 + EDGE,
        el.scrollTop + el.clientHeight - h / 2 - EDGE,
      )}px`;
    };
    place();
    let frame = 0;
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    el.addEventListener("scroll", again);
    // And whenever what it scrolls changes size: a figure that loads above
    // the block, or a page drawn in, moves the block without a render here.
    const resized = new ResizeObserver(again);
    if (el.firstElementChild) resized.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", again);
      resized.disconnect();
      cancelAnimationFrame(frame);
    };
  });

  if (!offered || !selection) return null;

  const many = selection.ids.length > 1;
  const iconsOnly = placement === "line";
  const press = (button: "hide" | "del") => (e: MouseEvent) => {
    e.stopPropagation();
    actOnSelection(button);
  };
  // Neither a lasso from the page's paper, nor a click off every block.
  const keep = (e: PointerEvent | MouseEvent) => e.stopPropagation();
  const buttons = [
    offered.hide && {
      key: "hide" as const,
      ...offered.hide,
      Icon: offered.hide.action === "hide" ? EyeOff : Eye,
      label: offered.hide.action === "hide" ? "Hide" : "Show",
    },
    {
      key: "del" as const,
      ...offered.del,
      Icon: offered.del.action === "delete" ? Trash2 : RotateCcw,
      label: offered.del.action === "delete" ? "Delete" : "Restore",
    },
  ].filter((b) => !!b);

  return (
    <div
      data-block-actions
      role="toolbar"
      aria-label="Selected blocks"
      className={[
        "absolute z-40 flex -translate-x-full -translate-y-1/2 items-center gap-0.5 rounded-md bg-raised p-0.5 text-xs whitespace-nowrap",
        // On the page and the rendered view it floats over the block; in
        // the source it sits in the line, as the line's own.
        iconsOnly ? "" : "border border-edge-strong shadow-lg shadow-black/40",
      ].join(" ")}
      ref={box}
      // Placed, and shown, once measured: see above.
      hidden
      onPointerDown={keep}
      onMouseDown={(e) => {
        keep(e);
        // Not a focus, nor the start of a text selection.
        e.preventDefault();
      }}
      onClick={keep}
    >
      {buttons.map(({ key, action, count, Icon, label }) => (
        <button
          key={key}
          type="button"
          data-action={action}
          // A label says it; an icon alone says it in its tip.
          title={
            !iconsOnly
              ? undefined
              : many
                ? `${label} all ${count} selected blocks`
                : label
          }
          className={[
            "flex h-6 items-center gap-1 rounded text-muted hover:bg-ground hover:text-ink",
            iconsOnly ? "w-6 justify-center" : "px-1.5",
            action === "delete" ? "hover:text-red-300" : "",
          ].join(" ")}
          onClick={press(key)}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {!iconsOnly && <span>{many ? `${label} ${count}` : label}</span>}
        </button>
      ))}
    </div>
  );
}
