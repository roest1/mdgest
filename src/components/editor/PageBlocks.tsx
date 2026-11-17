import { memo, type CSSProperties, type MouseEvent } from "react";
import type { Block, Line } from "src/lib/analysis";
import type { Placed } from "src/lib/emit";
import type { Boxes } from "src/lib/store";
import { drawnBox } from "./blocks";

/** One page's blocks, each a box over where it is printed, with its number
 *  on a note: the number the markdown counts it by, restarting at 1 on
 *  every page (`Placed.n`, `emit.ts`). A box shows what the reading found
 *  and where, so what it missed is seen as well -- the text with no box.
 *
 * Which boxes are drawn, and whether the numbers are, is the tool bar's.
 * A box that is off is still there to be clicked, and is ringed under the
 * pointer; a selected one is ringed and numbered whatever the tool bar
 * says, since the number is how its block is found in the markdown. A
 * text block with no words in it is written nowhere: it has a box but no
 * number, and is not selected by a click.
 *
 * What an edit did is drawn whatever the tool bar says, since it is the
 * document's and not a way of looking at it. A hidden block is written, as
 * a comment: it keeps its number, under a gray veil that leaves its words
 * faint. A deleted one is written nowhere, so it has no number, and each
 * of its lines is struck through in red -- a picture, corner to corner. It
 * is still picked by a click: here is the only place it can be restored.
 *
 * Pictures first, then text, each in reading order: where a caption is
 * printed over a picture, its note stacks above the picture's box, and a
 * click there is the caption's. Hidden from assistive tech, which reads
 * the same blocks as the markdown; nothing here is reached by the keys
 * yet. The look is `.hit`, `.selection` and `.note` in index.css. */
export const PageBlocks = memo(function PageBlocks({
  blocks,
  lines,
  placed,
  scale,
  page,
  boxes,
  indices,
  selected,
  onPick,
}: {
  blocks: Block[];
  /** The page's lines, which a block's `lines` index. */
  lines: Line[];
  placed: Record<string, Placed>;
  /** CSS px per point: what the page's own box was laid out at. */
  scale: number;
  /** The page's own box, in CSS px, which the blocks are drawn within. */
  page: { w: number; h: number };
  boxes: Boxes;
  indices: boolean;
  /** The ids selected on this page. */
  selected: ReadonlySet<string>;
  onPick: (id: string, e: MouseEvent) => void;
}) {
  const ordered = [
    ...blocks.filter((b) => b.kind === "image"),
    ...blocks.filter((b) => b.kind !== "image"),
  ];
  return (
    <div aria-hidden className="absolute inset-0">
      {ordered.map((block) => {
        const boxed = block.kind === "image" ? boxes.images : boxes.text;
        const written = placed[block.id];
        const pickable = written !== undefined;
        const deleted = written?.deleted ?? false;
        const on = pickable && selected.has(block.id);
        const at =
          pickable && !deleted && (indices || on) ? written : undefined;
        const box = drawnBox(block.box, scale, page);
        return (
          <div
            key={block.id}
            data-block={block.id}
            data-kind={block.kind}
            className={[
              "hit",
              boxed ? "" : "quiet",
              pickable ? "pick" : "",
              written?.hidden ? "hidden-block" : "",
              deleted ? "deleted-block" : "",
              on ? "selection on-paper" : "",
            ]
              .filter(Boolean)
              .join(" ")}
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
            onClick={pickable ? (e) => onPick(block.id, e) : undefined}
            // A shift-click extends the browser's own text selection from
            // wherever it last was, across the bars' labels, unless the
            // press is taken here.
            onMouseDown={(e) => e.shiftKey && e.preventDefault()}
          >
            {written?.hidden && <span className="veil" />}
            {deleted && block.kind === "image" && <span className="cross" />}
            {deleted &&
              block.kind === "text" &&
              block.lines.map((i) => {
                const line = lines[i];
                if (!line) return null;
                // Through the middle of the line, across its glyphs, in
                // the box's own px.
                const mid = (line.box.y + line.box.h / 2) * scale - box.y;
                return (
                  <span
                    key={i}
                    className="strike"
                    style={{
                      left: line.box.x * scale - box.x,
                      top: mid,
                      width: line.box.w * scale,
                    }}
                  />
                );
              })}
            {at && <span className="note">{at.n}</span>}
          </div>
        );
      })}
    </div>
  );
});
