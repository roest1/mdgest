import type { Block } from "../types";

/** Preview of a move: the new order and which blocks change number. */
export function previewMove(
  blocks: Block[],
  moving: string | string[],
  target: string,
  place: "before" | "after",
): { order: string[]; affected: Set<string>; numbers: Map<string, number> } {
  const ids = blocks.map((b) => b.id);
  const group = new Set(Array.isArray(moving) ? moving : [moving]);
  const movingIds = ids.filter((i) => group.has(i)); // page order, not click order
  const rest = ids.filter((i) => !group.has(i));
  let dst = rest.indexOf(target);
  if (dst < 0) dst = ids.indexOf(movingIds[0]);
  else if (place === "after") dst += 1;
  const out = [...rest.slice(0, dst), ...movingIds, ...rest.slice(dst)];
  const numbers = new Map<string, number>();
  const affected = new Set<string>();
  out.forEach((id, i) => {
    numbers.set(id, i + 1);
    if (ids[i] !== id) affected.add(id);
  });
  return { order: out, affected, numbers };
}

export const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"];
export const alpha = (n: number) => {
  let s = "";
  n -= 1;
  for (;;) {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
    if (n < 0) return s;
  }
};
export const roman = (n: number) => (n >= 1 && n <= ROMAN.length ? ROMAN[n - 1] : String(n));

/** Markers for list blocks, mirroring the engine's emit.page_markdown counters. */
export function listMarkers(blocks: Block[]): Map<string, string> {
  const out = new Map<string, string>();
  const counters = new Map<string, number>();
  for (const b of blocks) {
    if (b.hidden) continue;
    const isList = b.role === "bullet" || b.role === "numbered" || b.role === "alpha" || b.role === "roman";
    if (!isList) {
      counters.clear();
      continue;
    }
    const depth = Math.max(0, b.depth || 0);
    for (const k of Array.from(counters.keys())) if (Number(k.split(":")[1]) > depth) counters.delete(k);
    if (b.role === "bullet") {
      out.set(b.id, "•");
      continue;
    }
    const key = `${b.role}:${depth}`;
    const k = (counters.get(key) ?? 0) + 1;
    counters.set(key, k);
    out.set(b.id, b.role === "numbered" ? `${k}.` : b.role === "alpha" ? `${alpha(k)}.` : `${roman(k)}.`);
  }
  return out;
}
