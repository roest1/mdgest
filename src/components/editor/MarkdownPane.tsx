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
import { useEditor, type Reading } from "src/lib/store";
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
 *  alt text alone. Shown at the size it is printed, a point a point -- not
 *  its pixels, which `read.ts` draws at twice that or more -- and held at
 *  that size while its pixels are read, so the pane does not jump as each
 *  one arrives. */
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
  // CSS's px is 3/4 of a point.
  const sizes = new Map<string, { width: number; height: number }>();
  for (const page of analysis.pages)
    for (const pic of page.pictures)
      sizes.set(pic.path, {
        width: Math.round((pic.box.w * 4) / 3),
        height: Math.round((pic.box.h * 4) / 3),
      });
  return function Figure({
    node: _node,
    src,
    alt,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & ExtraProps) {
    const path = typeof src === "string" ? decoded(src) : "";
    const name = path.startsWith(prefix) ? path.slice(prefix.length) : "";
    const url = useAssetUrl(docId, name);
    const size = sizes.get(name);
    if (!name || url === null)
      return <span className="text-faint">[{alt}]</span>;
    if (url === undefined)
      return (
        <span
          className="figure-wait"
          aria-hidden
          style={
            size && {
              width: size.width,
              aspectRatio: `${size.width} / ${size.height}`,
            }
          }
        />
      );
    return <img {...props} src={url} alt={alt} {...size} />;
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
 *  markdown alone; a blank line is empty, and its number gives it its
 *  height. The look is `.source` in index.css. */
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
          {line.text}
        </li>
      ))}
    </ol>
  );
}

// ---- the pane -------------------------------------------------------------

/** What the pane says while a reading goes. `page` is how many pages are
 *  done, so the one being read is the next; with all done, what is left is
 *  writing it down. Nothing about pages before the first is done, which is
 *  also all a reading from the cache ever shows. */
function progress(reading: Reading | undefined): string {
  if (!reading || reading.status !== "reading" || reading.page === 0)
    return "Reading…";
  if (reading.page >= reading.pages) return "Writing the markdown…";
  return `Reading page ${reading.page + 1} of ${reading.pages}…`;
}

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
            {progress(reading)}
          </p>
        )}
      </div>
    </Pane>
  );
}
