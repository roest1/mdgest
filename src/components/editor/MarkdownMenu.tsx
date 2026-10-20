import { EyeOff, Lock, Pilcrow, Settings, Trash2, type LucideIcon } from "lucide-react";
import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import { useMenuDismiss } from "src/components/shared/useMenuDismiss";
import { setFurnitureEdit } from "src/lib/editing";
import { findFurniture, type Choice, type Found, type Furniture } from "src/lib/furniture";
import { useEditor } from "src/lib/store";

const iconButton =
  "cursor-pointer rounded p-1 text-muted transition-colors enabled:hover:text-ink disabled:cursor-default disabled:opacity-40";

const KINDS: { kind: Furniture; name: string }[] = [
  { kind: "page_numbers", name: "Page numbers" },
  { kind: "headers_footers", name: "Headers & footers" },
];

/** Each choice with the icon it has everywhere: Hide and Delete are the
 *  block toolbar's, applied to a whole kind of block. Keep is the text
 *  left as text. */
const CHOICES: { value: Choice; title: string; Icon: LucideIcon; lit: string }[] = [
  { value: "keep", title: "Keep", Icon: Pilcrow, lit: "" },
  { value: "hide", title: "Hide", Icon: EyeOff, lit: "seg-hide" },
  { value: "delete", title: "Delete", Icon: Trash2, lit: "seg-delete" },
];

/** The markdown pane's gear: settings for the whole document, beside
 *  Done. Today, what is done with its page furniture -- printed page
 *  numbers, and headers and footers repeated from page to page, found by
 *  where they sit and what they print (`furniture.ts`).
 *
 * A panel, not a menu: it stays open while settings change, one row each.
 * Under every row, one line of what this document's markdown will hold for
 * its first example -- what the choice does, shown rather than described.
 * A choice is an edit like any other: one undo step, and locked while the
 * document is done, when the rows still show what is set. */
export function MarkdownMenu({ docId }: { docId: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const reading = useEditor((s) => s.readings[docId]);
  const ready = reading?.status === "ready";
  const analysis = ready ? reading.analysis : null;
  const found = useMemo(() => (analysis ? findFurniture(analysis) : null), [analysis]);

  useMenuDismiss(open, root, setOpen);

  if (!ready || !found) {
    return (
      <button type="button" title="Document settings" disabled className={iconButton}>
        <Settings className="h-4 w-4" />
      </button>
    );
  }
  const locked = !!reading.edits.done;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        title="Document settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${iconButton} ${open ? "text-ink" : ""}`}
      >
        <Settings className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Document settings"
          className="absolute right-0 top-full z-20 mt-1 w-80 rounded-lg border border-edge bg-raised py-1 text-sm shadow-xl shadow-black/40"
        >
          <div className="flex items-center justify-between px-3 pt-1.5 pb-0.5 text-[11px] uppercase tracking-wider text-faint">
            <span>This document</span>
            {locked && (
              <span className="flex items-center gap-1 normal-case tracking-normal">
                <Lock className="h-3 w-3" />
                done · reopen to change
              </span>
            )}
          </div>
          {KINDS.map(({ kind, name }, i) => (
            <Setting
              key={kind}
              name={name}
              found={found[kind]}
              current={reading.edits[kind] ?? "keep"}
              locked={locked}
              divided={i > 0}
              onPick={(choice) => setFurnitureEdit(docId, kind, choice)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One setting: its name and count, a segmented Keep / Hide / Delete, and
 *  the sample line. A radio group: Tab reaches the chosen segment, the
 *  arrow keys move the choice. With nothing found there is nothing to set. */
function Setting({
  name,
  found,
  current,
  locked,
  divided,
  onPick,
}: {
  name: string;
  found: Found;
  current: Choice;
  locked: boolean;
  divided: boolean;
  onPick: (choice: Choice) => void;
}) {
  const id = useId();
  const segments = useRef<(HTMLButtonElement | null)[]>([]);
  const off = locked || found.count === 0;

  const onKeyDown = (e: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step === undefined || off) return;
    e.preventDefault();
    const at = CHOICES.findIndex((c) => c.value === current);
    const next = (at + step + CHOICES.length) % CHOICES.length;
    onPick(CHOICES[next].value);
    segments.current[next]?.focus();
  };

  return (
    <div className={`px-3 py-2 ${divided ? "border-t border-edge" : ""}`}>
      <div className="flex items-baseline justify-between text-xs">
        <span id={id} className={found.count ? "text-ink" : "text-muted"}>
          {name}
        </span>
        <span className="tabular-nums text-faint">
          {found.count ? `${found.count} found` : "none found"}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={id}
        onKeyDown={onKeyDown}
        className="mt-1.5 grid grid-cols-3 gap-0.5 rounded-md border border-edge bg-ground p-0.5"
      >
        {CHOICES.map(({ value, title, Icon, lit }, i) => {
          const on = current === value;
          return (
            <button
              key={value}
              ref={(el) => {
                segments.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              disabled={off}
              onClick={() => onPick(value)}
              className={`flex h-7 items-center justify-center gap-1.5 rounded text-xs transition-colors
                disabled:cursor-default ${
                  on
                    ? `bg-raised text-ink ${lit} ${off ? "opacity-60" : ""}`
                    : "cursor-pointer text-muted enabled:hover:text-ink disabled:opacity-40"
                }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {title}
            </button>
          );
        })}
      </div>
      {found.sample && <Sample sample={found.sample} choice={current} />}
    </div>
  );
}

/** What the markdown holds for the first example under `choice`, in the
 *  mono face with its ligatures off: either face would otherwise join
 *  `<!--` and `-->` into arrows. */
function Sample({ sample, choice }: { sample: NonNullable<Found["sample"]>; choice: Choice }) {
  return (
    <p className="mt-1.5 flex min-w-0 items-baseline gap-2 font-mono text-[11px] text-faint [font-variant-ligatures:none]">
      {choice === "keep" && <span className="truncate text-muted">{sample.text}</span>}
      {choice === "hide" && <span className="truncate">{`<!-- ${sample.hidden} -->`}</span>}
      {choice === "delete" && (
        <>
          <span className="truncate text-muted line-through decoration-brand-lit decoration-2">
            {sample.text}
          </span>
          <span className="shrink-0 font-sans text-brand-lit/80">removed</span>
        </>
      )}
    </p>
  );
}
