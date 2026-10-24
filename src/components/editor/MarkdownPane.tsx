import { SquarePen } from "lucide-react";
import { useState } from "react";
import { barButton } from "./controls";
import { MoreMenu } from "./MoreMenu";
import { Pane } from "./Pane";

/** How the markdown is shown: as it reads, or as its source. */
type View = "rendered" | "raw";

function ViewToggle({
  view,
  onView,
}: {
  view: View;
  onView: (view: View) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Markdown view"
      className="flex rounded-md border border-edge bg-raised/40 p-0.5"
    >
      {(["rendered", "raw"] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          onClick={() => onView(v)}
          className={`cursor-pointer rounded px-2.5 py-0.5 text-xs transition-colors ${
            view === v ? "bg-raised text-ink" : "text-muted hover:text-ink"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

export function MarkdownPane({ docId: _docId }: { docId: string }) {
  const [view, setView] = useState<View>("rendered");

  return (
    <Pane
      left={
        // TODO: the editor's store, once ported: edit opens the markdown as
        // a draft, and a document marked done disables it.
        <button
          type="button"
          title="Edit the markdown as text; it becomes edits when you apply"
          className={barButton()}
        >
          <SquarePen className="h-4 w-4" />
          edit
        </button>
      }
      center={<ViewToggle view={view} onView={setView} />}
      right={
        <MoreMenu
          // TODO: PropertiesDialog, once ported.
          items={[{ label: "Document properties", disabled: true }]}
        />
      }
    />
  );
}
