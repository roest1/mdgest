import { EllipsisVertical } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { engine } from "src/lib/engine";
import { measure } from "src/lib/measure";
import { useEditor } from "src/lib/store";
import { markdownPath } from "src/lib/workspace";
import { human, plural } from "src/lib/words";
import { PropertiesDialog, type PropertyGroups } from "./PropertiesDialog";

const iconButton =
  "cursor-pointer rounded p-1 text-muted transition-colors enabled:hover:text-ink disabled:cursor-default disabled:opacity-40";

/** The markdown pane's three dots, where the PDF pane has its own: the
 *  markdown's Document properties, opened at once -- the pane has no other
 *  item to put beside it in a menu. */
export function MarkdownProperties({ docId }: { docId: string }) {
  const [open, setOpen] = useState(false);
  const reading = useEditor((s) => s.readings[docId]);
  const text = reading?.status === "ready" ? reading.markdown.text : null;

  return (
    <>
      <button
        type="button"
        title="Document properties"
        aria-haspopup="dialog"
        disabled={text === null}
        onClick={() => setOpen(true)}
        className={`${iconButton} ${open ? "text-ink" : ""}`}
      >
        <EllipsisVertical className="h-4 w-4" />
      </button>
      {open && text !== null && (
        <Properties docId={docId} text={text} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/** What the export writes for this document, measured: the markdown's text
 *  as it now stands, and the figures beside it, asked of the engine once
 *  the dialog opens. */
function Properties({ docId, text, onClose }: { docId: string; text: string; onClose: () => void }) {
  const m = useMemo(() => measure(text), [text]);
  const [media, setMedia] = useState<{ files: number; bytes: number } | "pending" | null>("pending");

  useEffect(() => {
    let live = true;
    engine
      .assetBytes(docId)
      .then((got) => live && setMedia(got))
      .catch(() => live && setMedia(null));
    return () => {
      live = false;
    };
  }, [docId]);

  const count = (n: number) => n.toLocaleString();
  const groups: PropertyGroups = [
    [
      ["File name", markdownPath(docId).at(-1)!],
      ["Lines", count(m.lines)],
      ["Comment lines", count(m.commentLines)],
      ["Tokens", `≈ ${count(m.tokens)}`],
    ],
    [
      [
        "Export size",
        media === "pending" ? "…" : media === null ? null : human(m.bytes + media.bytes),
      ],
      ["Text", human(m.bytes)],
      [
        "Media",
        media === "pending"
          ? "…"
          : media === null
            ? null
            : media.files === 0
              ? "none"
              : `${human(media.bytes)} (${plural(media.files, "figure")})`,
      ],
    ],
    [["Renders in", m.gfm.length ? `GFM, for ${m.gfm.join(", ")}` : "CommonMark"]],
  ];

  return <PropertiesDialog groups={groups} onClose={onClose} />;
}
