/** Which lines of one text are the lines of another, and which changed:
 *  Myers' diff, over whole lines.
 *
 * Its cost grows with how much changed, not with how long the text is, so
 * a few edits to a long document are quick. Pure. */

/** A run that changed: old lines `a0` up to `a1`, new lines `b0` up to `b1`
 *  -- 0-based, ends not included. One side is empty for a pure removal or
 *  a pure addition. */
export interface Hunk {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/** Every run of `b` that differs from `a`, in order, with the unchanged
 *  lines between them matched up. */
export function diffLines(a: readonly string[], b: readonly string[]): Hunk[] {
  // The common ends first: most edits touch a few lines in the middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0) return [{ a0: start, a1: endA, b0: start, b1: endB }];

  // Myers: for each number of changes d, the furthest point reached on
  // every diagonal k = x - y. The trace keeps each d's front to walk back.
  const max = n + m;
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    v = next;
  }
  trace.push(v);

  // Walk back from the end, noting each removal and addition.
  const edits: ("-" | "+" | "=")[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 2; d >= 0; d--) {
    const front = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && front[offset + k - 1] < front[offset + k + 1]);
    const pk = down ? k + 1 : k - 1;
    const px = front[offset + pk];
    const py = px - pk;
    while (x > px && y > py) {
      edits.push("=");
      x--;
      y--;
    }
    if (d > 0) edits.push(down ? "+" : "-");
    x = px;
    y = py;
  }
  edits.reverse();

  // The removals and additions between matched lines, as runs.
  const hunks: Hunk[] = [];
  let ia = start;
  let ib = start;
  let open: Hunk | null = null;
  for (const e of edits) {
    if (e === "=") {
      if (open) hunks.push(open);
      open = null;
      ia++;
      ib++;
      continue;
    }
    open ??= { a0: ia, a1: ia, b0: ib, b1: ib };
    if (e === "-") open.a1 = ++ia;
    else open.b1 = ++ib;
  }
  if (open) hunks.push(open);
  return hunks;
}
