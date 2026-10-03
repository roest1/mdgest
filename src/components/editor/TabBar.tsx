import { FileText, X } from "lucide-react";
import { Marquee } from "src/components/shared/Marquee";

export function TabBar({
  docs,
  active,
  onSelect,
  onClose,
}: {
  docs: string[];
  /** The document whose tab is drawn selected. */
  active?: string;
  onSelect: (doc: string) => void;
  onClose: (doc: string) => void;
}) {
  if (docs.length === 0) return null;
  return (
    <div
      role="tablist"
      aria-label="Open documents"
      className="flex h-9 shrink-0 items-end gap-px overflow-x-auto border-b border-edge bg-chrome px-1.5"
    >
      {docs.map((doc) => {
        const name = doc.split("/").pop() ?? doc;
        const isActive = doc === active;
        return (
          // The close button sits beside the name, not inside it, since a
          // button cannot hold another -- the same shape as a tree row.
          <div
            key={doc}
            role="tab"
            aria-selected={isActive}
            title={doc}
            className={`group flex h-[30px] max-w-[200px] min-w-0 shrink-0 items-center gap-1.5
              rounded-t-md border border-b-0 py-1 pr-1.5 pl-2.5 font-mono text-xs
              ${
                isActive
                  ? "border-edge-strong bg-raised text-ink"
                  : "border-edge-strong text-muted hover:bg-raised/40 hover:text-ink"
              }`}
          >
            <button
              type="button"
              onClick={() => onSelect(doc)}
              className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
            >
              <FileText
                className="h-3.5 w-3.5 shrink-0 text-brand-lit/80"
                aria-hidden
              />
              <Marquee text={name} className="min-w-0 flex-1" />
            </button>
            <button
              type="button"
              onClick={() => onClose(doc)}
              title={`Close ${name}`}
              aria-label={`Close ${name}`}
              className={`shrink-0 cursor-pointer rounded p-0.5 text-faint transition-opacity
                hover:bg-raised hover:text-ink focus-visible:opacity-100
                ${isActive ? "" : "opacity-0 group-hover:opacity-100"}`}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
