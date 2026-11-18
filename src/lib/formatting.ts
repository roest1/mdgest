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
 * italic -- turns off when every block has it, and on otherwise.
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
  /** Every block is a list item: the bar offers indent and outdent. */
  list: boolean;
  /** Any block is a heading, which is set in its own weight: bold and
   *  italic are not offered. */
  heading: boolean;
  /** Some block is indented, so outdent has something to do. */
  outdent: boolean;
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
    list: all((b) => LIST_ROLES.includes(b.role)),
    heading,
    outdent: blocks.some((b) => b.depth > 0),
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
      if (!format.list) return edits;
      const by = press === "indent" ? 1 : -1;
      change = (b) => ({ depth: Math.max(0, b.depth + by) });
    } else if (press in LOOKS) {
      const { role, level } = LOOKS[press as Look];
      change = () => ({ role, level });
    } else {
      const toggle = press as Toggle;
      if (toggle !== "quote" && format.heading) return edits;
      const on = !format.lit.has(toggle);
      change = () => ({ [toggle]: on });
    }
    return apply(edits, blocks, change);
  };
}
