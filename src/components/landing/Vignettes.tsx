import { Cursor } from "./Cursor";
import { InkFilter, MarkdownMark } from "./Marks";

/** The three "how it works" drawings. Inline SVG rather than images so they
 * take color from the theme tokens and motion rules from the stylesheet, and
 * flat on purpose: one accent each, on the same ground as the backdrop, or
 * they would fight it.
 *
 * All three share a viewBox so the column widths match without measuring.
 * The cursors come from Cursor.tsx -- see there for why they cannot simply
 * be the system ones.
 */
const BOX = "0 0 160 130";

/** 1 — a PDF page being dragged into the dashed zone. The page is the
 *  backdrop's, redrawn at a fifth the size with the same folded corner. */
export function DropVignette() {
  return (
    <svg viewBox={BOX} className="mx-auto h-auto w-full" aria-hidden>
      <rect
        className="stroke-edge-strong"
        x="22"
        y="14"
        width="102"
        height="88"
        rx="8"
        fill="none"
        strokeWidth="2"
        strokeDasharray="5 4"
      />
      <g transform="translate(96 70) rotate(-8)">
        <path
          className="fill-brand"
          d="M -24 -30 Q -24 -34 -20 -34 H 8 L 24 -18 V 30 Q 24 34 20 34 H -20 Q -24 34 -24 30 Z"
        />
        <path
          className="stroke-ground"
          d="M 8 -34 V -22 Q 8 -18 12 -18 H 24"
          fill="none"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <g className="fill-ground">
          <rect x="-16" y="-10" width="30" height="3" rx="1.5" />
          <rect x="-16" y="-3" width="20" height="3" rx="1.5" />
          <text
            className="font-sans"
            x="0"
            y="26"
            textAnchor="middle"
            fontSize="17"
            fontWeight="700"
            letterSpacing="-0.5"
          >
            PDF
          </text>
        </g>
      </g>
      <Cursor kind="grab" x={50} y={30} size={44} />
    </svg>
  );
}

/** One numbered block on the review page. */
function Block({
  y,
  n,
  lines,
  lifted = false,
}: {
  y: number;
  n: number;
  lines: number[];
  lifted?: boolean;
}) {
  return (
    <g transform={lifted ? `translate(10 ${y - 6})` : `translate(0 ${y})`}>
      {lifted && (
        <rect
          className="fill-ground/60"
          x="34"
          y="4"
          width="84"
          height={lines.length * 8 + 6}
          rx="3"
        />
      )}
      <rect
        className={
          lifted ? "fill-raised stroke-accent-lit" : "stroke-accent/70"
        }
        x="32"
        y="0"
        width="84"
        height={lines.length * 8 + 6}
        rx="3"
        fill="none"
        strokeWidth="1.5"
      />
      <text
        className="fill-accent-lit font-mono"
        x="27"
        y="9"
        textAnchor="end"
        fontSize="8"
        fontWeight="600"
      >
        {n}
      </text>
      {lines.map((w, i) => (
        <rect
          key={i}
          className="fill-muted/70"
          x="37"
          y={5 + i * 8}
          width={w}
          height="3"
          rx="1.5"
        />
      ))}
    </g>
  );
}

/** 2 — a page with its blocks numbered, one of them lifted mid-drag. The
 *  numbers are what the editor really shows, and the same ones appear in
 *  the markdown; that is the whole pitch, so the drawing is literal. */
export function ReviewVignette() {
  return (
    <svg viewBox={BOX} className="mx-auto h-auto w-full" aria-hidden>
      <rect
        className="fill-raised stroke-edge-strong"
        x="20"
        y="8"
        width="112"
        height="114"
        rx="4"
        strokeWidth="1.5"
      />
      <Block y={18} n={1} lines={[60, 40]} />
      <Block y={52} n={2} lines={[74, 74, 50]} lifted />
      <Block y={92} n={3} lines={[74, 30]} />
      <Cursor kind="pointer" x={110} y={64} size={36} />
    </svg>
  );
}

/** 3 — the Markdown mark on a folder tab: what an export is, a folder you
 *  keep. The mark is the backdrop's; the folder is drawn to match its
 *  weight. */
export function ExportVignette() {
  return (
    <svg viewBox={BOX} className="mx-auto h-auto w-full" aria-hidden>
      <path
        className="fill-raised stroke-edge-strong"
        d="M 24 30 Q 24 24 30 24 H 60 L 70 34 H 128 Q 134 34 134 40 V 104 Q 134 110 128 110 H 30 Q 24 110 24 104 Z"
        strokeWidth="1.5"
      />
      <path
        className="stroke-edge-strong"
        d="M 24 46 H 134"
        fill="none"
        strokeWidth="1.5"
      />
      <g transform="translate(46 56) scale(0.32)">
        <MarkdownMark />
      </g>
      <Cursor kind="pointing" x={104} y={90} size={44} />
    </svg>
  );
}

/** The connector between steps, in the backdrop's hand: same fractal
 *  displacement, same brand stroke, just shorter. `seed` varies the waver so
 *  the two arrows on the page are not the same drawing twice. */
export function InkArrow({ seed }: { seed: number }) {
  const id = `ink-arrow-${seed}`;
  return (
    <svg
      viewBox="0 0 90 44"
      className="h-auto w-16 shrink-0 sm:w-20"
      aria-hidden
    >
      <defs>
        <InkFilter
          id={id}
          frequency={0.06}
          seed={seed}
          scale={2}
          region={["-15%", "-40%", "130%", "180%"]}
        />
      </defs>
      <g
        className="stroke-brand"
        filter={`url(#${id})`}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity="0.7"
      >
        <path d="M 6 24 C 22 10 34 32 48 20 C 58 12 68 22 80 20" />
        <path d="M 70 12 L 80 20 L 70 28" />
      </g>
    </svg>
  );
}
