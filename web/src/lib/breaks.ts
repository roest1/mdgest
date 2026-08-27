import type { Break } from "../types";

/**
 * A break has three states, not two: none, a page break (`---`), and a file
 * break, which writes `---` too and starts a new markdown file there. One
 * control cycles all three, because a file break *is* a page break that also
 * cuts — two toggles would let someone ask for a cut without a rule, which
 * means nothing on the page or in the output.
 */
export const BREAK_ORDER: Break[] = [null, "page", "file"];

/** `true` is what the field meant before it carried values. */
export function breakOf(value: Break): "page" | "file" | null {
  if (value === "file") return "file";
  return value ? "page" : null;
}

export function nextBreak(value: Break): "page" | "file" | null {
  const at = BREAK_ORDER.indexOf(breakOf(value));
  return BREAK_ORDER[(at + 1) % BREAK_ORDER.length] as "page" | "file" | null;
}

export function breakLabel(value: Break, where: "before" | "after"): string {
  const state = breakOf(value);
  const next = nextBreak(value);
  const name = (b: "page" | "file" | null) =>
    b === "file" ? "a new markdown file" : b === "page" ? `a page break (---)` : "no break";
  return `${name(state)} ${where} this block — click for ${name(next)}`;
}
