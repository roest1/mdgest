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

What this code decides, not what the language or the browser guarantees.

### The reader

`tests/reader.test.ts` runs every case through the app's own path — pdf.js
opens the fixture, `readPage` reads each page, `structure` makes the blocks,
`emit` writes the markdown — and asserts that the installed pdf.js is the
version `READER` was made with (*When the reader changes*, in the README).

The reader is almost all decisions — every threshold in
[pipeline.md](pipeline.md) is a guess about how a page is read — so most cases
sit a known distance either side of one: a gap of 9.8pt and one of 10.8pt
around the 10.12pt that ends a paragraph, indents 3pt and 4pt apart around the
3pt that folds them.

| file | covers |
| --- | --- |
| `tests/cases/headings.ts` | heading size threshold, levels, the h4 cap, bold at body size, bold as the body face, the length limit, wrapped headings |
| `tests/cases/lists.ts` | bullet glyphs and dash forms, numbered, lettered and roman items, lookalikes that are not items, markers in a run of their own, nesting depth, wrapped items, detail lines, numbering restarts |
| `tests/cases/blocks.ts` | where a paragraph ends — gap, size, weight, indent — columns, runs joined into lines, spaces against kerning |
| `tests/cases/style.ts` | whole-block bold and italic, partial emphasis, escaping |
| `tests/cases/links.ts` | linked blocks, partly linked blocks, unsafe URL characters |
| `tests/cases/pictures.ts` | figure size thresholds, placement before a caption or label |
| `tests/cases/pages.ts` | the rule between pages, lists across a page break |

### Editing

Every edit is a decision about what a person meant, which is what these cover:

| file | covers |
| --- | --- |
| `tests/edits.test.ts` | emitting a hidden block as a comment and a deleted one as nothing, numbers kept and given up, hide and delete as one choice, `edits.json` version 1 read as a hide, unjoin taking a correction with it, `checkEdits` dropping an undo step that cannot be put back |
| `tests/source.test.ts` | one line of raw markdown read back onto its block: markup changing the shape, changed words as a correction, a comment hiding it, and the new lines that divide it |
| `tests/draft.test.ts` | a whole-markdown draft applied: `editDistance` and `diffLines`, lines paired with blocks by their words rather than their place, corrections against inserted text, deletes, joins, divides, text written around the rule between pages, and one undo step per apply |
| `tests/divide.test.ts` | words and the cut positions between them, a piece that opens with a marker becoming that kind of item, pieces as their own numbered blocks, join making a divided block whole again, cuts that are refused |
| `tests/furniture.test.ts` | `label` on what a margin line prints — `12`, `iv`, `Page 12`, `12 of 40`, and the numerals that are words — then the page-number and header/footer settings: keep, hide, delete, a block decided by hand, and undo one setting at a time |

### The workspace

| file | covers |
| --- | --- |
| `tests/opfs.test.ts` | truncating writes, missing files, removing what is not there, `walk`'s order, `sha256`, the document listing, what `removeDerived` may touch, ids that are not ids, clearing the workspace |
| `tests/stage.test.ts` | staging a workspace folder: its PDFs found under `sources/`, and what it says when one sits outside |
| `tests/assets.test.ts` | a figure's handle let go when it is replaced and when its document leaves, and a read still out when the document is let go |
| `tests/store.test.ts` | the store under a document named `__proto__` — a reading, a draft, a done mark and a reread like any other — and a document nobody has read |
| `tests/words.test.ts` | `few` and `plural`, the counting the UI phrases with |

### The fixtures under them

Not tests, and nothing asserts about them directly:

| file | what it is |
| --- | --- |
| `tests/fixtures/pdf.ts` | the pen: pages drawn at exact positions, sizes and faces |
| `tests/fixtures/png.ts` | images to paint into a page |
| `tests/fixtures/write.ts` | writing a case out to `tests/out/`, for `bun run fixtures` |
| `tests/cases/case.ts` | the `Case` type and `summarize`, which puts an analysis in the brief form a case is written in |
| `tests/cases/index.ts` | every case file, by what it covers — a new default gets a file and an entry here |
| `tests/cases/text.ts` | the prose, margins and leading the cases set, each line with a capital and a descender so every ink box is the same height |
| `tests/opfs.worker.ts` | `opfs.ts` where it runs in the app, since a synchronous file handle exists only in a worker |
| `tests/stage.worker.ts` | `stage.ts` in a worker over a real OPFS, with the file layer beside it for emptying between tests |

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
