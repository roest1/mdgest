import type { Block } from "../types";

/** Numbers for an order, mirroring emit.resolve_page: deleted blocks get none. */
export function numbering(ids: string[], hidden: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of ids) if (!hidden.has(id)) out.set(id, out.size + 1);
  return out;
}

/** Preview of a move: the new order and which blocks change number. */
export function previewMove(
  blocks: Block[],
  moving: string | string[],
  target: string,
  place: "before" | "after",
): { order: string[]; affected: Set<string>; numbers: Map<string, number> } {
  const ids = blocks.map((b) => b.id);
  const hidden = new Set(blocks.filter((b) => b.hidden).map((b) => b.id));
  const group = new Set(Array.isArray(moving) ? moving : [moving]);
  const movingIds = ids.filter((i) => group.has(i)); // page order, not click order
  const rest = ids.filter((i) => !group.has(i));
  let dst = rest.indexOf(target);
  if (dst < 0) dst = ids.indexOf(movingIds[0]);
  else if (place === "after") dst += 1;
  const out = [...rest.slice(0, dst), ...movingIds, ...rest.slice(dst)];
  const was = numbering(ids, hidden);
  const numbers = numbering(out, hidden);
  const affected = new Set(out.filter((id) => numbers.get(id) !== was.get(id)));
  return { order: out, affected, numbers };
}
