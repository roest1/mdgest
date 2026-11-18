import { useMemo, type ReactNode } from "react";
import { Bold, IndentDecrease, IndentIncrease, Italic } from "lucide-react";
import { formatSelection } from "src/lib/editing";
import { formatFor, type Look, type Press } from "src/lib/formatting";
import { useEditor } from "src/lib/store";

/** The selection's formatting: a bar over the foot of both panes while
 *  the selection is text, gone when it is not. What happens to a block --
 *  hidden, deleted -- is decided on the block itself (`BlockActions`);
 *  this is how it is written. Each button acts on every selected block at
 *  once, as one step undo takes back, and is lit when what it sets is
 *  already so of all of them (`formatting.ts`).
 *
 * Outside both panes' scrollers, so a press neither starts a lasso on the
 * page nor reads as a click off every block. The panes leave room at
 * their ends to scroll the last block clear of it. */
export function FormatBar({ docId }: { docId: string }) {
  const selection = useEditor((s) =>
    s.selection?.docId === docId ? s.selection : null,
  );
  const reading = useEditor((s) => s.readings[docId]);
  const format = useMemo(
    () =>
      selection && reading?.status === "ready"
        ? formatFor(
            selection.ids,
            reading.analysis,
            reading.markdown.blocks,
            reading.edits,
          )
        : null,
    [selection, reading],
  );
  if (!format) return null;

  const lit = (look: Look | "quote" | "bold" | "italic") =>
    format.lit.has(look);
  const press = (p: Press) => () => formatSelection(p);
  const role = (look: Look, title: string, glyph: string, list = false) => (
    <Glyph
      key={look}
      action={look}
      on={lit(look)}
      // A list style already on takes it off again.
      title={list && lit(look) ? "Not a list: paragraphs again" : title}
      onClick={press(look)}
    >
      {glyph}
    </Glyph>
  );

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
      <div
        role="toolbar"
        aria-label="Format"
        data-format-bar
        // Not a focus, nor the start of a text selection.
        onMouseDown={(e) => e.preventDefault()}
        className="animate-fade-in pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto
          rounded-xl border border-edge-strong bg-chrome/90 px-1.5 py-1 whitespace-nowrap
          shadow-2xl shadow-black/50 backdrop-blur-md"
      >
        {role("h1", "Heading 1", "H1")}
        {role("h2", "Heading 2", "H2")}
        {role("h3", "Heading 3", "H3")}
        {role("h4", "Heading 4", "H4")}
        {role("para", "Paragraph", "¶")}
        {/* Not a role: a quote holds a heading or a list item as well as
            a paragraph, so it toggles, like bold. */}
        <Glyph
          action="quote"
          on={lit("quote")}
          title={lit("quote") ? "Unquote" : "Quote (>)"}
          onClick={press("quote")}
        >
          &gt;
        </Glyph>
        <Rule />
        {role("bullet", "Bulleted list (-)", "•", true)}
        {role("numbered", "Numbered list (1.)", "1.", true)}
        {role("alpha", "Lettered list (a.)", "a.", true)}
        {role("roman", "Roman list (i.)", "i.", true)}
        {/* Indentation is a list's depth and nothing else's, and only as
            deep as the markdown can nest it: always there, so the bar
            keeps its width, and pressable only when it would move an
            item (`formatting.ts`). */}
        <Tool
          action="outdent"
          title="Outdent"
          disabled={!format.outdent}
          onClick={press("outdent")}
        >
          <IndentDecrease className="h-3.5 w-3.5" aria-hidden />
        </Tool>
        <Tool
          action="indent"
          title="Indent"
          disabled={!format.indent}
          onClick={press("indent")}
        >
          <IndentIncrease className="h-3.5 w-3.5" aria-hidden />
        </Tool>
        <Rule />
        <Tool
          action="bold"
          on={lit("bold")}
          title={
            format.heading
              ? "Bold (a heading is set in its own weight)"
              : "Bold"
          }
          disabled={format.heading}
          onClick={press("bold")}
        >
          <Bold className="h-3.5 w-3.5" aria-hidden />
        </Tool>
        <Tool
          action="italic"
          on={lit("italic")}
          title={
            format.heading
              ? "Italic (a heading is set in its own style)"
              : "Italic"
          }
          disabled={format.heading}
          onClick={press("italic")}
        >
          <Italic className="h-3.5 w-3.5" aria-hidden />
        </Tool>
      </div>
    </div>
  );
}

/** Lit: what every selected block already is, on a ground of its own.
 *  Pointed at, only the mark brightens -- the ground is for "on". */
const LIT = "bg-raised text-ink";
const UNLIT = "text-muted enabled:hover:text-ink";

/** A button carrying an icon. Lit when what it sets is already so. */
function Tool({
  action,
  on = false,
  title,
  disabled,
  onClick,
  children,
}: {
  action: Press;
  on?: boolean;
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={on}
      data-action={action}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors
        disabled:cursor-default disabled:opacity-35 ${on ? LIT : UNLIT}`}
    >
      {children}
    </button>
  );
}

/** The markdown's own marks -- `H2`, `1.`, `¶` -- set in the mono, so they
 *  read as the syntax they write. */
function Glyph({
  action,
  on,
  title,
  onClick,
  children,
}: {
  action: Press;
  on: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={on}
      data-action={action}
      onClick={onClick}
      className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md font-mono text-xs
        transition-colors ${on ? LIT : UNLIT}`}
    >
      {children}
    </button>
  );
}

function Rule() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-edge" aria-hidden />;
}
