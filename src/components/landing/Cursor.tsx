/** The cursors in the "how it works" drawings.
 *
 * `cursor: grab` cannot be put in a picture: the OS paints the pointer over
 * the page and never hands the image out, so an illustration that wants a
 * cursor has to draw one.
 *
 * The two hands are files in public/cursors/, placed with <image> rather
 * than inlined: each is a traced outline of twenty-odd kilobytes of path
 * data, which has no business in a component file, and they are already
 * black on white so they need no theme color. The arrow is ours and small
 * enough to be a path. Magnified past a real 24px on purpose via `size`: a
 * life-sized cursor vanishes inside a drawing. */
const HANDS = {
  /** Open hand over something draggable. */
  grab: { href: "/cursors/grab.svg", ratio: 630 / 631 },
  /** Index finger out. */
  pointing: { href: "/cursors/pointer.svg", ratio: 599 / 640 },
} as const;

const ARROW =
  "M 7 3 L 7 25 L 12.5 20 L 16 28 L 20 26.3 L 16.5 18.5 L 24 18.5 Z";

export function Cursor({
  kind,
  x,
  y,
  size = 32,
}: {
  kind: keyof typeof HANDS | "pointer";
  x: number;
  y: number;
  size?: number;
}) {
  if (kind === "pointer") {
    return (
      <svg
        x={x}
        y={y}
        width={size}
        height={size}
        viewBox="0 0 32 32"
        aria-hidden
      >
        <path
          d={ARROW}
          fill="#fff"
          stroke="#000"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  const { href, ratio } = HANDS[kind];
  // `size` is the height; width follows the file's own aspect so nothing is
  // squashed. Both hands are near enough square that it hardly matters.
  return (
    <image
      href={href}
      x={x}
      y={y}
      width={size * ratio}
      height={size}
      aria-hidden
    />
  );
}
