import { Image, Tag, Type, X } from "lucide-react";
import { useMemo } from "react";
import type { Placed } from "src/lib/emit";
import { useEditor } from "src/lib/store";

/** The bar under both panes: what is selected on the left, the tools for
 *  it in the middle, and on the right what the page shows regardless of a
 *  selection -- the boxes and the indices. Docked, so every button stays
 *  where the hand learned it.
 *
 * The block tools are not here: they float over the panes while there is a
 * selection (`FloatingToolbar`). */
export function Toolbar({ docId }: { docId: string }) {
  const boxes = useEditor((s) => s.boxes);
  const setBoxes = useEditor((s) => s.setBoxes);
  const notes = useEditor((s) => s.notes);
  const setNotes = useEditor((s) => s.setNotes);
  const touring = useEditor((s) => s.tour !== null);
  const unsaved = useEditor((s) => {
    const reading = s.readings[docId];
    return reading?.status === "ready" ? reading.unsaved : undefined;
  });

  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-t border-edge bg-chrome px-3 text-xs text-muted">
      <SelectionChip docId={docId} />

      {/* An edit that did not reach the workspace is said here, where it
          stays until a save goes through. While the walkthrough runs, the
          one thing it needs said in plain type: the way out. */}
      <div className="flex min-w-0 flex-1 items-center justify-center">
        {unsaved ? (
          <span className="truncate text-red-300" title={unsaved}>
            {unsaved}
          </span>
        ) : touring && (
          <span className="flex items-center gap-1.5 text-faint">
            <kbd className="rounded border border-edge bg-raised/60 px-1.5 py-0.5 font-mono text-[10px] text-muted">
              Esc
            </kbd>
            exits the tour
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="mr-1 text-faint">border boxes</span>
        <span data-tour="boxes-text">
          <Toggle
            on={boxes.text}
            title={boxes.text ? "Hide the boxes around text" : "Box the text"}
            onChange={(text) => setBoxes({ text })}
          >
            <Type className="h-3.5 w-3.5" />
            text
          </Toggle>
        </span>
        <span data-tour="boxes-images">
          <Toggle
            on={boxes.images}
            title={boxes.images ? "Hide the boxes around images" : "Box the images"}
            onChange={(images) => setBoxes({ images })}
          >
            <Image className="h-3.5 w-3.5" />
            images
          </Toggle>
        </span>
      </div>

      <span data-tour="indices">
        <Toggle
          on={notes}
          title={notes ? "Hide the block indices" : "Show the block indices"}
          onChange={setNotes}
        >
          <Tag className="h-3.5 w-3.5" />
          indices
        </Toggle>
      </span>
    </div>
  );
}

const iconButton = "cursor-pointer rounded p-1 text-muted transition-colors hover:text-ink";

/** A button that is on or off, in the style of the markdown pane's view
 *  toggle: lit when on, quiet when off. */
function Toggle({
  on,
  title,
  onChange,
  children,
}: {
  on: boolean;
  title: string;
  onChange: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={title}
      onClick={() => onChange(!on)}
      className={`flex cursor-pointer items-center gap-1.5 rounded-md border border-edge px-2 py-1 transition-colors ${
        on ? "bg-raised text-ink" : "bg-raised/40 text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** Runs of consecutive indices as they are read: `5–9, 12`. */
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

/** What is selected, by page and index, with the block's id when it is
 *  one block -- the id is what `edits.json` will key to, and what a person
 *  quotes when something reads wrong. A cross clears the selection. */
function SelectionChip({ docId }: { docId: string }) {
  const selection = useEditor((s) => s.selection);
  const reading = useEditor((s) => s.readings[docId]);
  const deselect = useEditor((s) => s.deselect);

  const placed = useMemo(() => {
    if (!selection || selection.docId !== docId || reading?.status !== "ready") return [];
    return selection.ids
      .map((id) => reading.markdown.blocks[id])
      .filter((p): p is Placed => p !== undefined);
  }, [selection, docId, reading]);

  if (placed.length === 0) {
    return <span className="text-faint">Click a block on the page to select it</span>;
  }

  const byPage = new Map<number, number[]>();
  for (const p of placed) byPage.set(p.page, [...(byPage.get(p.page) ?? []), p.n]);
  const where = [...byPage]
    .map(([page, ns]) => `p${page} · ${runs(ns.sort((a, b) => a - b))}`)
    .join("  ");

  return (
    <span className="flex items-center gap-2 font-mono text-ink" data-tour="selection">
      <span className="tabular-nums">{where}</span>
      {placed.length === 1 ? (
        <span className="text-faint">{placed[0].id}</span>
      ) : (
        <span className="text-faint">{placed.length} blocks</span>
      )}
      <button
        type="button"
        title="Clear selection (Esc)"
        onClick={deselect}
        className={iconButton}
        data-tour="clear"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
