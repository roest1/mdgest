import { AlertTriangle } from "lucide-react";
import { useEffect, useRef } from "react";

/** The whole markdown open as one text: written freely, applied when done
 *  (`draft.ts`). Problems that hold it back are listed above it, each with
 *  its line; a click puts the caret there. */
export function DraftEditor({
  text,
  problems,
  onChange,
}: {
  text: string;
  problems: { line: number; problem: string }[];
  onChange: (text: string) => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), []);

  const goTo = (line: number) => {
    const el = area.current;
    if (!el) return;
    const at = el.value.split("\n").slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0);
    el.focus();
    el.setSelectionRange(at, at);
    // Bring the line into view: its share of the text's height.
    const lines = el.value.split("\n").length;
    el.scrollTop = Math.max(0, ((line - 1) / lines) * el.scrollHeight - el.clientHeight / 3);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {problems.length > 0 && (
        <ul className="max-h-32 shrink-0 overflow-auto border-b border-red-500/30 bg-red-500/10 px-4 py-1.5 text-xs text-red-200">
          {problems.map((p, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => goTo(p.line)}
                className="cursor-pointer text-left hover:underline"
              >
                <span className="font-mono text-red-300">line {p.line}</span> · {p.problem}
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={area}
        value={text}
        spellCheck={false}
        aria-label="The markdown, as text"
        onChange={(e) => onChange(e.target.value)}
        className="min-h-0 flex-1 resize-none bg-ground px-4 py-2 font-mono text-[12.5px] leading-[1.55] text-ink outline-none [font-variant-ligatures:none]"
      />
    </div>
  );
}

/** Asked before a draft's new words go in: text the page cannot vouch for,
 *  marked as a person's. Corrections are not listed -- they stand on the
 *  block they correct, which shows it. Keep editing has the focus. */
export function InsertDialog({
  inserted,
  onApply,
  onClose,
}: {
  inserted: string[];
  onApply: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  // `showModal` focuses the first button, not React's `autoFocus` one, so
  // the safe choice is focused after it opens: an Enter keeps editing.
  useEffect(() => {
    dialog.current?.showModal();
    keep.current?.focus();
  }, []);
  const shown = inserted.join("\n\n");

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
      aria-labelledby="insert-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-edge bg-raised p-0 text-ink shadow-2xl shadow-black/60 backdrop:bg-black/60"
    >
      <div className="px-6 pb-5 pt-5">
        <h2 id="insert-title" className="mb-3 flex items-center gap-2 text-base font-medium">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          Text that is not in the PDF
        </h2>
        <p className="text-sm text-muted">
          {inserted.length === 1 ? "This is" : `These ${inserted.length} are`} new to the markdown, with no
          words on the page behind {inserted.length === 1 ? "it" : "them"}. Inserted text is kept apart from
          the page's and marked as yours.
        </p>
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-edge bg-ground p-3 font-mono text-[11px] text-pink-200/90 [font-variant-ligatures:none]">
          {shown}
        </pre>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              onApply();
              dialog.current?.close();
            }}
            className="cursor-pointer rounded-full px-4 py-2 text-sm text-ink transition-colors hover:bg-ink/10"
          >
            Insert it
          </button>
          <button
            type="button"
            ref={keep}
            onClick={() => dialog.current?.close()}
            className="cursor-pointer rounded-full bg-accent-lit/25 px-5 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent-lit/35"
          >
            Keep editing
          </button>
        </div>
      </div>
    </dialog>
  );
}
