/** What a markdown file is, for the markdown pane's Document properties: how
 *  long it is, how much of it is HTML comments, and whether CommonMark
 *  renders all of it or some of it needs GitHub Flavored Markdown.
 *
 * Read off the text, so it holds for whatever the file has become -- text a
 * person inserted is written as typed, and can carry a table the emitter
 * never writes. Parsed with the same micromark that renders the pane, with
 * GFM on, and every GFM construct found is named. */

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export interface Measure {
  lines: number;
  /** UTF-8, as the file is written. */
  bytes: number;
  /** About four characters a token, which is how English text runs through
   *  the common tokenizers; any one model's count differs. */
  tokens: number;
  /** Lines with an HTML comment on them: a hidden block, or one a person
   *  wrote. Gone from a rendered view, there for anything that reads the
   *  file as text. */
  commentLines: number;
  /** The GFM constructs in the file, by name, in the order first met. None
   *  is a file CommonMark renders whole. */
  gfm: string[];
}

interface Node {
  type: string;
  value?: string;
  checked?: boolean | null;
  children?: Node[];
  position?: { start: { line: number; offset?: number }; end: { line: number } };
}

/** The GFM node types, by the name each is shown under. A link is GFM only
 *  when it is a bare URL: `[text](url)` and `<url>` are CommonMark, so its
 *  first character in the source says which it is. */
function gfmName(node: Node, text: string): string | null {
  switch (node.type) {
    case "table":
      return "tables";
    case "delete":
      return "strikethrough";
    case "footnoteDefinition":
    case "footnoteReference":
      return "footnotes";
    case "listItem":
      return typeof node.checked === "boolean" ? "task lists" : null;
    case "link": {
      const at = node.position?.start.offset;
      return at !== undefined && text[at] !== "[" && text[at] !== "<" ? "bare links" : null;
    }
    default:
      return null;
  }
}

export function measure(text: string): Measure {
  const tree = fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as Node;
  const commented = new Set<number>();
  const found = new Set<string>();
  const visit = (node: Node) => {
    const name = gfmName(node, text);
    if (name) found.add(name);
    if (node.type === "html" && node.value?.startsWith("<!--") && node.position) {
      const { start, end } = node.position;
      for (let line = start.line; line <= end.line; line++) commented.add(line);
    }
    node.children?.forEach(visit);
  };
  visit(tree);

  const breaks = text.split("\n").length - 1;
  return {
    lines: text === "" ? 0 : text.endsWith("\n") ? breaks : breaks + 1,
    bytes: new TextEncoder().encode(text).byteLength,
    tokens: Math.round(text.length / 4),
    commentLines: commented.size,
    gfm: [...found],
  };
}
