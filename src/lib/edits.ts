/** What a person decided about a document: `edits.json`, the one file of a
 *  document's that nothing can make again.
 *
 * Pure, and shared like emit.ts: the page changes the edits and draws them,
 * the worker keeps them and writes the markdown they make. Per block, only
 * the fields a person set, each one an override of what the reader decided;
 * the joins; and the undo and redo stacks. Any other key is kept as it came,
 * so a field a newer build writes survives an older build's rewrite. */

import type { Block, Role } from "./analysis";
import { CHOICES, FURNITURE, type Choice, type Furniture } from "./furniture";
import { isRecord } from "./workspace";

/** 2: `hidden` became a comment in the markdown, and what version 1 called
 *  `hidden` -- out of the markdown -- is `deleted`. Version 1 is still read,
 *  and moved over as it is (`upgrade`). */
export const EDITS_VERSION = 2;

/** How deep undo goes. Older steps fall off the bottom. */
export const UNDO_DEPTH = 100;

/** A `---` written next to a block. A string rather than `true`, so another
 *  kind of break can be added without a new field. */
export type Break = "page";

/** What a person set on one block. A field that is absent is the reader's
 *  call; one that is present overrides it. */
export interface BlockEdit {
  role?: Role;
  level?: number;
  depth?: number;
  bold?: boolean;
  italic?: boolean;
  /** Written as a blockquote, whatever its role: a quoted heading or list
   *  item stays one. */
  quote?: boolean;
  /** Written as an HTML comment: out of the rendered view, still in the
   *  markdown's source, and still numbered. */
  hidden?: boolean;
  /** Out of the markdown altogether, and out of the numbering. The page
   *  keeps the block, to be picked and restored. */
  deleted?: boolean;
  break_before?: Break;
  break_after?: Break;
  /** The block's words as a person corrected them -- a typo, a broken
   *  ligature -- in place of the words the page printed, which stay in the
   *  analysis. The one field here whose words are not the page's. */
  text?: string;
}

/** Text a person wrote into the markdown where the page has none: written
 *  as it was typed, markdown and all, after block `after` -- or at the top
 *  of page `page` when `after` is null. The only words in the markdown no
 *  page block stands behind, which is why they are kept apart from the
 *  blocks rather than passed off as one. */
export interface Insert {
  id: string;
  page: number;
  after: string | null;
  text: string;
}

/** What one undo step puts back: the decisions as they were. A step saved
 *  before joins were kept has none, and leaves the joins as they are. */
export interface Step {
  blocks: Record<string, BlockEdit>;
  joins?: Record<string, string>;
  /** Absent from a step saved before cuts or inserts were kept, which
   *  leaves them as they are. */
  cuts?: Record<string, number[]>;
  inserts?: Insert[];
  /** The furniture settings. Absent from a step saved before a setting
   *  was kept, which leaves that setting as it is. */
  page_numbers?: Choice;
  headers_footers?: Choice;
}

export interface Edits {
  version: typeof EDITS_VERSION;
  blocks: Record<string, BlockEdit>;
  /** Child block id to the block its words were joined onto. The child
   *  leaves the markdown; its parent writes both. Always to a block that
   *  is not itself a child: a join onto a joined group joins its head. */
  joins: Record<string, string>;
  /** Block id to the word positions it is divided at (`divide.ts`): each
   *  starts a piece. Absent when nothing is divided. */
  cuts?: Record<string, number[]>;
  /** Text a person wrote in, in the order it was added. Absent when there
   *  is none. */
  inserts?: Insert[];
  /** Marked done: locked against edits until it is reopened, and what an
   *  export writes markdown for. Not part of an undo step -- reopening is
   *  what takes it back. */
  done?: boolean;
  /** What is done with printed page numbers, and with headers and footers
   *  repeated from page to page (`furniture.ts`). Absent is `keep`. */
  page_numbers?: Choice;
  headers_footers?: Choice;
  undo: Step[];
  redo: Step[];
  /** Whatever else the file held, passed through untouched. */
  [rest: string]: unknown;
}

export function blankEdits(): Edits {
  return { version: EDITS_VERSION, blocks: {}, joins: {}, undo: [], redo: [] };
}

/** Whether `edits` hold nothing a person made: no decisions, and no undo
 *  or redo history either -- edits all undone are still history to keep. */
export function isBlank(edits: Edits): boolean {
  return (
    Object.keys(edits.blocks).length === 0 &&
    Object.keys(edits.joins).length === 0 &&
    Object.keys(edits.cuts ?? {}).length === 0 &&
    (edits.inserts ?? []).length === 0 &&
    FURNITURE.every((kind) => edits[kind] === undefined) &&
    edits.undo.length === 0 &&
    edits.redo.length === 0
  );
}

/** Edits from their JSON, or an error saying what is wrong with them. */
export function parseEdits(text: string): Edits {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("its edits.json is not valid JSON.");
  }
  return checkEdits(value, "its edits.json");
}

const ROLES = new Set<string>(["heading", "para", "bullet", "numbered", "alpha", "roman", "image"]);

/** Version 1's overrides in version 2's terms: its `hidden` took a block
 *  out of the markdown, which is `deleted` now. */
function upgradeBlocks(blocks: unknown): unknown {
  if (!isRecord(blocks)) return blocks;
  return Object.fromEntries(
    Object.entries(blocks).map(([id, edit]) => {
      if (!isRecord(edit) || edit.hidden === undefined) return [id, edit];
      const { hidden, ...rest } = edit;
      return [id, { ...rest, deleted: hidden }];
    }),
  );
}

/** A version 1 file as version 2, undo and redo steps included -- or the
 *  value as it came, to be checked as it is. Without this every block
 *  hidden under version 1 would come back as a comment. */
function upgrade(value: Record<string, unknown>): Record<string, unknown> {
  if (value.version !== 1) return value;
  const steps = (list: unknown) =>
    Array.isArray(list)
      ? list.map((s) => (isRecord(s) ? { ...s, blocks: upgradeBlocks(s.blocks) } : s))
      : list;
  return {
    ...value,
    version: EDITS_VERSION,
    blocks: upgradeBlocks(value.blocks ?? {}),
    undo: steps(value.undo),
    redo: steps(value.redo),
  };
}

/** Edits from a parsed value, checked field by field: every override a
 *  type the editor can use, every join one id to another. `what` begins
 *  each message -- "its edits.json", or a manifest entry's edits. The undo
 *  and redo stacks are the browser's own and are taken as written. */
export function checkEdits(raw: unknown, what: string): Edits {
  const problem = (detail: string) => new Error(`${what} ${detail}.`);
  if (!isRecord(raw)) throw problem("is not a JSON object");
  const value = upgrade(raw);
  if (value.version !== EDITS_VERSION) throw problem("is not in a format this version reads");
  const { blocks = {}, joins = {}, undo, redo } = value;
  if (!isRecord(blocks)) throw problem("has blocks that are not an object");
  for (const [id, edit] of Object.entries(blocks)) {
    if (!isRecord(edit)) throw problem(`has an override for ${id} that is not an object`);
    const bad = (field: string) => problem(`gives ${id} a ${field} it cannot have`);
    const { role, level, depth, break_before, break_after } = edit;
    if (role !== undefined && !(typeof role === "string" && ROLES.has(role))) throw bad("role");
    if (level !== undefined && !(Number.isInteger(level) && (level as number) >= 0 && (level as number) <= 6)) {
      throw bad("level");
    }
    if (depth !== undefined && !(Number.isInteger(depth) && (depth as number) >= 0)) throw bad("depth");
    for (const flag of ["bold", "italic", "quote", "hidden", "deleted"] as const) {
      if (edit[flag] !== undefined && typeof edit[flag] !== "boolean") throw bad(flag);
    }
    if (edit.text !== undefined && typeof edit.text !== "string") throw bad("text");
    for (const [name, brk] of [["break_before", break_before], ["break_after", break_after]] as const) {
      if (brk !== undefined && brk !== "page") throw bad(name);
    }
  }
  if (!isRecord(joins)) throw problem("has joins that are not an object");
  for (const [child, parent] of Object.entries(joins)) {
    if (typeof parent !== "string") throw problem(`joins ${child} onto something that is not a block id`);
  }
  const { cuts } = value;
  if (cuts !== undefined) {
    if (!isRecord(cuts)) throw problem("has cuts that are not an object");
    for (const [id, at] of Object.entries(cuts)) {
      if (!Array.isArray(at) || !at.every((k) => Number.isInteger(k) && (k as number) > 0)) {
        throw problem(`divides ${id} somewhere that is not a word of it`);
      }
    }
  }
  const { inserts } = value;
  if (inserts !== undefined) {
    const ok = (i: unknown) =>
      isRecord(i) &&
      typeof i.id === "string" &&
      typeof i.text === "string" &&
      Number.isInteger(i.page) &&
      (i.after === null || typeof i.after === "string");
    if (!Array.isArray(inserts) || !inserts.every(ok)) throw problem("has inserted text it cannot read");
  }
  if (value.done !== undefined && typeof value.done !== "boolean") throw problem("has a done that is not true or false");
  for (const kind of FURNITURE) {
    const choice = value[kind];
    if (choice !== undefined && !(typeof choice === "string" && (CHOICES as string[]).includes(choice))) {
      throw problem(`has a ${kind} setting it cannot have`);
    }
  }
  return {
    ...value,
    version: EDITS_VERSION,
    blocks: blocks as Record<string, BlockEdit>,
    joins: joins as Record<string, string>,
    undo: Array.isArray(undo) ? (undo as Step[]) : [],
    redo: Array.isArray(redo) ? (redo as Step[]) : [],
  };
}

/** A block as the markdown writes it: the reader's block with a person's
 *  overrides laid over it. */
export interface Shaped extends Block {
  /** Whether `text` is a person's correction rather than the page's. */
  corrected: boolean;
  quote: boolean;
  hidden: boolean;
  deleted: boolean;
  breakBefore: boolean;
  breakAfter: boolean;
}

export function shape(block: Block, edit: BlockEdit | undefined): Shaped {
  return {
    ...block,
    text: edit?.text ?? block.text,
    corrected: edit?.text !== undefined,
    role: edit?.role ?? block.role,
    level: edit?.level ?? block.level,
    depth: edit?.depth ?? block.depth,
    bold: edit?.bold ?? block.bold,
    italic: edit?.italic ?? block.italic,
    quote: edit?.quote ?? false,
    hidden: edit?.hidden ?? false,
    deleted: edit?.deleted ?? false,
    breakBefore: edit?.break_before !== undefined,
    breakAfter: edit?.break_after !== undefined,
  };
}

/** What a tool sets on a block, by its shaped value. Breaks are on or off
 *  here; `apply` turns that into what is stored. */
export interface Change {
  role?: Role;
  level?: number;
  depth?: number;
  bold?: boolean;
  italic?: boolean;
  quote?: boolean;
  hidden?: boolean;
  deleted?: boolean;
  breakBefore?: boolean;
  breakAfter?: boolean;
}

/** The edits with `change(block)` made to each of `blocks`, as one undo
 *  step -- or the same edits when nothing would change, so a click that
 *  sets what is already so leaves no step to undo.
 *
 * A field set back to the reader's value is dropped rather than stored:
 * what is in the file is only what a person overrode, and a block with
 * nothing overridden leaves the file altogether. */
export function apply(
  edits: Edits,
  blocks: Block[],
  change: (block: Shaped) => Change,
): Edits {
  const next: Record<string, BlockEdit> = { ...edits.blocks };
  for (const block of blocks) {
    const was = edits.blocks[block.id] ?? {};
    const c = change(shape(block, was));
    const entry: BlockEdit = { ...was };
    const field = <K extends "role" | "level" | "depth" | "bold" | "italic">(key: K) => {
      const v = c[key];
      if (v === undefined) return;
      if (v === block[key]) delete entry[key];
      else entry[key] = v as BlockEdit[K];
    };
    field("role");
    field("level");
    field("depth");
    field("bold");
    field("italic");
    // The reader never quotes, hides or deletes, so these are stored only
    // when on.
    for (const key of ["quote", "hidden", "deleted"] as const) {
      if (c[key] === undefined) continue;
      if (c[key]) entry[key] = true;
      else delete entry[key];
    }
    const brk = (on: boolean | undefined, key: "break_before" | "break_after") => {
      if (on === undefined) return;
      if (!on) delete entry[key];
      else entry[key] ??= "page";
    };
    brk(c.breakBefore, "break_before");
    brk(c.breakAfter, "break_after");

    if (Object.keys(entry).length === 0) delete next[block.id];
    else next[block.id] = entry;
  }
  return step(edits, { ...decided(edits), blocks: next });
}

/** The edits with `ids` joined into one block, in the order given: every
 *  one after the first becomes a child of the first. A block already
 *  heading a group brings its children with it, so a join of joined
 *  blocks is one group, never a chain. */
export function join(edits: Edits, ids: string[]): Edits {
  const whole = rejoin(edits, ids);
  if (whole) return whole;
  const [head, ...rest] = ids.map((id) => edits.joins[id] ?? id);
  if (!head) return edits;
  const absorbed = new Set(rest.filter((id) => id !== head));
  if (absorbed.size === 0) return edits;
  const joins = { ...edits.joins };
  for (const [child, parent] of Object.entries(joins)) {
    if (absorbed.has(parent)) joins[child] = head;
  }
  for (const id of absorbed) joins[id] = head;
  return step(edits, { ...decided(edits), joins });
}

/** Pieces of one divided block (`<id>` and `<id>c<k>`), given in order:
 *  the cuts between them taken out, as one step, so the block is whole
 *  again where they meet rather than joined. Null when `ids` are not that. */
function rejoin(edits: Edits, ids: string[]): Edits | null {
  const of = (id: string) => id.replace(/c\d+$/, "");
  const from = (id: string) => Number(/c(\d+)$/.exec(id)?.[1] ?? 0);
  const block = of(ids[0]);
  const at = edits.cuts?.[block];
  if (!at || ids.length < 2 || !ids.every((id) => of(id) === block)) return null;
  const starts = ids.map(from);
  const pieces = [0, ...at];
  const first = pieces.indexOf(starts[0]);
  // Next to each other: the ids are pieces `first`, `first + 1`, ... in turn.
  if (first < 0 || !starts.every((k, i) => pieces[first + i] === k)) return null;
  const gone = new Set(starts.slice(1));
  return setCuts(edits, block, at.filter((k) => !gone.has(k)));
}

/** The edits with `block` divided at `at` -- word positions -- as one step.
 *  An empty `at` makes it whole. */
export function setCuts(edits: Edits, block: string, at: number[]): Edits {
  const cuts = { ...edits.cuts };
  const clean = [...new Set(at)].filter((k) => Number.isInteger(k) && k > 0).sort((a, b) => a - b);
  if (clean.length) cuts[block] = clean;
  else delete cuts[block];
  return step(edits, { ...decided(edits), cuts });
}

/** The edits with every group headed by one of `heads` taken apart. */
export function unjoin(edits: Edits, heads: string[]): Edits {
  const apart = new Set(heads);
  const joins = Object.fromEntries(
    Object.entries(edits.joins).filter(([, parent]) => !apart.has(parent)),
  );
  return step(edits, { ...decided(edits), joins });
}

/** The edits with one kind of furniture kept, hidden or deleted, as one
 *  step. */
export function setFurniture(edits: Edits, kind: Furniture, choice: Choice): Edits {
  return step(edits, { ...decided(edits), [kind]: choice });
}

/** What one step records of `edits`: everything undo puts back. */
function decided(edits: Edits): Required<Step> {
  return {
    blocks: edits.blocks,
    joins: edits.joins,
    cuts: edits.cuts ?? {},
    inserts: edits.inserts ?? [],
    page_numbers: edits.page_numbers ?? "keep",
    headers_footers: edits.headers_footers ?? "keep",
  };
}

/** `edits` with `step`'s decisions -- a setting the step does not record
 *  left as it is, and `keep` stored as nothing. */
function restore(edits: Edits, s: Step): Edits {
  const next: Edits = { ...edits, blocks: s.blocks, joins: s.joins ?? edits.joins };
  const cuts = s.cuts ?? edits.cuts;
  if (cuts && Object.keys(cuts).length) next.cuts = cuts;
  else delete next.cuts;
  const inserts = s.inserts ?? edits.inserts;
  if (inserts && inserts.length) next.inserts = inserts;
  else delete next.inserts;
  for (const kind of FURNITURE) {
    const choice = s[kind] ?? edits[kind];
    if (choice === undefined || choice === "keep") delete next[kind];
    else next[kind] = choice;
  }
  return next;
}

/** `edits` with `next` made its decisions, as one undo step -- or `edits`
 *  itself when `next` decides nothing new. */
function step(edits: Edits, next: Required<Step>): Edits {
  if (
    sameBlocks(edits.blocks, next.blocks) &&
    sameJoins(edits.joins, next.joins) &&
    sameCuts(edits.cuts ?? {}, next.cuts) &&
    JSON.stringify(edits.inserts ?? []) === JSON.stringify(next.inserts) &&
    FURNITURE.every((kind) => (edits[kind] ?? "keep") === next[kind])
  ) {
    return edits;
  }
  return {
    ...restore(edits, next),
    undo: [...edits.undo, decided(edits)].slice(-UNDO_DEPTH),
    redo: [],
  };
}

/** The edits with `text` inserted after block `after` -- at the top of
 *  page `page` when null -- as one step. */
export function addInsert(edits: Edits, page: number, after: string | null, text: string): Edits {
  const had = edits.inserts ?? [];
  const n = had.reduce((m, i) => Math.max(m, Number(/^i(\d+)$/.exec(i.id)?.[1] ?? 0)), 0) + 1;
  return step(edits, { ...decided(edits), inserts: [...had, { id: `i${n}`, page, after, text }] });
}

/** The edits with insert `id` written as `text` instead, or taken out
 *  when `text` is empty: one step. */
export function updateInsert(edits: Edits, id: string, text: string): Edits {
  const had = edits.inserts ?? [];
  const inserts = text.trim()
    ? had.map((i) => (i.id === id ? { ...i, text } : i))
    : had.filter((i) => i.id !== id);
  return step(edits, { ...decided(edits), inserts });
}

/** The edits with every correction on `ids` taken off -- the page's own
 *  words back -- as one step. */
export function restoreText(edits: Edits, ids: string[]): Edits {
  const blocks = { ...edits.blocks };
  for (const id of ids) {
    if (blocks[id]?.text === undefined) continue;
    const { text: _, ...rest } = blocks[id];
    if (Object.keys(rest).length) blocks[id] = rest;
    else delete blocks[id];
  }
  return step(edits, { ...decided(edits), blocks });
}

/** `after`, made from `before` by several changes, as the one step they
 *  are to a person: undo takes them back together. */
export function asOneStep(before: Edits, after: Edits): Edits {
  if (after === before) return before;
  return { ...after, undo: [...before.undo, decided(before)].slice(-UNDO_DEPTH), redo: [] };
}

/** One step back, or the same edits when there is none. */
export function undo(edits: Edits): Edits {
  const back = edits.undo[edits.undo.length - 1];
  if (!back) return edits;
  return {
    ...restore(edits, back),
    undo: edits.undo.slice(0, -1),
    redo: [...edits.redo, decided(edits)],
  };
}

/** The step undo last took back, again. */
export function redo(edits: Edits): Edits {
  const again = edits.redo[edits.redo.length - 1];
  if (!again) return edits;
  return {
    ...restore(edits, again),
    undo: [...edits.undo, decided(edits)].slice(-UNDO_DEPTH),
    redo: edits.redo.slice(0, -1),
  };
}

/** The one shallow record equality both comparisons are. */
function shallowEqual(a: object, b: object): boolean {
  const [x, y] = [a, b] as Record<string, unknown>[];
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((k) => x[k] === y[k]);
}

function sameJoins(a: Record<string, string>, b: Record<string, string>): boolean {
  return shallowEqual(a, b);
}

function sameCuts(a: Record<string, number[]>, b: Record<string, number[]>): boolean {
  const ids = Object.keys(a);
  if (ids.length !== Object.keys(b).length) return false;
  return ids.every((id) => b[id] !== undefined && a[id].join() === b[id].join());
}

function sameBlocks(a: Record<string, BlockEdit>, b: Record<string, BlockEdit>): boolean {
  const ids = Object.keys(a);
  if (ids.length !== Object.keys(b).length) return false;
  return ids.every((id) => b[id] !== undefined && shallowEqual(a[id], b[id]));
}
