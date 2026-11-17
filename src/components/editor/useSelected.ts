import { useMemo } from "react";
import type { Placed } from "src/lib/emit";
import { selectedByPage } from "src/lib/selection";
import { useEditor } from "src/lib/store";

/** No block selected on a page: one set for every such page, so a memoised
 *  page compares equal across selections that do not touch it. */
export const NONE: ReadonlySet<string> = new Set();

/** The selected ids on each page of `docId`, as `selected(page)`. A page
 *  whose part of the selection is what it was gets the very set it had,
 *  so a click on one page draws that page again and no other. */
export function useSelected(
  docId: string,
  blocks: Record<string, Placed>,
): (page: number) => ReadonlySet<string> {
  const selection = useEditor((s) => s.selection);
  // Each page's last set, for as long as the reading's blocks are these.
  const last = useMemo(
    () => new Map<number, ReadonlySet<string>>(),
    // The cache is the reading's: a new one drops every set it held.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, blocks],
  );
  const byPage = useMemo(() => {
    const next = selectedByPage(selection, docId, blocks);
    for (const [page, ids] of next) {
      const before = last.get(page);
      if (before && same(before, ids)) next.set(page, before);
    }
    last.clear();
    for (const [page, ids] of next) last.set(page, ids);
    return next;
  }, [selection, docId, blocks, last]);
  return (page) => byPage.get(page) ?? NONE;
}

function same(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
