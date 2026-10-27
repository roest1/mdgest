import { SquarePen } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import ReactMarkdown, {
  type Components,
  type ExtraProps,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import { Spinner } from "src/components/shared/Spinner";
import type { Analysis } from "src/lib/analysis";
import { useAssetUrl } from "src/lib/assets";
import type { Markdown } from "src/lib/emit";
import { useEditor } from "src/lib/store";
import { assetsPrefix } from "src/lib/workspace";
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

// ---- rendered -------------------------------------------------------------

/** The <img> for `docId`'s markdown: a figure, by the path the markdown
 *  gives it. A path under the document's own assets folder is one the
 *  workspace holds; anything else the markdown could say is shown as its
 *  alt text alone. The size comes from the analysis, so the pane lays out
 *  at its final height before the pixels arrive. */
function figureFor(docId: string, analysis: Analysis): Components["img"] {
  const prefix = assetsPrefix(docId);
  /** The path as the workspace names it: the markdown writes it
   *  percent-encoded (`emit.ts`), and the parser hands it over so. */
  const decoded = (src: string) => {
    try {
      return decodeURIComponent(src);
    } catch {
      return src;
    }
  };
  const sizes = new Map<string, [number, number]>();
  for (const page of analysis.pages)
    for (const pic of page.pictures) sizes.set(pic.path, pic.px);
  return function Figure({
    node: _node,
    src,
    alt,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & ExtraProps) {
    const path = typeof src === "string" ? decoded(src) : "";
    const name = path.startsWith(prefix) ? path.slice(prefix.length) : "";
    const url = useAssetUrl(docId, name);
    const px = sizes.get(name);
    if (!url) return <span className="text-faint">[{alt}]</span>;
    return (
      <img {...props} src={url} alt={alt} width={px?.[0]} height={px?.[1]} />
    );
  };
}

/** The document as a reader would see it. react-markdown writes no raw HTML
 *  through, so what a PDF's text happens to contain stays text. The look
 *  is `.markdown` in index.css. */
function Rendered({
  docId,
  analysis,
  markdown,
}: {
  docId: string;
  analysis: Analysis;
  markdown: Markdown;
}) {
  const components = useMemo(
    () => ({ img: figureFor(docId, analysis) }),
    [docId, analysis],
  );
  return (
    <article className="markdown mx-auto max-w-[72ch] px-8 pt-6 pb-24">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown.text}
      </ReactMarkdown>
    </article>
  );
}

// ---- raw ------------------------------------------------------------------

/** What a line of source is, for the gutter's tinting. Coarse on purpose:
 *  the source view is for checking the markdown, not highlighting it. */
type Kind = "heading" | "rule" | "image" | "text";

function kindOf(line: string): Kind {
  if (/^#{1,6}\s/.test(line)) return "heading";
  if (/^(---+|```)\s*$/.test(line)) return "rule";
  if (line.startsWith("![")) return "image";
  return "text";
}

/** The markdown characters, one row a line, numbered in the gutter. The
 *  numbers are CSS counters rather than text, so a copy of the view is the
 *  markdown alone. A blank line holds a space: with `pre-wrap` that is what
 *  gives an empty row its height. The look is `.source` in index.css. */
function Raw({ markdown }: { markdown: Markdown }) {
  return (
    <ol
      className="source pt-2 pb-24"
      style={
        { "--digits": String(markdown.lines.length).length } as CSSProperties
      }
    >
      {markdown.lines.map((line, i) => (
        <li key={i} data-kind={kindOf(line.text)}>
          {line.text || " "}
        </li>
      ))}
    </ol>
  );
}

// ---- the pane -------------------------------------------------------------

export function MarkdownPane({ docId }: { docId: string }) {
  const [view, setView] = useState<View>("rendered");
  const reading = useEditor((s) => s.readings[docId]);

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
    >
      <div className="h-full overflow-y-auto">
        {reading?.status === "ready" ? (
          view === "rendered" ? (
            <Rendered
              docId={docId}
              analysis={reading.analysis}
              markdown={reading.markdown}
            />
          ) : (
            <Raw markdown={reading.markdown} />
          )
        ) : reading?.status === "failed" ? (
          <p className="p-6 text-center text-sm text-red-300">
            {reading.problem}
          </p>
        ) : (
          <p
            role="status"
            className="flex items-center justify-center gap-2 p-6 text-sm text-muted"
          >
            <Spinner />
            {reading && reading.page > 0
              ? `Reading page ${reading.page} of ${reading.pages}…`
              : "Reading…"}
          </p>
        )}
      </div>
    </Pane>
  );
}
