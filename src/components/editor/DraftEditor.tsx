import { AlertTriangle } from "lucide-react";
import { useEffect, useRef } from "react";
import type { WordChanges } from "src/lib/draft";

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

/** The words of `was` and `now`, each marked as kept, taken out or put
 *  in -- the longest run of words the two share kept, the rest shown as
 *  the change. */
function wordDiff(was: string, now: string): { word: string; kind: "same" | "out" | "in" }[] {
  const a = was.split(/\s+/).filter(Boolean);
  const b = now.split(/\s+/).filter(Boolean);
  const lcs = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: { word: string; kind: "same" | "out" | "in" }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ word: a[i++], kind: "same" });
      j++;
    } else if (j < b.length && (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      out.push({ word: b[j++], kind: "in" });
    } else out.push({ word: a[i++], kind: "out" });
  }
  return out;
}

/** Where a block is, as the page's notes say it: `p3 · 5`. */
const place = (page: number, n: number) => (n ? `p${page} · ${n}` : `p${page}`);

/** Shown before a draft that changes words is applied: every block whose
 *  words it corrects, word by word; every block it deletes; and the text
 *  it inserts, which the page cannot vouch for. A draft that only reshapes,
 *  joins or divides changes no word and is applied without it. Keep
 *  editing has the focus, so an Enter goes back to the draft. */
export function ReviewDialog({
  changes,
  onApply,
  onClose,
}: {
  changes: WordChanges;
  onApply: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  // `showModal` focuses the first button, not React's `autoFocus` one, so
  // the safe choice is focused after it opens.
  useEffect(() => {
    dialog.current?.showModal();
    keep.current?.focus();
  }, []);
  const { corrected, deleted, inserted } = changes;
  const heading = "mb-1.5 mt-4 text-xs font-medium uppercase tracking-wider text-faint";
  const box = "max-h-44 overflow-auto rounded-lg border border-edge bg-ground p-2 text-sm";

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
      aria-labelledby="review-title"
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-2xl border border-edge bg-raised p-0 text-ink shadow-2xl shadow-black/60 backdrop:bg-black/60"
    >
      <div className="px-6 pb-5 pt-5">
        <h2 id="review-title" className="flex items-center gap-2 text-base font-medium">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          Check the words you changed
        </h2>
        <p className="mt-2 text-sm text-muted">
          These change what the page says. Corrections and inserted text are marked as yours; deleted
          blocks stay on the page, struck through, to restore.
        </p>

        {corrected.length > 0 && (
          <>
            <h3 className={heading}>Corrected · {corrected.length}</h3>
            <ul className={`${box} space-y-1.5`}>
              {corrected.map((c) => (
                <li key={c.id} className="flex gap-2">
                  <span className="shrink-0 font-mono text-[11px] leading-5 text-faint">{place(c.page, c.n)}</span>
                  <span className="min-w-0">
                    {wordDiff(c.was, c.now).map((w, i) => (
                      <span
                        key={i}
                        className={
                          w.kind === "out"
                            ? "text-red-300 line-through decoration-red-300/70"
                            : w.kind === "in"
                              ? "rounded bg-emerald-500/15 px-0.5 text-emerald-200"
                              : "text-muted"
                        }
                      >
                        {w.word}{" "}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {deleted.length > 0 && (
          <>
            <h3 className={heading}>Deleted · {deleted.length}</h3>
            <ul className={`${box} space-y-1`}>
              {deleted.map((d) => (
                <li key={d.id} className="flex gap-2">
                  <span className="shrink-0 font-mono text-[11px] leading-5 text-faint">{place(d.page, d.n)}</span>
                  <span className="min-w-0 text-red-300/90 line-through decoration-red-300/60">{d.was}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {inserted.length > 0 && (
          <>
            <h3 className={heading}>Inserted, not in the PDF · {inserted.length}</h3>
            <pre className={`${box} whitespace-pre-wrap font-mono text-[11px] text-pink-200/90 [font-variant-ligatures:none]`}>
              {inserted.join("\n\n")}
            </pre>
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              onApply();
              dialog.current?.close();
            }}
            className="cursor-pointer rounded-full px-4 py-2 text-sm text-ink transition-colors hover:bg-ink/10"
          >
            Apply
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
