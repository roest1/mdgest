import { useEffect, useMemo, useState } from "react";
import { engine } from "src/lib/engine";
import type { Markdown } from "src/lib/emit";
import { measure } from "src/lib/measure";
import type { Piece } from "src/lib/pieces";
import { markdownPath } from "src/lib/workspace";
import { human, plural } from "src/lib/words";
import { PropertiesDialog, type PropertyGroups } from "./PropertiesDialog";

/** The markdown's Document properties: its text as it now stands,
 *  measured a page at a time as the pane renders it (`measure.ts`), and
 *  the figures beside it, asked of the engine once the dialog opens. */
export function MarkdownProperties({
  docId,
  markdown,
  pieces,
  onClose,
}: {
  docId: string;
  markdown: Markdown;
  /** The pane's pages of it, as `pieces()` cut them. */
  pieces: Piece[];
  onClose: () => void;
}) {
  const m = useMemo(
    () =>
      measure(
        markdown.text,
        pieces.map((p) => p.text),
      ),
    [markdown, pieces],
  );
  const [media, setMedia] = useState<
    { files: number; bytes: number } | "pending" | null
  >("pending");

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
        "Total size",
        media === "pending"
          ? "…"
          : media === null
            ? null
            : human(m.bytes + media.bytes),
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
    [
      [
        "Renders in",
        m.gfm.length ? `GFM, for ${m.gfm.join(", ")}` : "CommonMark",
      ],
    ],
  ];

  return <PropertiesDialog groups={groups} onClose={onClose} />;
}
