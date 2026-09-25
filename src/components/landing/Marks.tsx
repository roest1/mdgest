/** The drawings the backdrop and the vignettes share, so each is drawn once.
 *
 * Both are SVG fragments, not documents: each expects to sit inside a caller's
 * <svg>, in whatever group carries the transform and opacity it wants. */

/** The Markdown mark, github.com/dcurtis/markdown-mark (CC0), at its native
 *  208x128. Its color is the ink's. */
export function MarkdownMark() {
  return (
    <>
      <rect
        className="stroke-ink"
        x="5"
        y="5"
        width="198"
        height="118"
        rx="10"
        fill="none"
        strokeWidth="10"
      />
      <path
        className="fill-ink"
        d="M30 98V30h20l20 25 20-25h20v68H90V59L70 84 50 59v39zM155 98l-30-33h20V30h20v35h20z"
      />
    </>
  );
}

/** Low-frequency noise displacing a stroke: what makes a line read as drawn
 *  rather than plotted. `scale` is the tuning knob and it is touchy -- much
 *  past ~3 on a 3px stroke the waver becomes a wobble -- and `frequency` sets
 *  how long the waver is, so a short stroke wants a finer one than a long
 *  one, or the noise is nearly constant across it and slides it sideways
 *  without bending it. The region should be generous: a displaced stroke
 *  paints outside its own bounding box and would otherwise be clipped at
 *  the default -10%/120%. Goes in the caller's <defs>. */
export function InkFilter({
  id,
  frequency,
  seed,
  scale,
  region,
}: {
  id: string;
  frequency: number;
  seed: number;
  scale: number;
  /** x, y, width, height, as percentages of the filtered element's box. */
  region: [string, string, string, string];
}) {
  const [x, y, width, height] = region;
  return (
    <filter id={id} x={x} y={y} width={width} height={height}>
      <feTurbulence
        type="fractalNoise"
        baseFrequency={frequency}
        numOctaves="2"
        seed={seed}
        result="noise"
      />
      <feDisplacementMap
        in="SourceGraphic"
        in2="noise"
        scale={scale}
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
  );
}
