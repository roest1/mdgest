/** A page of the markdown as the tree the pane renders: parsed, made safe,
 *  and cut down to what rendering reads.
 *
 * The one place the markdown is parsed for the rendered view, wherever that
 * happens: on the page's thread for the first frame, in a worker for the
 * rest (`parse.ts`), and in the test that holds both to react-markdown's
 * HTML. Pure, and touches nothing but its argument, so it runs in either.
 *
 * What it does is what react-markdown did with `remarkPlugins={[remarkGfm]}`
 * up to the point of rendering, and no more: micromark with GFM, mdast to
 * hast with HTML kept as `raw`, then react-markdown's own pass over the
 * tree -- every URL a property carries made safe, and HTML written out as
 * the text it is. That pass is done here rather than before rendering, so
 * a tree is safe from the moment it exists, wherever it is kept. */

import type { Element, ElementContent, Root, RootContent } from "hast";
import { urlAttributes } from "html-url-attributes";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toHast as mdastToHast } from "mdast-util-to-hast";
import { gfm } from "micromark-extension-gfm";

/** The schemes a URL may name and be kept: react-markdown's. */
const SAFE_PROTOCOL = /^(https?|ircs?|mailto|xmpp)$/i;

/** A URL as react-markdown lets it through: kept when relative or of a
 *  safe scheme, emptied otherwise -- `javascript:` and `data:` among them.
 *  react-markdown's `defaultUrlTransform`, which it takes from micromark's
 *  `sanitizeUri` without the encoding; copied rather than imported so the
 *  worker does not load react-markdown, and React with it, for twenty lines.
 *  `hast.test.ts` holds the two to the same answers. */
export function safeUrl(value: string): string {
  const colon = value.indexOf(":");
  const questionMark = value.indexOf("?");
  const numberSign = value.indexOf("#");
  const slash = value.indexOf("/");
  if (
    // No scheme: relative.
    colon === -1 ||
    // A colon after a `/`, `?` or `#` does not end a scheme.
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    SAFE_PROTOCOL.test(value.slice(0, colon))
  )
    return value;
  return "";
}

/** Make `element`'s URL properties safe, as react-markdown does: each one
 *  `html-url-attributes` names for this tag. */
function safeProperties(element: Element): void {
  const { properties, tagName } = element;
  for (const [key, tags] of Object.entries(urlAttributes)) {
    if (!Object.hasOwn(properties, key)) continue;
    if (tags === null || tags.includes(tagName))
      properties[key] = safeUrl(String(properties[key] || ""));
  }
}

/** Walk `children` in place: HTML becomes its text, URLs are made safe,
 *  and each node keeps of its position only where an element starts and
 *  ends, by line and column -- what the pane marks a block by. The rest --
 *  every text node's, every offset -- was more than half of a book's tree,
 *  and is copied to the page and kept for nothing. */
function clean(children: (RootContent | ElementContent)[]): void {
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.type === "raw") {
      children[i] = { type: "text", value: node.value };
      continue;
    }
    if (node.type !== "element") {
      delete node.position;
      continue;
    }
    if (node.position) {
      const { start, end } = node.position;
      node.position = {
        start: { line: start.line, column: start.column },
        end: { line: end.line, column: end.column },
      };
    }
    safeProperties(node);
    clean(node.children);
  }
}

/** `text`, a page of the markdown, as the tree the pane renders. Its line 1
 *  is `text`'s first line. */
export function toHast(text: string): Root {
  const mdast = fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const tree = mdastToHast(mdast, { allowDangerousHtml: true }) as Root;
  delete tree.position;
  clean(tree.children);
  return tree;
}
