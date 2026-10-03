import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  EyeOff,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Merge,
  Scissors,
  Undo2,
} from "lucide-react";
import { useMemo } from "react";
import type { Block, Role } from "src/lib/analysis";
import { blocksById, LIST_ROLES } from "src/lib/analysis";
import { shape, type Change, type Shaped } from "src/lib/edits";
import { tourShowsTools } from "src/components/editor/tour-steps";
import { editBlocks, joinBlocks, undoEdit, unjoinBlocks } from "src/lib/editing";
import { useEditor } from "src/lib/store";

/** The block tools: they float over the foot of both panes while there is a
 *  selection, and are gone when there is none. Each one acts on every
 *  selected block at once, as one step undo takes back, and is lit when
 *  what it sets is already so of all of them -- the reader's call with a
 *  person's edits laid over it.
 *
 * A toggle -- bold, quote, a break, hide -- turns off when every selected
 *  block has it, and on otherwise. A break is the exception to "every": it
 *  goes around each run of blocks selected together, so a break before
 *  lands on each run's first block and a break after on its last.
 *
 * Join makes one run of text blocks one block, onto the first; selected
 *  joined blocks light it, and it takes them apart. Divide is drawn, and
 *  waits for the edits that cut a block's lines. */
export function FloatingToolbar({ docId }: { docId: string }) {
  const selection = useEditor((s) => s.selection);
  const reading = useEditor((s) => s.readings[docId]);
  // The walkthrough points at the pages and the dock; a bar rising over
  // them mid-step would cover what it is pointing at. Its edit steps are
  // the exception: they point at the bar itself.
  const tour = useEditor((s) => s.tour);
  const touring = tour !== null && !tourShowsTools(tour);

  const analysis = reading?.status === "ready" ? reading.analysis : null;
  const order = reading?.status === "ready" ? reading.markdown.order : null;
  const edits = reading?.status === "ready" ? reading.edits : null;
  const byId = useMemo(
    () => (analysis ? blocksById(analysis) : new Map<string, Block>()),
    [analysis],
  );
  const picked = useMemo(() => {
    if (!selection || selection.docId !== docId) return [];
    return selection.ids.map((id) => byId.get(id)).filter((b): b is Block => b !== undefined);
  }, [selection, docId, byId]);
  const blocks = useMemo(
    () => picked.map((b) => shape(b, edits?.blocks[b.id])),
    [picked, edits],
  );
  // Each block's place in document order, once per emit rather than an
  // indexOf per selected block: a shift-click can select hundreds.
  const position = useMemo(
    () => new Map((order ?? []).map((id, i) => [id, i])),
    [order],
  );
  // The selection's runs: blocks next to each other in document order,
  // across a page turn too. A shift-click makes one run; ctrl-clicks
  // apart make several.
  const runs = useMemo(() => {
    const out: number[][] = [];
    let prev = -2;
    for (const [i, b] of blocks.entries()) {
      const at = position.get(b.id) ?? -1;
      if (at !== prev + 1 || out.length === 0) out.push([]);
      out[out.length - 1].push(i);
      prev = at;
    }
    return out;
  }, [blocks, position]);

  // A document marked done is locked: it is reopened before it is edited.
  if (touring || !edits || edits.done || blocks.length === 0) return null;

  const text = blocks.every((b) => b.kind === "text");
  const all = (test: (b: Shaped) => boolean) => blocks.every(test);
  const role = (r: Role, level = 0) => all((b) => b.role === r && b.level === level);
  const list = all((b) => LIST_ROLES.includes(b.role));
  const heading = blocks.some((b) => b.role === "heading");
  const bold = !heading && all((b) => b.bold);
  const italic = !heading && all((b) => b.italic);
  const quote = all((b) => b.quote);
  const groupHeads = new Set(Object.values(edits.joins));
  const unjoin = all((b) => groupHeads.has(b.id));
  const canJoin =
    text && blocks.length > 1 && runs.length === 1 && !blocks.some((b) => b.hidden);
  const hidden = all((b) => b.hidden);
  const heads = runs.map((run) => run[0]);
  const tails = runs.map((run) => run[run.length - 1]);
  const before = heads.every((i) => blocks[i].breakBefore);
  const after = tails.every((i) => blocks[i].breakAfter);

  const change = (c: (b: Shaped) => Change, only?: number[]) =>
    editBlocks(docId, only ? only.map((i) => picked[i]) : picked, c);
  const setRole = (r: Role, level = 0) => () => change(() => ({ role: r, level }));

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
      <div
        role="toolbar"
        aria-label="Block tools"
        data-tour="tools"
        className="animate-fade-in pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto
          rounded-xl border border-edge-strong bg-chrome/90 px-1.5 py-1 whitespace-nowrap
          shadow-2xl shadow-black/50 backdrop-blur-md"
      >
        {text && (
          <>
            {[1, 2, 3, 4].map((l) => (
              <Glyph
                key={l}
                on={role("heading", l)}
                title={`Heading ${l}`}
                onClick={setRole("heading", l)}
                tour={l === 2 ? "tool-h2" : undefined}
              >
                H{l}
              </Glyph>
            ))}
            <Glyph on={role("para")} onClick={setRole("para")} title="Paragraph">
              ¶
            </Glyph>
            {/* Not a role: a quote holds a heading or a list item as well
                as a paragraph, so it toggles, like bold. */}
            <Glyph
              on={quote}
              onClick={() => change(() => ({ quote: !quote }))}
              title={quote ? "Unquote" : "Quote (>)"}
            >
              &gt;
            </Glyph>
            <Rule />
            <Glyph on={role("bullet")} onClick={setRole("bullet")} title="Bulleted list (-)">
              •
            </Glyph>
            <Glyph on={role("numbered")} onClick={setRole("numbered")} title="Numbered list (1.)">
              1.
            </Glyph>
            <Glyph on={role("alpha")} onClick={setRole("alpha")} title="Lettered list (a.)">
              a.
            </Glyph>
            <Glyph on={role("roman")} onClick={setRole("roman")} title="Roman list (i.)">
              i.
            </Glyph>
            <Tool
              title="Outdent"
              disabled={!list || all((b) => b.depth === 0)}
              onClick={() => change((b) => ({ depth: Math.max(0, b.depth - 1) }))}
            >
              <IndentDecrease className="h-3.5 w-3.5" />
            </Tool>
            <Tool
              title="Indent"
              disabled={!list}
              onClick={() => change((b) => ({ depth: b.depth + 1 }))}
            >
              <IndentIncrease className="h-3.5 w-3.5" />
            </Tool>
            <Rule />
            <Tool
              on={bold}
              title={heading ? "Bold (a heading is set in its own weight)" : "Bold"}
              disabled={heading}
              onClick={() => change(() => ({ bold: !bold }))}
            >
              <Bold className="h-3.5 w-3.5" />
            </Tool>
            <Tool
              on={italic}
              title={heading ? "Italic (a heading is set in its own style)" : "Italic"}
              disabled={heading}
              onClick={() => change(() => ({ italic: !italic }))}
            >
              <Italic className="h-3.5 w-3.5" />
            </Tool>
            <Rule />
            <Tool
              on={unjoin}
              title={
                unjoin
                  ? "Take apart into the blocks it was joined from"
                  : "Join into one block, onto the first"
              }
              disabled={!unjoin && !canJoin}
              onClick={() =>
                unjoin
                  ? unjoinBlocks(docId, picked.map((b) => b.id))
                  : joinBlocks(docId, picked.map((b) => b.id))
              }
            >
              <Merge className="h-3.5 w-3.5" />
              join
            </Tool>
            <Tool title="Divide into two blocks (not built yet)" disabled>
              <Scissors className="h-3.5 w-3.5" />
              divide
            </Tool>
            <Rule />
          </>
        )}
        <Tool
          on={before}
          title={before ? "Remove the page break before" : "Page break before (---)"}
          onClick={() => change(() => ({ breakBefore: !before }), heads)}
        >
          <ArrowUpToLine className="h-3.5 w-3.5" />
        </Tool>
        <Tool
          on={after}
          title={after ? "Remove the page break after" : "Page break after (---)"}
          onClick={() => change(() => ({ breakAfter: !after }), tails)}
        >
          <ArrowDownToLine className="h-3.5 w-3.5" />
        </Tool>
        <Rule />
        <Tool
          on={hidden}
          title={hidden ? "Put back in the markdown" : "Hide from the markdown -- the page keeps it"}
          onClick={() => change(() => ({ hidden: !hidden }))}
        >
          <EyeOff className="h-3.5 w-3.5" />
          hide
        </Tool>
        <Tool
          title="Undo (Ctrl+Z)"
          disabled={edits.undo.length === 0}
          onClick={() => undoEdit(docId)}
          tour="tool-undo"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Tool>
      </div>
    </div>
  );
}

const lit = "bg-raised text-ink";
const unlit = "text-muted enabled:hover:bg-raised/60 enabled:hover:text-ink";

/** A button carrying an icon, and a word when the icon alone would not say
 *  it. Lit when what it sets is already so. */
function Tool({
  on = false,
  title,
  disabled,
  onClick,
  tour,
  children,
}: {
  on?: boolean;
  title: string;
  disabled?: boolean;
  onClick?: () => void;
  /** The walkthrough's name for the button, when it has a step. */
  tour?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={on}
      disabled={disabled}
      data-tour={tour}
      className={`flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors
        disabled:cursor-default disabled:opacity-35 ${on ? lit : unlit}`}
    >
      {children}
    </button>
  );
}

/** The markdown's own marks -- `H2`, `1.`, `¶` -- set in the mono, so they
 *  read as the syntax they write. */
function Glyph({
  on,
  title,
  onClick,
  tour,
  children,
}: {
  on: boolean;
  title: string;
  onClick: () => void;
  /** The walkthrough's name for the button, when it has a step. */
  tour?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={on}
      data-tour={tour}
      className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md font-mono text-xs
        transition-colors ${on ? lit : unlit}`}
    >
      {children}
    </button>
  );
}

function Rule() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-edge" aria-hidden />;
}
