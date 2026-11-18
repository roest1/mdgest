/** Hiding and deleting the selected blocks: which of the two each button
 *  offers, and the edit it makes.
 *
 * A selection can mix blocks shown, hidden and deleted. Each button is one
 * action on all of them, the way bold is in an editor: Hide while any is
 * shown, Show once none is; Delete while any is not deleted, Restore once
 * all are. Hiding is for blocks the markdown writes, so a deleted block is
 * left out of it -- hidden, it would be brought back as a comment -- and a
 * selection of only deleted blocks offers Restore alone.
 *
 * Pure: the panes' buttons read `actionsFor`, and hand `hiding` to
 * `commitEdits`. */

import type { Analysis, Block } from "./analysis";
import { apply, type Edits } from "./edits";
import type { Placed } from "./emit";

export type HideAction = "hide" | "show";
export type DeleteAction = "delete" | "restore";
export type Action = HideAction | DeleteAction;

/** What the two buttons offer for a selection, and how many blocks each
 *  acts on. No `hide` when every selected block is deleted. */
export interface Actions {
  hide: { action: HideAction; count: number } | null;
  del: { action: DeleteAction; count: number };
}

/** The buttons for the blocks `ids`, as the markdown placed them. Null for
 *  no block placed. */
export function actionsFor(
  ids: readonly string[],
  placed: Record<string, Placed>,
): Actions | null {
  const at = ids.map((id) => placed[id]).filter((p) => p !== undefined);
  if (at.length === 0) return null;
  const written = at.filter((p) => !p.deleted);
  return {
    hide: written.length
      ? {
          action: written.some((p) => !p.hidden) ? "hide" : "show",
          count: written.length,
        }
      : null,
    del: {
      action: at.some((p) => !p.deleted) ? "delete" : "restore",
      count: at.length,
    },
  };
}

/** The edit `action` makes to the blocks `ids` of `analysis`: one undo
 *  step, or the same edits when it changes nothing. */
export function hiding(
  ids: readonly string[],
  analysis: Analysis,
  placed: Record<string, Placed>,
  action: Action,
): (edits: Edits) => Edits {
  const hides = action === "hide" || action === "show";
  const blocks: Block[] = [];
  for (const id of ids) {
    const at = placed[id];
    if (!at || (hides && at.deleted)) continue;
    const block = analysis.pages[at.page - 1]?.blocks.find((b) => b.id === id);
    if (block) blocks.push(block);
  }
  return (edits) =>
    blocks.length === 0
      ? edits
      : apply(edits, blocks, () =>
          hides
            ? { hidden: action === "hide" }
            : { deleted: action === "delete" },
        );
}
