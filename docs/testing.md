# Testing

```sh
bun run test          # everything, once, in headless Chromium
bun run test:watch    # re-run on save
bun run fixtures      # write every reader case to tests/out/ as a PDF
```

The tests run in a real browser because the reader needs one: `read.ts` draws
figures into a canvas, pdf.js parses in a worker, and OPFS's file handles exist
only in a worker. Playwright's Chromium does the running; on a fresh machine or
in CI, `bunx playwright install chromium` first. All of it is dev dependencies
— nothing under `tests/` is imported from `src/`, so none of it reaches a build.

## What is tested

What this code decides, not what the language or the browser guarantees. The
reader is almost all decisions — every threshold in [pipeline.md](pipeline.md)
is a guess about how a page is read — so most cases sit a known distance either
side of one: a gap of 9.8pt and one of 10.8pt around the 10.12pt that ends a
paragraph, indents 3pt and 4pt apart around the 3pt that folds them.

| file | covers |
| --- | --- |
| `tests/cases/headings.ts` | heading size threshold, levels, the h4 cap, bold at body size, bold as the body face, the length limit, wrapped headings |
| `tests/cases/lists.ts` | bullet glyphs and dash forms, numbered, lettered and roman items, lookalikes that are not items, markers in a run of their own, nesting depth, wrapped items, detail lines, numbering restarts |
| `tests/cases/blocks.ts` | where a paragraph ends — gap, size, weight, indent — columns, runs joined into lines, spaces against kerning |
| `tests/cases/style.ts` | whole-block bold and italic, partial emphasis, escaping |
| `tests/cases/links.ts` | linked blocks, partly linked blocks, unsafe URL characters |
| `tests/cases/pictures.ts` | figure size thresholds, placement before a caption or label |
| `tests/cases/pages.ts` | the rule between pages, lists across a page break |
| `tests/opfs.test.ts` | truncating writes, missing files, the document listing, what `removeDerived` may touch, bad ids |

## Adding a reader case

A case is pages drawn with exact positions, sizes and faces
(`tests/fixtures/pdf.ts`), and what they should read as — the blocks in brief,
and optionally the whole markdown:

```ts
{
  name: "lists-indent-tolerance",
  about: "Indents within 3pt are one level (72 and 75); 4pt further in is a level deeper (76).",
  pages: [(pen) => [X, X + 3, X, X + 4].forEach((x, i) => pen.text(x, TOP + i * LEADING, `• ${ITEMS[i]}`))],
  blocks: [`bullet • ${ITEMS[0]}`, `bullet • ${ITEMS[1]}`, `bullet • ${ITEMS[2]}`, `  bullet • ${ITEMS[3]}`],
}
```

Write the expectation from what a person reading the page would say, not from
what the reader prints today. Where the two differ, set `known` to why: the
test is then marked as an expected failure, the suite stays green, and when the
reader is fixed the test fails until `known` is removed. The known gaps today:

- a lettered list's `i.` is read as the numeral one (`lists-lettered-past-h`)
- ZapfDingbats bullets are read as letters (`lists-dingbat-bullets`)
- paragraphs marked only by an indented first line run together (`blocks-first-line-indent`)
- two columns between a full-width title and footer are read across (`blocks-two-columns-under-a-title`)

Document-wide decisions — the body size, whether bold means anything, heading
levels — are made over the whole PDF, which is why each case is its own file
rather than one page of a single test document.
