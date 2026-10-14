/** Editing the whole markdown as text: a draft of the source view, written
 *  freely, turned back into edits when it is done.
 *
 * The draft is matched to the source it was made from line by line
 * (`diff.ts`). Unchanged lines are left alone; every run that changed is
 * read through the blocks whose lines it covers -- emit says which block
 * wrote each line, so nothing is guessed about whose words are whose:
 *
 * - no block's lines, new words → inserted text, after the block before it
 * - a block's lines, gone → that block deleted (inserted text taken out)
 * - one block's lines, rewritten → that block's shape, hiding, correction
 *   or division, as `source.ts` reads one block's lines
 * - several blocks' lines, the same words on fewer lines → joined
 * - several blocks' lines, rewritten line for line → each block in turn,
 *   and lines left over after them → inserted text
 *
 * Anything else -- several blocks reworded into fewer lines -- is not
 * guessed at: it is a problem, named with its line, and nothing is applied
 * until it is resolved. All that is applied is one undo step. Pure. */

import type { Analysis } from "./analysis";
import { diffLines, type Hunk } from "./diff";
import { addInsert, asOneStep, join, updateInsert, type Edits } from "./edits";
import type { Markdown } from "./emit";
import { editSource, readLine } from "./source";

/** What a draft does to words, for a person to see before it is applied:
 *  each block whose words it corrects (the words it showed, and the words
 *  it will), each block it deletes, and the text it inserts. A draft that
 *  only reshapes, joins or divides changes no word, and has none. */
export interface WordChanges {
  corrected: { id: string; page: number; n: number; was: string; now: string }[];
  deleted: { id: string; page: number; n: number; was: string }[];
  inserted: string[];
}

export type DraftResult =
  | ({ edits: Edits } & WordChanges)
  | { problems: { line: number; problem: string }[] };

/** A changed run, and the written lines inside it that are not changes:
 *  the unchanged blank, `---` and `>` lines between runs made one. */
interface Run extends Hunk {
  skip: [number, number][];
}

/** `hunks` widened to whole blocks: a run that takes in part of a block of
 *  several lines -- inserted text -- takes in all of it, and so does a line
 *  added between two of its lines. The lines added are unchanged ones, so
 *  each side grows by the same count. Runs that come to touch, or have no
 *  block between them, are made one. */
function wholeBlocks(hunks: Hunk[], md: Markdown): Run[] {
  const out: Run[] = [];
  for (const h of hunks) {
    const w: Run = { ...h, skip: [] };
    const above = md.lines[h.a0 - 1]?.block;
    if (h.a0 === h.a1 && above && above === md.lines[h.a0]?.block) {
      const at = md.blocks[above];
      w.a0 = at.from - 1;
      w.b0 -= h.a0 - w.a0;
      w.b1 += at.to - h.a1;
      w.a1 = at.to;
    }
    for (let i = h.a0; i < h.a1; i++) {
      const id = md.lines[i]?.block;
      const at = id ? md.blocks[id] : undefined;
      if (!at || at.from === 0) continue;
      const lo = Math.min(0, at.from - 1 - w.a0);
      const hi = Math.max(0, at.to - w.a1);
      w.a0 += lo;
      w.b0 += lo;
      w.a1 += hi;
      w.b1 += hi;
    }
    const last = out[out.length - 1];
    // Runs with only blank lines (or the rule between pages) between them
    // are one edit: no block stands between them to keep them apart, and
    // matching the blanks would set a line against the wrong neighbor.
    const between = last ? md.lines.slice(last.a1, w.a0) : [];
    if (last && (w.a0 <= last.a1 || between.every((l) => !l.block))) {
      if (w.b0 > last.b1) last.skip.push([last.b1, w.b0]);
      last.skip.push(...w.skip);
      last.a1 = Math.max(last.a1, w.a1);
      last.b1 = Math.max(last.b1, w.b1);
    } else out.push(w);
  }
  return out;
}

/** What writing `text` over `md` -- the source as it stood when the draft
 *  was opened -- makes of `edits`, or the problems in the way. */
export function applyDraft(read: Analysis, edits: Edits, md: Markdown, text: string): DraftResult {
  const old = md.lines.map((l) => l.text);
  const draft = text.replace(/\r\n?/g, "\n").split("\n");
  while (draft.length && !draft[draft.length - 1].trim()) draft.pop();

  const inserts = new Map((edits.inserts ?? []).map((i) => [i.id, i]));
  const problems: { line: number; problem: string }[] = [];
  const inserted: string[] = [];
  let e = edits;

  /** Where text added at old line `a0` goes: after the block or inserted
   *  text before it, or at the top of the page it opens. */
  const anchor = (a0: number): { page: number; after: string | null } => {
    for (let i = a0 - 1; i >= 0; i--) {
      const id = md.lines[i].block;
      if (!id) continue;
      const ins = inserts.get(id);
      // After inserted text: beside it, later in the list, so after it.
      if (ins) return { page: ins.page, after: ins.after };
      return { page: md.blocks[id]?.page ?? md.lines[i].page, after: id };
    }
    return { page: md.lines[a0]?.page ?? 1, after: null };
  };
  const insert = (a0: number, lines: string[]) => {
    const body = lines.join("\n").replace(/^\s*\n|\s+$/g, "");
    if (!body.trim()) return;
    const { page, after } = anchor(a0);
    e = addInsert(e, page, after, body);
    inserted.push(body);
  };
  /** One block's or inserted text's lines rewritten as `written`. */
  const rewrite = (id: string, written: string, line: number): boolean => {
    const at = md.blocks[id];
    const was = inserts.has(id) ? inserts.get(id)!.text : old.slice(at.from - 1, at.to).join("\n");
    // Written as it was -- or saying the same, a space aside -- it is left
    // alone: nothing is pinned by hand that the page or a setting decided.
    const say = (t: string) => JSON.stringify(t.split("\n").filter((l) => l.trim()).map(readLine));
    if (say(written) === say(was)) return true;
    if (at?.furniture) {
      const what = at.furniture === "page_numbers" ? "a page number" : "a repeated header or footer";
      problems.push({
        line,
        problem: `This line is ${what}, hidden by the document's setting: change it from the ⋮ beside mark done.`,
      });
      return false;
    }
    if (inserts.has(id)) {
      if (written.trim() !== inserts.get(id)!.text.trim() && written.trim()) inserted.push(written.trim());
      e = updateInsert(e, id, written.trim());
      return true;
    }
    const made = editSource(read, e, id, was, written);
    if ("problem" in made) {
      problems.push({ line, problem: made.problem });
      return false;
    }
    e = made.edits;
    return true;
  };

  for (const h of wholeBlocks(diffLines(old, draft), md)) {
    const owners = [...new Set(md.lines.slice(h.a0, h.a1).map((l) => l.block).filter((b): b is string => !!b))];
    // The written lines that say something, each with where it is.
    const lines: { text: string; at: number }[] = [];
    const unchanged = (i: number) => h.skip.some(([from, to]) => i >= from && i < to);
    for (let i = h.b0; i < h.b1; i++) if (draft[i].trim() && !unchanged(i)) lines.push({ text: draft[i], at: i });
    const said = owners.map((id) =>
      inserts.has(id) ? inserts.get(id)!.text : old.slice(md.blocks[id].from - 1, md.blocks[id].to).join("\n"),
    );
    // Text written where no block was before goes after the last block
    // this run has passed, or where the run starts.
    let after = h.a0;
    const addLines = (from: number, to: number) => {
      if (from >= to) return;
      const body = draft.slice(lines[from].at, lines[to - 1].at + 1);
      insert(after, body);
    };
    let pending = -1;
    // Inserted text, and a block with corrected words, are not joined: a
    // join writes the head's correction for all of it, and the rest's
    // corrections would be lost.
    const unjoinable = owners.map((id) => inserts.has(id) || !!md.blocks[id]?.corrected);
    const ours = owners.map((id) => inserts.has(id));
    for (const op of align(said, lines.map((l) => l.text), unjoinable, ours)) {
      if (op.kind === "ins") {
        if (pending < 0) pending = op.j;
        continue;
      }
      if (pending >= 0) addLines(pending, op.j);
      pending = -1;
      const id = owners[op.i];
      const at = lines[op.j]?.at ?? h.b0;
      if (op.kind === "del") rewrite(id, "", at + 1);
      else if (op.kind === "match") rewrite(id, lines[op.j].text, at + 1);
      else if (op.kind === "divide") {
        // Inserted text keeps the blank lines written inside it.
        const body = inserts.has(id)
          ? draft.slice(lines[op.j].at, lines[op.j + op.n - 1].at + 1)
          : lines.slice(op.j, op.j + op.n).map((l) => l.text);
        rewrite(id, body.join("\n"), at + 1);
      } else {
        const ids = owners.slice(op.i, op.i + op.n);
        e = join(e, ids);
        rewrite(ids[0], lines[op.j].text, at + 1);
      }
      const last = owners[op.kind === "join" ? op.i + op.n - 1 : op.i];
      after = inserts.has(last) ? after : md.blocks[last].to;
    }
    if (pending >= 0) addLines(pending, lines.length);
  }

  if (problems.length) return { problems };

  // Every word the draft changes, set against what the source showed.
  const shown = (id: string) => {
    const at = md.blocks[id];
    if (!at || at.from === 0) return "";
    return old.slice(at.from - 1, at.to).map((l) => readLine(l).text).join(" ");
  };
  const where = (id: string) => ({ page: md.blocks[id]?.page ?? 0, n: md.blocks[id]?.n ?? 0 });
  const corrected: WordChanges["corrected"] = [];
  const deleted: WordChanges["deleted"] = [];
  for (const [id, now] of Object.entries(e.blocks)) {
    const was = edits.blocks[id];
    if (now.text !== undefined && now.text !== was?.text) {
      corrected.push({ id, ...where(id), was: shown(id), now: now.text });
    }
    if (now.deleted && !was?.deleted) deleted.push({ id, ...where(id), was: shown(id) });
  }
  return { edits: asOneStep(edits, e), corrected, deleted, inserted };
}

/** Share of words a written line and a block must have in common -- of
 *  the longer of the two -- for the line to be taken as that block
 *  reworded rather than one removed and another written. */
const KIN = 0.5;

/** The words that are the same in a block and a line however each is set:
 *  markup and printed list markers off, case and edge punctuation aside. */
function plain(text: string): string[] {
  return text
    .split("\n")
    .map((l) => readLine(l).text)
    .join(" ")
    .split(/\s+/)
    .map((w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

/** How alike two short texts are, character by character: one less the
 *  edits from one to the other over the longer's length. A typo in a short
 *  line changes a word but few characters. */
function closeness(x: string, y: string): number {
  if (x.length > 300 || y.length > 300) return 0;
  let row = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const next = [i];
    for (let j = 1; j <= y.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return 1 - row[y.length] / Math.max(1, x.length, y.length);
}

/** How much a block's words and a line's are one text: their shared words
 *  over the longer one's count, or how close their characters are,
 *  whichever says more. */
function kinship(a: string[], b: string[]): number {
  return Math.max(sharedWords(a, b), closeness(a.join(" "), b.join(" ")));
}

function sharedWords(a: string[], b: string[]): number {
  const have = new Map<string, number>();
  for (const w of a) have.set(w, (have.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of b) {
    const n = have.get(w) ?? 0;
    if (n > 0) {
      shared++;
      have.set(w, n - 1);
    }
  }
  return shared / Math.max(1, a.length, b.length);
}

/** What one step of an alignment does: a block's lines rewritten as one
 *  line (`match`), `n` blocks joined into one line, one block divided into
 *  `n` lines, a block removed, or a line with no block behind it. */
type Op =
  | { kind: "match"; i: number; j: number }
  | { kind: "join"; i: number; j: number; n: number }
  | { kind: "divide"; i: number; j: number; n: number }
  | { kind: "del"; i: number; j: number }
  | { kind: "ins"; j: number };

/** How many blocks one line may join, or lines one block divide into. */
const MOST = 12;

/** The blocks `said` -- each block's lines as they stood -- set against the
 *  written `lines`, in order, the way that keeps the most of each: a line
 *  is the block it shares most words with, the same words over fewer lines
 *  are blocks joined and over more lines a block divided, and what is left
 *  is blocks removed and lines added. One block set against one line is
 *  that block, however it was rewritten. Blocks marked `unjoinable` are
 *  only ever rewritten or removed; inserted text (`ours`) may be rewritten
 *  over several lines, which are all of it. On a tie, a line goes to the
 *  earlier block. */
function align(said: string[], lines: string[], unjoinable: boolean[], ours: boolean[]): Op[] {
  const inserted = unjoinable;
  const n = said.length;
  const m = lines.length;
  const a = said.map(plain);
  const b = lines.map(plain);
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((w, k) => w === y[k]);
  // best[i][j]: the most that owners i.. and lines j.. can keep.
  const best = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const how: (Op | null)[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null));
  for (let i = n; i >= 0; i--) {
    for (let j = m; j >= 0; j--) {
      let top = -1;
      let op: Op | null = null;
      const consider = (score: number, o: Op) => {
        if (score > top) [top, op] = [score, o];
      };
      if (i < n && j < m) {
        const k = kinship(a[i], b[j]);
        if (k >= KIN || (n === 1 && m === 1)) consider(Math.max(k, KIN) + best[i + 1][j + 1], { kind: "match", i, j });
        if (!inserted[i]) {
          let words = [...a[i]];
          for (let q = 1; i + q < n && q < MOST && !inserted[i + q]; q++) {
            words = [...words, ...a[i + q]];
            if (same(words, b[j])) consider(q + 1 + best[i + q + 1][j + 1], { kind: "join", i, j, n: q + 1 });
          }
          let written = [...b[j]];
          for (let q = 1; j + q < m && q < MOST; q++) {
            written = [...written, ...b[j + q]];
            if (same(written, a[i])) consider(q + 1 + best[i + 1][j + q + 1], { kind: "divide", i, j, n: q + 1 });
          }
        }
      }
      if (i < n && j < m && ours[i]) {
        let written = [...b[j]];
        for (let q = 1; j + q < m && q < MOST; q++) {
          written = [...written, ...b[j + q]];
          const k = kinship(a[i], written);
          if (k >= KIN) consider(k * (q + 1) + best[i + 1][j + q + 1], { kind: "divide", i, j, n: q + 1 });
        }
      }
      if (i < n) consider(best[i + 1][j], { kind: "del", i, j });
      if (j < m) consider(best[i][j + 1], { kind: "ins", j });
      if (i === n && j === m) top = 0;
      best[i][j] = top;
      how[i][j] = op;
    }
  }
  const out: Op[] = [];
  for (let i = 0, j = 0; i < n || j < m; ) {
    const op = how[i][j]!;
    out.push(op);
    if (op.kind === "del") i++;
    else if (op.kind === "ins") j++;
    else if (op.kind === "match") {
      i++;
      j++;
    } else if (op.kind === "join") {
      i += op.n;
      j++;
    } else {
      i++;
      j += op.n;
    }
  }
  return out;
}
