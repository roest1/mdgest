# Testing

```sh
bun run test          # everything, once, in headless Chromium
bun run test:watch    # re-run on save
bun run fixtures      # write every reader case to tests/out/ as a PDF
```

The tests run in a real browser because the reader needs one: `read.ts` draws
figures into a canvas, pdf.js parses in a worker, and OPFS's file handles exist
only in a worker. Playwright's Chromium does the running; on a fresh machine or
in CI, `bunx playwright install --with-deps chromium` first. Nothing under
`tests/` is imported from `src/`, so none of it reaches a build.

## What is tested

What this code decides, not what the language or the browser guarantees.

**The reader.** `reader.test.ts` runs every case through the app's own path —
pdf.js opens the fixture, `readPage` reads each page, `structure` makes the
blocks, `emit` writes the markdown — and asserts that the installed pdf.js is
the version `READER` was made with (`src/lib/analysis.ts`).

The reader is almost all decisions — every threshold in `read.ts` and
`structure.ts` is a guess about how a page is read — so most cases sit a known
distance either side of one. The cases live in `cases/`, one file per area its
name says: headings, lists, blocks, style, links, pictures, pages.

`analysis.test.ts` covers the gate on a stored read: what `parseAnalysis`
refuses, and that it refuses under the one name that tells the page to read
the document again rather than leave a person a file they cannot fix.

**Editing.** Every edit is a decision about what a person meant.
`edits.test.ts` covers hide, delete, and the numbering blocks keep or give up;
`source.test.ts`, one line of raw markdown read back onto its block;
`draft.test.ts`, a whole-markdown draft paired with blocks by their words
rather than their place; `divide.test.ts`, cuts, the pieces they make, and
join putting a divided block back; `furniture.test.ts`, the page-number and
header/footer settings and their undo. What each file asserts in full is its
own `it` names.

**The workspace.** `opfs.test.ts` covers the file layer — truncating writes,
`walk`'s order, `sha256`, what `removeDerived` may touch; `stage.test.ts`,
staging a dropped folder; `assets.test.ts`, figure handles let go on replace
and remove; `store.test.ts`, the store under a document named `__proto__`;
`words.test.ts`, the counting the UI phrases with.

**The fixtures under them.** `fixtures/pdf.ts` is the pen: pages drawn at
exact positions, sizes and faces. `cases/index.ts` registers every case file —
a new default gets a file and an entry there. `cases/case.ts` holds the `Case`
type and `summarize`, `cases/text.ts` the shared prose and leading (each line
with a capital and a descender, so every ink box is the same height), and
`fixtures/write.ts` writes a case out for `bun run fixtures`. `opfs.worker.ts`
and `stage.worker.ts` run `opfs.ts` and `stage.ts` where they run in the app,
since a synchronous file handle exists only in a worker.

## The corpus

`corpus/` holds real PDFs; nothing asserts on them yet. The drawn cases are
the suite — a real PDF is for developing against.
`godel-incompleteness-hirzel-translation.pdf` (22 pages, LaTeX-set in Computer
Modern, math as printed glyphs, colored text) is the fixture the math and
colored-text work needs; the fidelity gate on the backlog is what will run
over these without goldens. The translation permits reproduction as long as
its notice is included, and the intact PDF carries its own.

## Adding a reader case

A case is pages drawn with exact positions, sizes and faces (`fixtures/pdf.ts`),
and what they should read as — the blocks in brief, and optionally the whole
markdown. Document-wide decisions — the body size, whether bold means anything,
heading levels — are made over the whole PDF, which is why each case is its own
file rather than one page of a single test document.

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
reader is fixed the test fails until `known` is removed. The known gaps today
are the rows of TODO.md's
[_Fidelity: where it's still missing_](../TODO.md)
with a case name beside them.
