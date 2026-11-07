/** The markdown drawn a page at a time is the markdown drawn whole: every
 *  reader case, read the app's way, rendered in one piece and page by page
 *  to the same HTML -- the blocks each element is marked with included.
 *  As read, and again with a block hidden and one deleted on every page:
 *  a comment indented into a list, or opening a page, parts the same way. */

import { createElement, type HTMLAttributes } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown, {
  type Components,
  type ExtraProps,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, test } from "vitest";
import type { Analysis } from "src/lib/analysis";
import { blankEdits, type BlockEdit, type Edits } from "src/lib/edits";
import { emit, type Markdown, type SourceLine } from "src/lib/emit";
import { openPdf } from "src/lib/pdf";
import { pieces } from "src/lib/pieces";
import { readPage } from "src/lib/read";
import { structure, type ReadPage } from "src/lib/structure";
import { cases } from "./cases";
import { buildPdf } from "./fixtures/pdf";

async function read(bytes: Uint8Array<ArrayBuffer>) {
  const task = openPdf(bytes);
  const pdf = await task.promise;
  try {
    const pages: ReadPage[] = [];
    for (let n = 1; n <= pdf.numPages; n++)
      pages.push((await readPage(await pdf.getPage(n))).page);
    return structure(pages);
  } finally {
    await task.destroy();
  }
}

const TAGS = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li"] as const;

/** Elements marked with the block their line was written by, as the pane
 *  marks them, `lines` being what the parser's line 1 is the first of. */
function marking(lines: SourceLine[]): Components {
  return Object.fromEntries(
    TAGS.map((tag) => [
      tag,
      ({ node, ...props }: HTMLAttributes<HTMLElement> & ExtraProps) =>
        createElement(tag, {
          ...props,
          "data-block":
            lines[(node?.position?.start.line ?? 0) - 1]?.block ?? undefined,
        }),
    ]),
  );
}

const html = (text: string, lines: SourceLine[]) =>
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkGfm], components: marking(lines) },
      text,
    ),
  );

/** The second block of every page hidden and the third deleted, where a
 *  page has them. */
function hideAndDelete(analysis: Analysis): Edits {
  const blocks: Record<string, BlockEdit> = {};
  for (const page of analysis.pages) {
    const [, second, third] = page.blocks;
    if (second) blocks[second.id] = { hidden: true };
    if (third) blocks[third.id] = { deleted: true };
  }
  return { ...blankEdits(), blocks };
}

function drawsTheSame(markdown: Markdown) {
  const parts = pieces(markdown);
  expect(parts.map((p) => p.text).join("")).toBe(markdown.text);
  const whole = html(markdown.text, markdown.lines);
  // Joined by the newline the whole puts between any two of its blocks:
  // where one page ends and the next begins, nothing else.
  expect(parts.map((p) => html(p.text, p.lines)).join("\n")).toBe(whole);
}

for (const [group, list] of Object.entries(cases)) {
  describe(group, () => {
    for (const c of list) {
      test(c.name, async () => {
        const analysis = await read(await buildPdf(c.pages));
        drawsTheSame(emit(analysis, "doc.assets/"));
        drawsTheSame(emit(analysis, "doc.assets/", hideAndDelete(analysis)));
      });
    }
  });
}
