import {
  ArchiveRestore,
  Check,
  CheckCheck,
  ChevronDown,
  Eye,
  EyeOff,
  Image,
  Redo2,
  RefreshCw,
  RotateCcw,
  SquareDashed,
  Tag,
  Trash2,
  Type,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMenuDismiss } from "src/components/shared/useMenuDismiss";
import { outdated, readAgain } from "src/lib/convert";
import {
  redoEdit,
  revertEdits,
  setFurnitureEdit,
  setLineEdit,
  undoEdit,
} from "src/lib/editing";
import { isBlank, revertToOriginal, type Edits } from "src/lib/edits";
import {
  pageNumbers,
  repeatedLines,
  type Choice,
  type RepeatedLine,
} from "src/lib/furniture";
import { useEditor, type Boxes } from "src/lib/store";
import { barButton, iconButton } from "./controls";

/** One running header or footer, as the panel lists it: what was found,
 *  and what the document does with it now. */
interface Line extends RepeatedLine {
  choice: Choice;
}

/** The printed page numbers, as the panel lists them. */
interface Numbers {
  labels: string[];
  pages: number[];
  where: "top" | "bottom";
  choice: Choice;
}

/** An action inside a flyout or a menu row: an icon and a word. */
const action = (lit = false) =>
  `flex cursor-pointer items-center gap-1.5 rounded px-2 py-0.5 transition-colors ${
    lit ? "bg-edge text-ink" : "text-muted hover:bg-edge/60 hover:text-ink"
  }`;

function HistoryButton({
  icon: Icon,
  title,
  disabled,
  onClick,
}: {
  icon: typeof Undo2;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={iconButton}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/** Read the document again with the current reader, offered only when an
 *  older one read it -- which, since a document with no edits is read again
 *  on its own, is a document a person has edited. Its edits go with the
 *  old read, and undo cannot bring them back, so that is asked first. */
function ReadAgain({ docId, edits }: { docId: string; edits: Edits }) {
  // Kept by document: a question asked about one tab's document is not
  // left standing over the next one's.
  const [asking, setAsking] = useState<string | null>(null);
  const go = () => {
    setAsking(null);
    readAgain(docId);
  };
  if (asking === docId)
    return (
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-amber-400/90">
          Read it again? Its edits and their history go, and undo can't bring
          them back.
        </span>
        <button
          type="button"
          onClick={go}
          className="cursor-pointer text-ink hover:underline"
        >
          Read again
        </button>
        <button
          type="button"
          onClick={() => setAsking(null)}
          className="cursor-pointer text-faint hover:text-ink"
        >
          Keep
        </button>
      </span>
    );
  return (
    <button
      type="button"
      title="Read again with the current reader: an older one read this document, and its edits hold it on that read"
      onClick={() => (isBlank(edits) ? go() : setAsking(docId))}
      className={barButton()}
    >
      <RefreshCw className="h-3.5 w-3.5" />
      Read again
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

/** A bar button whose options open below it: on hover with a mouse, and
 *  on a click or tap -- a tablet has no hover -- or keyboard focus.
 *
 * Below, left edges lined up, and not beside it: beside, they lay over the
 * bar's next buttons, which could not be reached while they were open --
 * and the pointer on its way to one crosses this button and opens them.
 * Below, they cover only the panes' bars for as long as they are open, off
 * the path along the tool bar. Nor do they push the next buttons aside,
 * which would move them away from the pointer heading for them.
 *
 * The options sit inside the same box as the button, padded rather than
 * spaced from it, so the pointer crossing between them never leaves. */
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
        <span className="absolute top-full left-0 z-30 pt-1">
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

/** A few of the page numbers, to say what sequence was found: the first
 *  three and the last, `i ii iii … 404`. */
function sample(labels: string[]): string[] {
  return labels.length <= 5
    ? labels
    : [...labels.slice(0, 3), "…", labels[labels.length - 1]];
}

/** One row of the panel: the band it is printed in, what it prints, the
 *  pages it is on, and the ways out of what it is now. */
function Row({
  where,
  choice,
  pages,
  onPick,
  children,
}: {
  where: "top" | "bottom";
  choice: Choice;
  pages: string;
  onPick: (choice: Choice) => void;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[3.5rem_minmax(0,1fr)_7rem_10rem] items-center gap-3 px-3 py-1.5 text-xs hover:bg-edge/40">
      <span className="justify-self-start rounded bg-ground px-1.5 py-px text-[10px] tracking-wider text-muted uppercase">
        {where}
      </span>
      <span
        className={`flex min-w-0 items-center gap-1.5 font-mono ${
          choice === "keep" ? "text-ink" : "text-faint"
        }`}
      >
        {choice === "hide" && <EyeOff className="h-3.5 w-3.5 shrink-0" />}
        {choice === "delete" && <Trash2 className="h-3.5 w-3.5 shrink-0" />}
        {children}
      </span>
      <span className="text-muted tabular-nums">{pages}</span>
      <span className="flex justify-end gap-0.5">
        <Moves choice={choice} onPick={onPick} />
      </span>
    </li>
  );
}

/** How far `panel` may reach while `open`: to the window's bottom and
 *  right edge, `EDGE` px short of each, measured from where it opens and
 *  again when the window is resized. A book can repeat dozens of lines. */
function useRoom(
  open: boolean,
  panel: React.RefObject<HTMLElement | null>,
): React.CSSProperties | undefined {
  const EDGE = 16;
  const [room, setRoom] = useState<React.CSSProperties>();
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const at = panel.current?.getBoundingClientRect();
      if (!at) return;
      setRoom({
        maxHeight: Math.max(96, window.innerHeight - at.top - EDGE),
        maxWidth: Math.max(240, window.innerWidth - at.left - EDGE),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, panel]);
  return open ? room : undefined;
}

/** A group of the panel's rows, under its name. */
function Group({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="border-t border-edge">
      <div className="px-3 pt-2 text-[10px] tracking-wider text-faint uppercase">
        {name}
      </div>
      <ul role="group" aria-label={name} className="py-1">
        {children}
      </ul>
    </div>
  );
}

/** What a page prints around its text, decided in one place as Word
 *  groups it: the printed page numbers, then each running header and
 *  footer, one row per repeated line -- each its own choice, since a line
 *  repeated on every page can still be one worth keeping. */
function HeadersFooters({
  numbers,
  lines,
  locked,
  onPickNumbers,
  onPickLine,
}: {
  numbers: Numbers | null;
  lines: Line[];
  locked: boolean;
  onPickNumbers: (choice: Choice) => void;
  onPickLine: (key: string, choice: Choice) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useMenuDismiss(open, root, setOpen);
  const room = useRoom(open, panel);
  const places = lines.reduce((n, line) => n + line.pages.length, 0);
  const count = lines.length + (numbers ? 1 : 0);
  const struck = (choice: Choice) =>
    choice === "delete" ? "line-through decoration-brand-lit decoration-2" : "";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={locked || count === 0}
        title={
          count === 0 ? "No page numbers, headers or footers found" : undefined
        }
        onClick={() => setOpen((o) => !o)}
        className={barButton(open)}
      >
        Headers &amp; footers
        <Count n={count} />
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label="Headers and footers"
          className="absolute top-full left-0 z-30 mt-1 flex w-[40rem] flex-col overflow-hidden rounded-lg border border-edge bg-raised text-sm shadow-xl shadow-black/40"
          style={room}
        >
          <div className="flex items-baseline justify-between px-3 pt-2.5 pb-1.5">
            <span className="text-ink">Headers &amp; footers</span>
            <span className="text-xs text-muted">
              {[
                numbers && "page numbers",
                lines.length &&
                  `${lines.length} repeated ${lines.length === 1 ? "line" : "lines"}`,
                lines.length &&
                  `${places} ${places === 1 ? "place" : "places"}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          {/* The rows scroll under the panel's name; the panel itself
              stays inside the window. */}
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            {numbers && (
              <Group name="Page numbers">
                <Row
                  where={numbers.where}
                  choice={numbers.choice}
                  pages={`${numbers.pages.length} ${numbers.pages.length === 1 ? "page" : "pages"}`}
                  onPick={onPickNumbers}
                >
                  <span
                    className={`flex min-w-0 gap-1 truncate ${struck(numbers.choice)}`}
                    title={numbers.labels.join(" ")}
                  >
                    {sample(numbers.labels).map((label, i) => (
                      <span key={i} className="rounded bg-ground px-1">
                        {label}
                      </span>
                    ))}
                  </span>
                </Row>
              </Group>
            )}
            {lines.length > 0 && (
              <Group name="Repeated lines">
                {lines.map((line) => (
                  <Row
                    key={line.key}
                    where={line.where}
                    choice={line.choice}
                    pages={`${line.pages.length === 1 ? "page" : "pages"} ${runs(line.pages)}`}
                    onPick={(choice) => onPickLine(line.key, choice)}
                  >
                    <span
                      className={`truncate ${struck(line.choice)}`}
                      title={line.text}
                    >
                      {line.text}
                    </span>
                  </Row>
                ))}
              </Group>
            )}
          </div>
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
export function Toolbar({ docId }: { docId: string }) {
  const isDone = false; // todo
  // The document's edits, once it is read: what the history buttons can do.
  const edits = useEditor((s) => {
    const r = s.readings[docId];
    return r?.status === "ready" ? r.edits : null;
  });
  const analysis = useEditor((s) => {
    const r = s.readings[docId];
    return r?.status === "ready" ? r.analysis : null;
  });
  // What the pages print around their text: found once a reading, not
  // once an edit.
  const found = useMemo(
    () =>
      analysis
        ? { numbers: pageNumbers(analysis), lines: repeatedLines(analysis) }
        : null,
    [analysis],
  );
  const numbers: Numbers | null =
    found && found.numbers.labels.length
      ? { ...found.numbers, choice: edits?.page_numbers ?? "keep" }
      : null;
  const lines: Line[] = (found?.lines ?? []).map((line) => ({
    ...line,
    choice:
      edits?.repeated_lines?.[line.key] ?? edits?.headers_footers ?? "keep",
  }));
  const canUndo = !isDone && !!edits?.undo.length;
  const canRedo = !isDone && !!edits?.redo.length;
  const canRevert = !isDone && !!edits && revertToOriginal(edits) !== edits;
  const boxes = useEditor((s) => s.boxes);
  const setBoxes = useEditor((s) => s.setBoxes);
  const indices = useEditor((s) => s.indices);
  const setIndices = useEditor((s) => s.setIndices);

  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-t border-edge bg-chrome px-3 text-xs text-muted">
      {/* history controls: undo, redo, and revert to original -- itself
          one step, so undo takes it back and nothing need be asked first */}
      <div className="flex items-center gap-0.5 justify-self-start">
        <HistoryButton
          icon={Undo2}
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          onClick={() => undoEdit(docId)}
        />
        <HistoryButton
          icon={Redo2}
          title="Redo (Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={() => redoEdit(docId)}
        />
        <HistoryButton
          icon={RotateCcw}
          title="Revert to original: every edit taken back, which undo brings back"
          disabled={!canRevert}
          onClick={() => revertEdits(docId)}
        />
      </div>

      {analysis && edits && outdated(analysis) && (
        <ReadAgain docId={docId} edits={edits} />
      )}

      <span className="h-5 w-px bg-edge" />

      {/* page furniture: edits, so undo reaches them and done locks them */}
      <div className="flex items-center gap-2">
        <HeadersFooters
          numbers={numbers}
          lines={lines}
          locked={isDone}
          onPickNumbers={(choice) =>
            setFurnitureEdit(docId, "page_numbers", choice)
          }
          onPickLine={(key, choice) => setLineEdit(docId, key, choice)}
        />
      </div>

      <span className="h-5 w-px bg-edge" />

      {/* what the page draws: not edits, so they stay live when done */}
      <div className="flex items-center gap-2">
        <BoxesButton boxes={boxes} onChange={setBoxes} />
        <button
          type="button"
          aria-pressed={indices}
          title={indices ? "Hide the block indices" : "Show the block indices"}
          onClick={() => setIndices(!indices)}
          className={barButton(indices)}
        >
          <Tag className="h-3.5 w-3.5" />
          Indices
        </button>
      </div>

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
      </div>
    </div>
  );
}
