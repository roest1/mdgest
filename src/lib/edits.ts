/** What a person decided about a document: `edits.json`, the one file of a
 *  document's that nothing can make again.
 *
 * Pure, and shared like emit.ts: the page changes the edits and draws them,
 * the worker keeps them and writes the markdown they make. The shape is the
 * spike's (`engine/mdgest/edits.py`), so a manifest it exported reads here
 * unchanged: per block, only the fields a person set, each one an override
 * of what the reader decided; the joins; and the undo and redo stacks. Any
 * other key a spike file carries -- order, cuts, inserts -- is kept as it
 * came and not read yet. */

import type { Block, Role } from "./analysis";
import { isRecord } from "./workspace";

export const EDITS_VERSION = 1;

/** How deep undo goes. Older steps fall off the bottom. */
export const UNDO_DEPTH = 100;

/** A `---` written next to a block. The spike also knew `"file"`, a break
 *  that starts a new markdown file there; it is read as a page break here,
 *  and kept as it was until someone turns the break off. */
export type Break = "page" | "file";

/** What a person set on one block. A field that is absent is the reader's
 *  call; one that is present overrides it. */
export interface BlockEdit {
  role?: Role;
  level?: number;
  depth?: number;
  bold?: boolean;
  italic?: boolean;
  /** Written as a blockquote, whatever its role: a quoted heading or list
   *  item stays one. Not a field the spike had. */
  quote?: boolean;
  /** Out of the markdown. The page keeps the block, to be picked and
   *  restored. */
  hidden?: boolean;
  break_before?: Break;
  break_after?: Break;
}

/** What one undo step puts back: the decisions as they were. A step saved
 *  before joins were kept has none, and leaves the joins as they are. */
export interface Step {
  blocks: Record<string, BlockEdit>;
  joins?: Record<string, string>;
}

export interface Edits {
  version: typeof EDITS_VERSION;
  blocks: Record<string, BlockEdit>;
  /** Child block id to the block its words were joined onto. The child
   *  leaves the markdown; its parent writes both. Always to a block that
   *  is not itself a child: a join onto a joined group joins its head. */
  joins: Record<string, string>;
  /** Marked done: locked against edits until it is reopened, and what an
   *  export writes markdown for. Not part of an undo step -- reopening is
   *  what takes it back. */
  done?: boolean;
  undo: Step[];
  redo: Step[];
  /** Whatever else the file held, passed through untouched. */
  [rest: string]: unknown;
}

export function blankEdits(): Edits {
  return { version: EDITS_VERSION, blocks: {}, joins: {}, undo: [], redo: [] };
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

/** Edits from a parsed value, checked field by field: every override a
 *  type the editor can use, every join one id to another. `what` begins
 *  each message -- "its edits.json", or a manifest entry's edits. The undo
 *  and redo stacks are the browser's own and are taken as written. */
export function checkEdits(value: unknown, what: string): Edits {
  const problem = (detail: string) => new Error(`${what} ${detail}.`);
  if (!isRecord(value)) throw problem("is not a JSON object");
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
    for (const flag of ["bold", "italic", "quote", "hidden"] as const) {
      if (edit[flag] !== undefined && typeof edit[flag] !== "boolean") throw bad(flag);
    }
    // `true` is what a break was before it carried values.
    for (const [name, brk] of [["break_before", break_before], ["break_after", break_after]] as const) {
      if (brk !== undefined && brk !== "page" && brk !== "file" && brk !== true) throw bad(name);
    }
  }
  if (!isRecord(joins)) throw problem("has joins that are not an object");
  for (const [child, parent] of Object.entries(joins)) {
    if (typeof parent !== "string") throw problem(`joins ${child} onto something that is not a block id`);
  }
  if (value.done !== undefined && typeof value.done !== "boolean") throw problem("has a done that is not true or false");
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
  quote: boolean;
  hidden: boolean;
  breakBefore: boolean;
  breakAfter: boolean;
}

export function shape(block: Block, edit: BlockEdit | undefined): Shaped {
  return {
    ...block,
    role: edit?.role ?? block.role,
    level: edit?.level ?? block.level,
    depth: edit?.depth ?? block.depth,
    bold: edit?.bold ?? block.bold,
    italic: edit?.italic ?? block.italic,
    quote: edit?.quote ?? false,
    hidden: edit?.hidden ?? false,
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
    // The reader never quotes or hides, so these are stored only when on.
    for (const key of ["quote", "hidden"] as const) {
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
  return step(edits, { blocks: next, joins: edits.joins });
}

/** The edits with `ids` joined into one block, in the order given: every
 *  one after the first becomes a child of the first. A block already
 *  heading a group brings its children with it, so a join of joined
 *  blocks is one group, never a chain. */
export function join(edits: Edits, ids: string[]): Edits {
  const [head, ...rest] = ids.map((id) => edits.joins[id] ?? id);
  if (!head) return edits;
  const absorbed = new Set(rest.filter((id) => id !== head));
  if (absorbed.size === 0) return edits;
  const joins = { ...edits.joins };
  for (const [child, parent] of Object.entries(joins)) {
    if (absorbed.has(parent)) joins[child] = head;
  }
  for (const id of absorbed) joins[id] = head;
  return step(edits, { blocks: edits.blocks, joins });
}

/** The edits with every group headed by one of `heads` taken apart. */
export function unjoin(edits: Edits, heads: string[]): Edits {
  const apart = new Set(heads);
  const joins = Object.fromEntries(
    Object.entries(edits.joins).filter(([, parent]) => !apart.has(parent)),
  );
  return step(edits, { blocks: edits.blocks, joins });
}

/** `edits` with `next` made its decisions, as one undo step -- or `edits`
 *  itself when `next` decides nothing new. */
function step(edits: Edits, next: Required<Step>): Edits {
  if (sameBlocks(edits.blocks, next.blocks) && sameJoins(edits.joins, next.joins)) return edits;
  return {
    ...edits,
    ...next,
    undo: [...edits.undo, { blocks: edits.blocks, joins: edits.joins }].slice(-UNDO_DEPTH),
    redo: [],
  };
}

/** One step back, or the same edits when there is none. */
export function undo(edits: Edits): Edits {
  const back = edits.undo[edits.undo.length - 1];
  if (!back) return edits;
  return {
    ...edits,
    blocks: back.blocks,
    joins: back.joins ?? edits.joins,
    undo: edits.undo.slice(0, -1),
    redo: [...edits.redo, { blocks: edits.blocks, joins: edits.joins }],
  };
}

/** The step undo last took back, again. */
export function redo(edits: Edits): Edits {
  const again = edits.redo[edits.redo.length - 1];
  if (!again) return edits;
  return {
    ...edits,
    blocks: again.blocks,
    joins: again.joins ?? edits.joins,
    undo: [...edits.undo, { blocks: edits.blocks, joins: edits.joins }].slice(-UNDO_DEPTH),
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

function sameBlocks(a: Record<string, BlockEdit>, b: Record<string, BlockEdit>): boolean {
  const ids = Object.keys(a);
  if (ids.length !== Object.keys(b).length) return false;
  return ids.every((id) => b[id] !== undefined && shallowEqual(a[id], b[id]));
}
