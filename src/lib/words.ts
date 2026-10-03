/** Words for a person: the small helpers every sentence in the app reaches
 *  for, on both sides of the worker boundary. */

/** Bytes as a person says them. For a listing and for a sentence explaining
 *  what was refused, so the rounding is generous and the units are the
 *  familiar ones. */
export function human(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${i > 0 && n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** `n` of `word`, with the plural `s` an English noun takes. */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** What a caught value has to say for itself. */
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
