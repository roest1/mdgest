import {
  ArchiveRestore,
  Check,
  CheckCheck,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  Image,
  Redo2,
  RotateCcw,
  SquareDashed,
  Tag,
  Trash2,
  Type,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, ViewTransition, type ReactNode } from "react";
import { useMenuDismiss } from "src/components/shared/useMenuDismiss";
import { barButton, iconButton } from "./controls";
import { SLIDE } from "./transitions";

/** What a document does with one kind of page furniture: keep it as text,
 *  hide it as an HTML comment, or delete it. As `furniture.ts` names it on
 *  init/monorepo, where it moves to once that is ported. */
type Choice = "keep" | "hide" | "delete";

/** One running header or footer: a wording printed in a margin band on
 *  more than one page, numbers wildcarded, so `Page 3 of 40` is one line.
 *  `key` is that wording, which is what an edit to the line is keyed by. */
interface Line {
  key: string;
  text: string;
  where: "top" | "bottom";
  pages: number[];
  choice: Choice;
}

/** Which blocks the page pane draws a box around: text, images, either or
 *  neither. */
interface Boxes {
  text: boolean;
  images: boolean;
}

// TODO: from findFurniture(analysis) once furniture.ts and the reading are
// ported. Until then nothing is found, and the controls show their empty state.
const FOUND: { pageNumbers: number; lines: Line[] } = {
  pageNumbers: 0,
  lines: [],
};

/** An action inside a flyout or a menu row: an icon and a word. */
const action = (lit = false) =>
  `flex cursor-pointer items-center gap-1.5 rounded px-2 py-0.5 transition-colors ${
    lit ? "bg-edge text-ink" : "text-muted hover:bg-edge/60 hover:text-ink"
  }`;

function HistoryButton({
  icon: Icon,
  title,
  disabled,
}: {
  icon: typeof Undo2;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      className={iconButton}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/** How many of something, beside its name. */
function Count({ n }: { n: number }) {
  return (
    <span className="min-w-4 rounded-full bg-edge px-1.5 text-center font-mono text-[10px] leading-4 text-ink tabular-nums">
      {n}
    </span>
  );
}

/** Runs of consecutive numbers as they are read: `2–5, 7`. */
function runs(ns: number[]): string {
  const out: string[] = [];
  let start = ns[0];
  let prev = ns[0];
  for (const n of ns.slice(1).concat(NaN)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    out.push(start === prev ? String(start) : `${start}–${prev}`);
    start = prev = n;
  }
  return out.join(", ");
}

/** The ways out of `choice`, as the floating toolbar offers them for a
 *  block: shown text can be hidden or deleted, hidden text shown again or
 *  deleted, and deleted text only restored. */
const MOVES: Record<
  Choice,
  { to: Choice; label: string; Icon: LucideIcon; lit?: boolean }[]
> = {
  keep: [
    { to: "hide", label: "hide", Icon: EyeOff },
    { to: "delete", label: "delete", Icon: Trash2 },
  ],
  hide: [
    { to: "keep", label: "show", Icon: Eye },
    { to: "delete", label: "delete", Icon: Trash2 },
  ],
  delete: [{ to: "keep", label: "restore", Icon: ArchiveRestore, lit: true }],
};

function Moves({
  choice,
  onPick,
}: {
  choice: Choice;
  onPick: (choice: Choice) => void;
}) {
  return MOVES[choice].map(({ to, label, Icon, lit }) => (
    <button
      key={label}
      type="button"
      onClick={() => onPick(to)}
      className={action(lit)}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  ));
}

/** A bar button whose options open to its right: on hover with a mouse,
 *  and on a click or tap -- a tablet has no hover -- or keyboard focus.
 *  The options sit inside the same box as the button, padded rather than
 *  spaced from it, so the pointer crossing between them never leaves. */
function Flyout({
  label,
  button,
  disabled,
  children,
}: {
  label: string;
  /** The button's class and contents. */
  button: { className: string; content: ReactNode; title?: string };
  disabled?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  // How the last press on the button came: a mouse has already opened the
  // options by hovering, so its click keeps them open rather than toggling.
  const pressedWith = useRef("");
  useMenuDismiss(open, root, setOpen);
  const shown = open && !disabled;

  return (
    <span
      ref={root}
      className="relative flex"
      onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        title={button.title}
        aria-haspopup="true"
        aria-expanded={shown}
        disabled={disabled}
        onPointerDown={(e) => (pressedWith.current = e.pointerType)}
        onClick={() => {
          const mouse = pressedWith.current === "mouse";
          pressedWith.current = "";
          setOpen((o) => mouse || !o);
        }}
        onFocus={(e) =>
          e.currentTarget.matches(":focus-visible") && setOpen(true)
        }
        className={button.className}
      >
        {button.content}
      </button>
      {shown && (
        <span className="absolute top-1/2 left-full z-30 -translate-y-1/2 pl-1">
          <span
            role="group"
            aria-label={label}
            className="flex gap-0.5 rounded-lg border border-edge-strong bg-raised p-0.5 whitespace-nowrap shadow-xl shadow-black/40"
          >
            {children}
          </span>
        </span>
      )}
    </span>
  );
}

/** Printed page numbers: the button says what they are now, and its
 *  options are the ways out of that. The count is the review -- a page
 *  number is a page number. */
function PageNumbers({
  count,
  choice,
  locked,
  onPick,
}: {
  count: number;
  choice: Choice;
  locked: boolean;
  onPick: (choice: Choice) => void;
}) {
  const Icon = choice === "hide" ? EyeOff : choice === "delete" ? Trash2 : null;
  return (
    <Flyout
      label="Page numbers"
      disabled={locked || count === 0}
      button={{
        className: barButton(),
        title: count === 0 ? "No page numbers found" : undefined,
        content: (
          <>
            {Icon && <Icon className="h-3.5 w-3.5" />}
            <span
              className={
                choice === "delete"
                  ? "line-through decoration-brand-lit decoration-2"
                  : ""
              }
            >
              Page numbers
            </span>
            <Count n={count} />
          </>
        ),
      }}
    >
      <Moves choice={choice} onPick={onPick} />
    </Flyout>
  );
}

/** Running headers and footers, one row per repeated line: each is its own
 *  choice, since a line repeated on every page can still be one worth
 *  keeping. */
function HeadersFooters({
  lines,
  locked,
  onPick,
}: {
  lines: Line[];
  locked: boolean;
  onPick: (key: string, choice: Choice) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useMenuDismiss(open, root, setOpen);
  const places = lines.reduce((n, line) => n + line.pages.length, 0);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={locked || lines.length === 0}
        title={
          lines.length === 0
            ? "No repeated headers or footers found"
            : undefined
        }
        onClick={() => setOpen((o) => !o)}
        className={barButton(open)}
      >
        Headers &amp; footers
        <Count n={lines.length} />
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Headers and footers"
          className="absolute top-full left-0 z-30 mt-1 w-[40rem] max-w-[80vw] overflow-hidden rounded-lg border border-edge bg-raised text-sm shadow-xl shadow-black/40"
        >
          <div className="flex items-baseline justify-between px-3 pt-2.5 pb-1.5">
            <span className="text-ink">Headers &amp; footers</span>
            <span className="text-xs text-muted">
              {lines.length} repeated {lines.length === 1 ? "line" : "lines"} ·{" "}
              {places} {places === 1 ? "place" : "places"}
            </span>
          </div>
          <ul className="border-t border-edge py-1">
            {lines.map((line) => (
              <li
                key={line.key}
                className="grid grid-cols-[3.5rem_minmax(0,1fr)_5.5rem_10rem] items-center gap-3 px-3 py-1.5 text-xs hover:bg-edge/40"
              >
                <span className="justify-self-start rounded bg-ground px-1.5 py-px text-[10px] tracking-wider text-muted uppercase">
                  {line.where}
                </span>
                <span
                  className={`flex min-w-0 items-center gap-1.5 font-mono ${
                    line.choice === "keep" ? "text-ink" : "text-faint"
                  }`}
                >
                  {line.choice === "hide" && (
                    <EyeOff className="h-3.5 w-3.5 shrink-0" />
                  )}
                  {line.choice === "delete" && (
                    <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span
                    className={`truncate ${
                      line.choice === "delete"
                        ? "line-through decoration-brand-lit decoration-2"
                        : ""
                    }`}
                    title={line.text}
                  >
                    {line.text}
                  </span>
                </span>
                <span className="text-muted tabular-nums">
                  {line.pages.length === 1 ? "page" : "pages"}{" "}
                  {runs(line.pages)}
                </span>
                <span className="flex justify-end gap-0.5">
                  <Moves
                    choice={line.choice}
                    onPick={(choice) => onPick(line.key, choice)}
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Which boxes the page draws, behind one button: lit while either is. */
function BoxesButton({
  boxes,
  onChange,
}: {
  boxes: Boxes;
  onChange: (boxes: Partial<Boxes>) => void;
}) {
  const kinds = [
    { key: "text", label: "text", Icon: Type },
    { key: "images", label: "images", Icon: Image },
  ] as const;
  return (
    <Flyout
      label="Boxes on the page"
      button={{
        className: barButton(boxes.text || boxes.images),
        content: (
          <>
            <SquareDashed className="h-3.5 w-3.5" />
            Boxes
          </>
        ),
      }}
    >
      {kinds.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          aria-pressed={boxes[key]}
          onClick={() => onChange({ [key]: !boxes[key] })}
          className={action(boxes[key])}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </Flyout>
  );
}

/** Toolbar spanning both (pdf + md) panes
 * sits under tab row and above each panes respective header **/
export function Toolbar({ docId: _docId }: { docId: string }) {
  const isDone = false; // todo
  // TODO: the editor's store, once ported: the page pane draws the boxes
  // and indices, and the furniture choices are edits.
  const [pageNumbers, setPageNumbers] = useState<Choice>("keep");
  const [lines, setLines] = useState<Line[]>(FOUND.lines);
  const [boxes, setBoxes] = useState<Boxes>({ text: true, images: true });
  const [indices, setIndices] = useState(true);

  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-t border-edge bg-chrome px-3 text-xs text-muted">
      {/* history controls: undo, redo, restart */}
      <div className="flex items-center gap-0.5 justify-self-start">
        <HistoryButton icon={Undo2} title="Undo (Ctrl+Z)" disabled={isDone} />
        <HistoryButton
          icon={Redo2}
          title="Redo (Ctrl+Shift+Z)"
          disabled={isDone}
        />
        <HistoryButton
          icon={RotateCcw}
          title={"Revert to original"}
          disabled={isDone}
        />
      </div>

      <span className="h-5 w-px bg-edge" />

      {/* page furniture: edits, so undo reaches them and done locks them */}
      <div className="flex items-center gap-2">
        <PageNumbers
          count={FOUND.pageNumbers}
          choice={pageNumbers}
          locked={isDone}
          onPick={setPageNumbers}
        />
        <HeadersFooters
          lines={lines}
          locked={isDone}
          onPick={(key, choice) =>
            setLines((prev) =>
              prev.map((line) =>
                line.key === key ? { ...line, choice } : line,
              ),
            )
          }
        />
      </div>

      <span className="h-5 w-px bg-edge" />

      {/* what the page draws: not edits, so they stay live when done */}
      <div className="flex items-center gap-2">
        <BoxesButton
          boxes={boxes}
          onChange={(change) => setBoxes((prev) => ({ ...prev, ...change }))}
        />
        <button
          type="button"
          aria-pressed={indices}
          title={indices ? "Hide the block indices" : "Show the block indices"}
          onClick={() => setIndices((on) => !on)}
          className={barButton(indices)}
        >
          <Tag className="h-3.5 w-3.5" />
          Indices
        </button>
      </div>

      {/* The bar is drawn from its left edge as the explorer moves that edge,
          so what is at the right keeps to its own: the edge that stays. */}
      <ViewTransition update={SLIDE}>
        <div className="relative ml-auto flex items-center gap-2">
          {/* Mark done */}
          {isDone ? (
            <button
              type="button"
              title="Done: locked against edits. Reopen to edit it again"
              className="group flex cursor-pointer items-center gap-1.5 rounded-md
          border border-emerald-500/60 bg-emerald-500/10 px-2 py-1 text-emerald-200 transition-colors
          hover:border-edge hover:bg-raised hover:text-ink"
            >
              <CheckCheck className="h-4 w-4" />
              <span className="group-hover:hidden">done</span>
              <span className="hidden group-hover:inline">reopen</span>
            </button>
          ) : (
            <button
              type="button"
              title="Mark this document done: it locks, and its markdown goes in the export"
              className="flex cursor-pointer items-center gap-1.5 rounded-md
        border border-edge bg-raised/40 px-2 py-1 text-muted transition-colors
        enabled:hover:border-emerald-500/60 enabled:hover:text-emerald-200
        disabled:cursor-default disabled:opacity-40"
            >
              <Check className="h-4 w-4" />
              mark done
            </button>
          )}

          {/* (TODO): ExportMenu.tsx */}
          <button
            type="button"
            title="Export: the one save that survives clearing this browser"
            aria-haspopup="menu"
            onClick={() => alert("Export coming soon")}
            className={barButton()}
          >
            <Download className="h-4 w-4" />
            export
          </button>
        </div>
      </ViewTransition>
    </div>
  );
}
