/** Which blocks of a document are selected, and how a click or a lasso
 *  changes that. Pure: the store keeps the selection and hands these the
 *  markdown's order (`store.ts`); both panes click through them.
 *
 * Only a block the markdown placed can be selected. A block with no words
 * is boxed on the page but written nowhere, so it has no number and no
 * line to select it by. A deleted block is placed but written nowhere: it
 * is selected on the page, where its box still is and is the only place it
 * can be restored from, and never from the markdown, where a range would
 * take in blocks no one there can see. */

import type { Placed } from "./emit";

/** Which pane a selection was made in. */
export type Side = "page" | "markdown";

export interface Selection {
  docId: string;
  /** Selected block ids, in the order the markdown writes them. */
  ids: string[];
  /** The block clicked last. */
  focus: string;
  /** Where a shift-click ranges from: the last block picked without
   *  shift, or the first a lasso swept. */
  anchor: string;
  from: Side;
}

/** The keys held while clicking: shift extends a range from the anchor,
 *  ctrl or cmd toggles the one block. */
export interface Modifiers {
  range: boolean;
  toggle: boolean;
}

/** The keys held on a click, as `pick` reads them: the one translation
 *  both panes click through. */
export function modifiers(e: {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): Modifiers {
  return { range: e.shiftKey, toggle: e.ctrlKey || e.metaKey };
}

/** Whether a plain click landed off every block -- on a pane's background
 *  or a page's bare paper -- rather than ending a drag that selected text.
 *  Both panes clear the selection on one. */
export function offBlocks(e: {
  target: EventTarget;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  if (e.shiftKey || e.ctrlKey || e.metaKey) return false;
  if (!(e.target instanceof Element) || e.target.closest("[data-block]"))
    return false;
  return window.getSelection()?.isCollapsed ?? true;
}

/** Whether block `id` can be selected from `from`: the markdown placed
 *  it, and wrote it unless it is picked on the page. */
export function selectable(
  blocks: Record<string, Placed>,
  id: string,
  from: Side,
): boolean {
  const at = blocks[id];
  return at !== undefined && (!at.deleted || from === "page");
}

/** The selection after a click on block `id` of `docId`, whose blocks the
 *  markdown writes in `order`. */
export function picked(
  selection: Selection | null,
  docId: string,
  order: string[],
  blocks: Record<string, Placed>,
  id: string,
  { range, toggle }: Modifiers,
  from: Side,
): Selection | null {
  if (!selectable(blocks, id, from)) return selection;
  const same = selection?.docId === docId ? selection : null;

  if (range && same) {
    // The anchor's block to this one, whichever way round, in the order
    // they were written -- which is the order across pages too.
    const a = order.indexOf(same.anchor);
    const b = order.indexOf(id);
    if (a >= 0 && b >= 0) {
      const ids = order
        .slice(Math.min(a, b), Math.max(a, b) + 1)
        .filter((x) => selectable(blocks, x, from));
      return { docId, ids, focus: id, anchor: same.anchor, from };
    }
  }
  if (toggle && same) {
    const ids = same.ids.includes(id)
      ? same.ids.filter((x) => x !== id)
      : order.filter((x) => x === id || same.ids.includes(x));
    if (ids.length === 0) return null;
    return { docId, ids, focus: id, anchor: id, from };
  }
  // A plain click on the one block selected lets it go.
  if (!range && !toggle && same?.ids.length === 1 && same.ids[0] === id)
    return null;
  return { docId, ids: [id], focus: id, anchor: id, from };
}

/** The selection after a lasso over the blocks `hits` of `docId`: they
 *  become the selection, or are added to `base` -- the selection as the
 *  lasso began, given when the toggle key was held. Sweeping nothing
 *  leaves `base` as it was, or nothing selected. */
export function lassoed(
  docId: string,
  order: string[],
  blocks: Record<string, Placed>,
  hits: string[],
  base: Selection | null,
  from: Side,
): Selection | null {
  const swept = new Set(hits.filter((id) => selectable(blocks, id, from)));
  const kept = base?.docId === docId ? base : null;
  const ids = order.filter((id) => swept.has(id) || kept?.ids.includes(id));
  // The first block swept, in the order they were written, is what a
  // shift-click ranges from.
  const first = order.find((id) => swept.has(id));
  if (!first) return kept;
  return { docId, ids, focus: first, anchor: first, from };
}

/** The ids of `selection` on each page of `docId`: what each page's row
 *  and each page of the markdown is handed, so only the pages whose part
 *  of it changed draw again. */
export function selectedByPage(
  selection: Selection | null,
  docId: string,
  blocks: Record<string, Placed>,
): Map<number, ReadonlySet<string>> {
  const out = new Map<number, Set<string>>();
  if (selection?.docId !== docId) return out;
  for (const id of selection.ids) {
    const page = blocks[id]?.page;
    if (page === undefined) continue;
    let set = out.get(page);
    if (!set) out.set(page, (set = new Set()));
    set.add(id);
  }
  return out;
}
