import { useMediaQuery } from "src/hooks/useMediaQuery";
import { InkFilter, MarkdownMark } from "./Marks";

/** The window shapes the landscape composition actually survives.
 *
 * Both bounds were measured, not guessed, and both are tighter than they look.
 * With `slice` the scale is `max(vw/1200, vh/700)`, so below the viewBox's own
 * 1.714 the *height* wins and the visible width collapses to `700 * aspect`
 * user units centered on x=600 — at 1.61 that stops just short of the Markdown
 * mark's right edge (x≈1165) and shaves it. Above 1.714 the width wins instead
 * and the crop moves to the horizontal axis: visible height is `1200 / aspect`
 * centered on y=350, which reaches the connector's apex (y≈144) at 2.91.
 *
 * 5/3 and 29/10 sit just inside those two numbers. Anything outside the range
 * loses a piece of the drawing, which is the bug this range exists to prevent
 * — so if either glyph or the arc is ever moved, re-measure rather than
 * assuming these still hold.
 */
const COMPOSITION_FITS =
  "(min-aspect-ratio: 5/3) and (max-aspect-ratio: 29/10)";

/** The page's wallpaper: a PDF page on the left, the Markdown mark on the
 * right, and a line that draws itself from one to the other, arcing up and
 * over the whole content block.
 *
 * The Markdown mark is the one in Marks.tsx. The PDF page is drawn here
 * rather than borrowed: Adobe's badge is trade dress, and its red is a
 * *different* red from the brand gradient.
 *
 * Three rules this file lives by, all of which look like style until they bite:
 *
 *   - color comes from `fill-*` / `stroke-*` utilities, or from the `style`
 *     prop for what has no utility (a gradient's `stopColor`) — never from
 *     `fill="var(--color-brand)"`. Browsers do not substitute custom
 *     properties inside SVG presentation *attributes*; the shape renders
 *     black. Either way the hexes stay in index.css, which is the only file
 *     that gets to know what the brand gradient is.
 *   - a group that carries a `transform` or an `opacity` attribute never also
 *     carries an animation class. A CSS property *replaces* the attribute, so
 *     a keyframe touching `transform` (`fade-in` does) would fling the glyph
 *     to the origin for the length of the run, and one touching `opacity`
 *     (`fade-in` does that too, up to 1, with no fill mode) would flash the
 *     glyph at full strength and then snap it back to its own faint level.
 *     Animate a wrapper instead.
 *   - the connector is never routed through the middle of the viewBox. The
 *     content column is `max-w-2xl` — 672 CSS px, about 465 user units at this
 *     scale, centered on x=600 and spanning y≈250 (top of the wordmark) to
 *     y≈442 (bottom of the drop zone). A line drawn straight between the
 *     glyphs spends its entire length behind that block.
 */
export function Backdrop() {
  const fits = useMediaQuery(COMPOSITION_FITS);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 hidden select-none sm:block"
    >
      <svg
        className="h-full w-full"
        viewBox="0 0 1200 700"
        /* Full bleed while the window can hold the composition (see
           COMPOSITION_FITS); outside that range `slice` scales up to cover and
           crops both glyphs off screen, leaving an arrow pointing at nothing.
           `meet` never crops, and `YMin` is the other half of the fix: centered,
           the shrunken arc lands on the wordmark; anchored to the top it sits in
           the empty band a tall window has to spare. */
        preserveAspectRatio={fits ? "xMidYMid slice" : "xMidYMin meet"}
        fill="none"
      >
        <defs>
          {/* the mark's own gradient, laid along the connector's travel:
              light stop where the line leaves the PDF, dark where it lands.
              Only the first few percent are faded, so the line emerges from
              under the page rather than butting into its edge. */}
          <linearGradient
            id="bd-wire"
            gradientUnits="userSpaceOnUse"
            x1="285"
            y1="0"
            x2="868"
            y2="0"
          >
            <stop
              offset="0"
              style={{ stopColor: "var(--color-brand-lit)" }}
              stopOpacity="0"
            />
            <stop
              offset="0.09"
              style={{ stopColor: "var(--color-brand-lit)" }}
              stopOpacity="0.38"
            />
            <stop
              offset="0.5"
              style={{
                stopColor:
                  "color-mix(in srgb, var(--color-brand-lit), var(--color-brand))",
              }}
              stopOpacity="0.5"
            />
            <stop
              offset="1"
              style={{ stopColor: "var(--color-brand)" }}
              stopOpacity="0.72"
            />
          </linearGradient>

          {/* The waver on the connector, and a finer one for its head: noise
              slow enough to waver a 580-unit line is very nearly constant
              across a 24-unit barb, which would slide the head sideways
              without bending it at all. Gentler too, so short strokes do
              not pinch. */}
          <InkFilter
            id="bd-ink"
            frequency={0.02}
            seed={7}
            scale={2.8}
            region={["-15%", "-45%", "130%", "190%"]}
          />
          <InkFilter
            id="bd-ink-fine"
            frequency={0.075}
            seed={3}
            scale={1.5}
            region={["-60%", "-60%", "220%", "220%"]}
          />
        </defs>

        {/* ── PDF, tilted so its top leans north-west ── */}
        <g className="animate-fade-in">
          <g opacity="0.085">
            <g transform="translate(185 300) rotate(-13)">
              {/* page, with the corner turned back */}
              <path
                className="fill-brand"
                d="M -95 -113 Q -95 -125 -83 -125 H 40 L 95 -70 V 113
                   Q 95 125 83 125 H -83 Q -95 125 -95 113 Z"
              />
              <path
                className="stroke-ground"
                d="M 40 -125 V -82 Q 40 -70 52 -70 H 95"
                strokeWidth="7"
                strokeLinejoin="round"
              />
              {/* ruled text above the badge, and the letters below it — both are
                  holes punched in the page rather than ink laid on it, so they
                  stay legible however far the group's opacity is dialled */}
              <g className="fill-ground">
                <rect x="-66" y="-46" width="112" height="9" rx="4.5" />
                <rect x="-66" y="-26" width="76" height="9" rx="4.5" />
                <text
                  className="font-sans"
                  x="0"
                  y="52"
                  textAnchor="middle"
                  fontSize="62"
                  fontWeight="700"
                  letterSpacing="-2"
                >
                  PDF
                </text>
              </g>
            </g>
          </g>
        </g>

        {/* ── Markdown, tilted the other way: top leans north-east ──
            Lighter than the PDF's 0.085 and smaller than its natural pairing
            size, both for the same reason: --color-ink on this ground carries
            far further than --color-brand does, so matching the two by
            opacity number leaves the Markdown mark shouting. */}
        <g className="animate-fade-in">
          <g opacity="0.075">
            <g transform="translate(1022 300) rotate(13) scale(1.3) translate(-104 -64)">
              <MarkdownMark />
            </g>
          </g>
        </g>

        {/* ── the connector ──
            Over the top, leaving the PDF's upper right and coming down into the
            Markdown mark's upper left. The apex sits at y≈144, which clears the
            wordmark at y≈250 with room to spare while staying inside the
            viewBox on a wide, short window — that is the constraint that keeps
            it from arcing higher, since `slice` crops the top and bottom first.

            The curve is deliberately not symmetric. A perfect arch reads as
            generated no matter what the filter does to it; the ink filter
            supplies the waver, and the asymmetry supplies the intent. */}
        <g filter="url(#bd-ink)">
          {/* pathLength normalises the dash maths to 0..1, so the curve can be
              reshaped without retuning the animation. */}
          <path
            className="animate-draw"
            pathLength="1"
            d="M 285 241
               C 330 196 392 160 470 149
               C 548 138 636 143 714 161
               C 776 175 828 186 866 211"
            stroke="url(#bd-wire)"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          {/* Barbs 47° apart and of unequal length (24 and 21), each bowed a
              little, meeting at a tip on the curve's last point. Spread much
              past 50° and it reads as a flag rather than an arrowhead.

              Authored upper barb → tip → lower barb: that stroke order is what
              .animate-draw-head plays back, so reversing the `d` would draw it
              backward out of the point.

              32° is both the curve's exit tangent and the bearing to the
              Markdown mark's center; recompute it if either end moves. */}
          <g transform="translate(866 211) rotate(32)">
            <path
              className="animate-draw-head stroke-brand"
              pathLength="1"
              filter="url(#bd-ink-fine)"
              d="M -22 -9.5 C -16 -7.5 -8 -3.5 0 0 C -7 2.8 -13.5 5.2 -19.5 8.4"
              strokeOpacity="0.72"
              strokeWidth="3.5"
              strokeLinecap="round"
            />
          </g>
        </g>
      </svg>
    </div>
  );
}
