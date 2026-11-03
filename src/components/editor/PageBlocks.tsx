import { memo, type CSSProperties } from "react";
import type { Block } from "src/lib/analysis";
import type { Placed } from "src/lib/emit";
import type { Boxes } from "src/lib/store";
import { drawnBox } from "./blocks";

/** One page's blocks, each a box over where it is printed, with its number
 *  on a note: the number the markdown counts it by, restarting at 1 on
 *  every page (`Placed.n`, `emit.ts`). A box shows what the reading found
 *  and where, so what it missed is seen as well -- the text with no box.
 *
 * Which boxes are drawn, and whether the numbers are, is the tool bar's.
 * A box that is off still carries its note while the numbers are on. A
 * block the markdown did not write -- a text block with no words in it --
 * has a box but no number, since there is no line of the markdown for it
 * to be the number of.
 *
 * Pictures first, then text, each in reading order: where a caption is
 * printed over a picture, its note stacks above the picture's box. Drawn,
 * not interactive -- nothing is picked off the page yet -- so the layer
 * lets every pointer event through, and is hidden from assistive tech,
 * which reads the same blocks as the markdown. The look is `.hit` and
 * `.note` in index.css. */
export const PageBlocks = memo(function PageBlocks({
  blocks,
  placed,
  scale,
  page,
  boxes,
  indices,
}: {
  blocks: Block[];
  placed: Record<string, Placed>;
  /** CSS px per point: what the page's own box was laid out at. */
  scale: number;
  /** The page's own box, in CSS px, which the blocks are drawn within. */
  page: { w: number; h: number };
  boxes: Boxes;
  indices: boolean;
}) {
  if (!boxes.text && !boxes.images && !indices) return null;
  const ordered = [
    ...blocks.filter((b) => b.kind === "image"),
    ...blocks.filter((b) => b.kind !== "image"),
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {ordered.map((block) => {
        const boxed = block.kind === "image" ? boxes.images : boxes.text;
        const at = indices ? placed[block.id] : undefined;
        if (!boxed && !at) return null;
        const box = drawnBox(block.box, scale, page);
        return (
          <div
            key={block.id}
            data-block={block.id}
            data-kind={block.kind}
            className={boxed ? "hit" : "hit quiet"}
            // Where it is on the page, as properties the note reads too:
            // it keeps itself on the paper from them.
            style={
              {
                "--box-x": `${box.x}px`,
                "--box-y": `${box.y}px`,
                width: box.w,
                height: box.h,
              } as CSSProperties
            }
          >
            {at && <span className="note">{at.n}</span>}
          </div>
        );
      })}
    </div>
  );
});
