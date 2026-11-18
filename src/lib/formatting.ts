/** Formatting the selected blocks: which of the bar's buttons are lit, and
 *  the edit each press makes.
 *
 * The bar is for text: it is there only while every selected block it
 * would act on is text, as init/monorepo's was. Deleted blocks are left
 * out of it, as they are of hiding (`hiding.ts`): the markdown writes
 * nothing of them to format.
 *
 * Each button acts on all of them at once, as one undo step, and is lit
 * when what it sets is already so of every one -- the reader's call with
 * a person's edits laid over it (`shape`). A toggle -- quote, bold,
 * italic -- turns off when every block has it, and on otherwise. A list
 * style is one too: lit, it makes its items paragraphs again.
 *
 * Indent and outdent are offered only when the markdown can show them:
 * an item nests at most one level under the item before it, and the first
 * of a list not at all, so they go by the depth each item was written at
 * (`Placed.item`), not the depth its edit asks for.
 *
 * Pure: the bar reads `formatFor`, and hands `restyle` to `commitEdits`. */

import type { Analysis, Block, Role } from "./analysis";
import { LIST_ROLES } from "./analysis";
import { apply, shape, type Change, type Edits, type Shaped } from "./edits";
import type { Placed } from "./emit";

/** What a block is written as, one button each. */
export const LOOKS = {
  h1: { role: "heading", level: 1 },
  h2: { role: "heading", level: 2 },
  h3: { role: "heading", level: 3 },
  h4: { role: "heading", level: 4 },
  para: { role: "para", level: 0 },
  bullet: { role: "bullet", level: 0 },
  numbered: { role: "numbered", level: 0 },
  alpha: { role: "alpha", level: 0 },
  roman: { role: "roman", level: 0 },
} as const satisfies Record<string, { role: Role; level: number }>;
export type Look = keyof typeof LOOKS;

/** Set on a block whatever it is written as. */
export type Toggle = "quote" | "bold" | "italic";

/** Every button on the bar. */
export type Press = Look | Toggle | "indent" | "outdent";

export interface Format {
  /** The buttons lit: what every block is already. */
  lit: ReadonlySet<Look | Toggle>;
  /** Any block is a heading, which is set in its own weight: bold and
   *  italic are not offered. */
  heading: boolean;
  /** Some selected list item can nest a level deeper. */
  indent: boolean;
  /** Some selected list item is nested. */
  outdent: boolean;
}

/** The depth each selected list item would be written at after one
 *  indent or outdent, for those it moves. In document order, so an item
 *  under one also indented may follow it down. */
function nesting(
  ids: readonly string[],
  placed: Record<string, Placed>,
  by: 1 | -1,
): Map<string, number> {
  const items = ids
    .filter((id) => placed[id]?.item && !placed[id].deleted)
    .sort((a, b) => placed[a].from - placed[b].from);
  const moved = new Map<string, number>();
  for (const id of items) {
    const { depth, after } = placed[id].item!;
    // As deep as the item before it, as it will be, and one more.
    const before =
      after === null ? -1 : (moved.get(after) ?? placed[after].item!.depth);
    const next =
      by > 0 ? Math.min(depth + 1, before + 1) : Math.max(0, depth - 1);
    if (next !== depth) moved.set(id, next);
  }
  return moved;
}

/** The blocks of `ids` the bar acts on, as `edits` shape them: the ones
 *  written, deleted ones left out. Null when any of them is not text, or
 *  there are none. */
function acted(
  ids: readonly string[],
  analysis: Analysis,
  placed: Record<string, Placed>,
  edits: Edits,
): { raw: Block[]; shaped: Shaped[] } | null {
  const raw: Block[] = [];
  for (const id of ids) {
    const at = placed[id];
    if (!at || at.deleted) continue;
    const block = analysis.pages[at.page - 1]?.blocks.find((b) => b.id === id);
    if (!block) continue;
    if (block.kind !== "text") return null;
    raw.push(block);
  }
  if (raw.length === 0) return null;
  return { raw, shaped: raw.map((b) => shape(b, edits.blocks[b.id])) };
}

/** The bar for the blocks `ids`, or null when it is not offered. */
export function formatFor(
  ids: readonly string[],
  analysis: Analysis,
  placed: Record<string, Placed>,
  edits: Edits,
): Format | null {
  const blocks = acted(ids, analysis, placed, edits)?.shaped;
  if (!blocks) return null;
  const all = (test: (b: Shaped) => boolean) => blocks.every(test);
  const heading = blocks.some((b) => b.role === "heading");
  const lit = new Set<Look | Toggle>();
  for (const [look, { role, level }] of Object.entries(LOOKS))
    if (all((b) => b.role === role && b.level === level)) lit.add(look as Look);
  if (all((b) => b.quote)) lit.add("quote");
  if (!heading && all((b) => b.bold)) lit.add("bold");
  if (!heading && all((b) => b.italic)) lit.add("italic");
  return {
    lit,
    heading,
    indent: nesting(ids, placed, 1).size > 0,
    outdent: nesting(ids, placed, -1).size > 0,
  };
}

/** The edit `press` makes to the blocks `ids` of `analysis`: one undo
 *  step, or the same edits when it changes nothing -- or is not offered. */
export function restyle(
  ids: readonly string[],
  analysis: Analysis,
  placed: Record<string, Placed>,
  press: Press,
): (edits: Edits) => Edits {
  return (edits) => {
    const format = formatFor(ids, analysis, placed, edits);
    const blocks = acted(ids, analysis, placed, edits)?.raw;
    if (!format || !blocks) return edits;
    let change: (b: Shaped) => Change;
    if (press === "indent" || press === "outdent") {
      const moved = nesting(ids, placed, press === "indent" ? 1 : -1);
      return moved.size === 0
        ? edits
        : apply(
            edits,
            blocks.filter((b) => moved.has(b.id)),
            (b) => ({ depth: moved.get(b.id) }),
          );
    } else if (press in LOOKS) {
      const look = press as Look;
      const { role, level } = LOOKS[look];
      const reader = new Map(blocks.map((b) => [b.id, b]));
      // A list style already on every item takes them out of the list: a
      // paragraph, at the depth the reader gave it, so listed again it
      // comes back where it was printed.
      change =
        LIST_ROLES.includes(role) && format.lit.has(look)
          ? (b) => ({ role: "para", level: 0, depth: reader.get(b.id)!.depth })
          : () => ({ role, level });
    } else {
      const toggle = press as Toggle;
      if (toggle !== "quote" && format.heading) return edits;
      const on = !format.lit.has(toggle);
      change = () => ({ [toggle]: on });
    }
    return apply(edits, blocks, change);
  };
}
