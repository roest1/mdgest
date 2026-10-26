import { GripVertical } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

/** Neither pane may be dragged narrower than this share of the split. */
const MIN = 0.2;
const MAX = 1 - MIN;
/** How far one arrow key press moves the divide. */
const STEP = 0.02;

const clamp = (f: number) => Math.min(MAX, Math.max(MIN, f));

/** Two panes side by side, with a divide between them that can be dragged,
 *  moved with the arrow keys, or double-clicked back to the middle. */
export function Split({ left, right }: { left: ReactNode; right: ReactNode }) {
  const [share, setShare] = useState(0.5);
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = box.current;
    if (!dragging || !el) return;
    const { left: x, width } = el.getBoundingClientRect();
    setShare(clamp((e.clientX - x) / width));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: share - STEP,
      ArrowRight: share + STEP,
      Home: MIN,
      End: MAX,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    setShare(clamp(moves[e.key]));
  };

  return (
    <div
      ref={box}
      // While dragging, the cursor holds across both panes and nothing in
      // them is selected or hovered as the pointer sweeps over.
      className={`relative flex min-w-0 flex-1 ${dragging ? "cursor-col-resize select-none [&>*:not([role=separator])]:pointer-events-none" : ""}`}
    >
      <div className="min-w-0" style={{ width: `${share * 100}%` }}>
        {left}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panes"
        aria-valuemin={MIN * 100}
        aria-valuemax={MAX * 100}
        aria-valuenow={Math.round(share * 100)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setShare(0.5)}
        onKeyDown={onKeyDown}
        title="Drag to resize, double-click to reset"
        // A 1px line, with a wider hit area laid over it so it is easy to
        // grab, and a grip at its middle to show that it can be.
        className="group relative z-10 w-px shrink-0 cursor-col-resize bg-edge outline-none after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-['']"
      >
        <div
          className={`absolute top-1/2 left-1/2 z-10 flex h-6 w-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm border bg-chrome transition-colors ${
            dragging
              ? "border-edge-strong text-ink"
              : "border-edge text-faint group-hover:border-edge-strong group-hover:text-muted group-focus-visible:border-accent-lit"
          }`}
        >
          <GripVertical className="h-3 w-3" />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">{right}</div>
    </div>
  );
}
