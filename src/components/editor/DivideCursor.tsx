import { Check, Scissors, X } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import type { Block } from "src/lib/analysis";
import { cleanCuts, wordsOf, type Word } from "src/lib/divide";
import { divideBlock } from "src/lib/editing";
import { useEditor } from "src/lib/store";

/** Around the block, as the page draws its box. */
const INSET = { x: 3, y: 2 };

/** A place a cut can go: before word `k`, drawn as a caret at `x` down the
 *  height of the line that word is on. */
interface Gap {
  k: number;
  x: number;
  y: number;
  h: number;
}

/** Every place between two of `words` -- `from` up to `to` -- a cut can go.
 *  Between two words on one line, the caret sits midway; where a line
 *  ends, at the start of the next line's first word. */
function gapsOf(words: Word[], from: number, to: number, lineBox: (line: number) => { y: number; h: number }) {
  const out: Gap[] = [];
  for (let k = from + 1; k < to; k++) {
    const a = words[k - 1];
    const b = words[k];
    const { y, h } = lineBox(b.line);
    out.push({ k, x: a.line === b.line ? (a.x1 + b.x0) / 2 : b.x0 - 1.5, y, h });
  }
  return out;
}

/** The cut cursor: over the one block being divided, a caret follows the
 *  pointer from gap to gap between its words, a click places a cut there or
 *  takes one away, and OK -- or Enter -- divides the block at every cut as
 *  one step. Cancel, or Escape, leaves it as it was.
 *
 * A piece of a block already divided is divided further: its cuts join the
 *  block's others, which stay where they are. Positions are in the page's
 *  points; `scale` draws them. */
export function DivideCursor({ docId, block, scale }: { docId: string; block: Block; scale: number }) {
  const reading = useEditor((s) => s.readings[docId]);
  const setDividing = useEditor((s) => s.setDividing);
  const ready = reading?.status === "ready" ? reading : null;

  // The whole block as the reader made it, and which of its words this
  // piece holds.
  const source = block.piece?.of ?? block.id;
  const page = ready?.analysis.pages[block.page - 1];
  const whole = page?.blocks.find((b) => b.id === source);
  const words = useMemo(() => (whole && page ? wordsOf(whole, page) : []), [whole, page]);
  const from = block.piece?.from ?? 0;
  const to = block.piece?.to ?? words.length;
  const had = useMemo(() => ready?.edits.cuts?.[source] ?? [], [ready, source]);
  const gaps = useMemo(
    () => (page ? gapsOf(words, from, to, (line) => page.lines[line].box) : []),
    [words, from, to, page],
  );

  const [cuts, setCuts] = useState<Set<number>>(() => new Set());
  const [hover, setHover] = useState<Gap | null>(null);

  const cancel = () => setDividing(null);
  const ok = () => {
    // The block's cuts outside this piece stay; inside it, the ones placed.
    const keep = had.filter((k) => k <= from || k >= to);
    setDividing(null);
    if (cuts.size) divideBlock(docId, source, cleanCuts([...keep, ...cuts], words.length));
  };

  // Enter and Escape are the cursor's while it is out: Escape here cancels
  // the divide and not the selection under it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Enter") ok();
      else cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!page || gaps.length === 0) return null;

  const box = block.box;
  const left = box.x * scale - INSET.x;
  const top = box.y * scale - INSET.y;
  const toLocal = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left + INSET.x) / scale + box.x, y: (e.clientY - r.top + INSET.y) / scale + box.y };
  };
  // The gap nearest the pointer: on the line under it first, then across.
  const nearest = (p: { x: number; y: number }) => {
    let best: Gap | null = null;
    let score = Infinity;
    for (const g of gaps) {
      const off = p.y < g.y ? g.y - p.y : p.y > g.y + g.h ? p.y - g.y - g.h : 0;
      const s = Math.abs(p.x - g.x) + off * 50;
      if (s < score) [best, score] = [g, s];
    }
    return best;
  };
  const caret = (g: Gap, placed: boolean) => (
    <span
      key={`${placed ? "cut" : "hover"}-${g.k}`}
      className={`pointer-events-none absolute w-0.5 rounded-full ${placed ? "bg-brand" : "bg-brand/50"}`}
      style={{
        left: (g.x - box.x) * scale + INSET.x - 1,
        top: (g.y - box.y) * scale + INSET.y - 2,
        height: g.h * scale + 4,
      }}
    />
  );

  return (
    <>
      <div
        data-dividing
        className="absolute z-10 cursor-text rounded-[3px] ring-1 ring-brand/60"
        style={{ left, top, width: box.w * scale + 2 * INSET.x, height: box.h * scale + 2 * INSET.y }}
        onPointerMove={(e) => setHover(nearest(toLocal(e)))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          e.stopPropagation();
          const g = nearest(toLocal(e));
          if (!g) return;
          setCuts((was) => {
            const next = new Set(was);
            if (next.has(g.k)) next.delete(g.k);
            else next.add(g.k);
            return next;
          });
        }}
      >
        {gaps.filter((g) => cuts.has(g.k)).map((g) => caret(g, true))}
        {hover && !cuts.has(hover.k) && caret(hover, false)}
      </div>
      {/* Above the box's top right, where the eye ends a line of cuts. */}
      <div
        className="absolute z-20 flex -translate-y-full items-center gap-1 pb-1"
        style={{ right: `calc(100% - ${left + box.w * scale + 2 * INSET.x}px)`, top }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="mr-1 flex items-center gap-1 rounded bg-chrome/90 px-1.5 py-0.5 font-mono text-[11px] text-muted">
          <Scissors className="h-3 w-3" />
          {cuts.size === 0 ? "click between words" : `${cuts.size + 1} pieces`}
        </span>
        <button
          type="button"
          title="Cancel (Esc)"
          onClick={cancel}
          className="cursor-pointer rounded bg-chrome/90 p-1 text-muted hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Divide at these cuts (Enter)"
          disabled={cuts.size === 0}
          onClick={ok}
          className="flex cursor-pointer items-center gap-1 rounded bg-brand px-2 py-0.5 text-xs font-medium text-white
            disabled:cursor-default disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" />
          OK
        </button>
      </div>
    </>
  );
}
