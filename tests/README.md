# Testing

```bash
bunx playwright install --with-deps chromium   # once, for bun run test
bun run test          # everything, once, in headless Chromium
bun run test:watch    # re-run on save
bun run fixtures      # write every reader case to tests/out/ as a PDF
```

## What is tested

What this code decides, not what the language or the browser guarantees.

**The reader.** `reader.test.ts` runs every case through the app's own path
-- pdf.js opens the fixture, `readPage` reads each page, `structure` makes
the blocks, `emit` writes the markdown -- and asserts that the installed
pdf.js is the version `READER` was made with (`src/lib/analysis.ts`). The reader is almost all decisions:
every threshold in `read.ts` and `structure.ts` is a guess about how a page
is read, so most cases sit a known distance either side of one. The cases
live in `cases/`, one file per area its name says: headings, lists, blocks,
style, links, pictures, pages. `analysis.test.ts` covers the gate on a
stored read: what `parseAnalysis` refuses, and that it refuses under the one
name that tells the page to read the document again. `read.test.ts` drives `readPage` over a stand-in page, for the timing a real
document cannot be made to show: a font still loading when the text is read
is waited for, not read as regular; and a picture whose pixels pdf.js cannot
hand over is the page under it, cut from one render in the right place.
`emit.test.ts` covers the map beside the markdown: each block's number on
its page and the line it went on, which the numbered boxes will read.
`convert.test.ts` reads a document over the real engine: off its pages
once and kept, from the cache after, one reading for two asks at once, and
read again when the cached analysis cannot be used.

**The workspace.** `workspace.test.ts` covers ids, the places a document has,
and what `parseManifest` refuses; `upload.test.ts`, the file-type policy and
where an exported workspace sits in a drop; `unzip.test.ts`, what an archive
gives up and what it is refused for; `tree.test.ts`, the order a listing
folds into; `opfs.test.ts`, the file layer: truncating writes, replacing ones
and what a write cut short leaves, `walk`'s order, `sha256`, and what
`removeDerived` may touch; `stage.test.ts`, what a drop stages, how a conflict
is settled, what a commit writes and what it refuses, the bytes the editor
reads back, and a document's read kept, replaced and refused; `engine.test.ts`, what
the engine worker does with a call it has no method for; `words.test.ts`, the
counting the UI phrases with.

**The landing.** `landing.test.ts` mounts the page over the real engine and
drops files on it: what a drop lists, how a conflict is settled from the
page, what commit and discard ask first, and what each leaves on screen.
The decisions are the engine's and tested there; this checks that the page
shows them and that every button comes back as the next view.

**The editor.** `editor.test.ts` opens the editor at an address over the
real engine: a document the workspace holds opens as a tab, and one it does
not is let go of, in place, with a word on why. An open document's pages are
laid out and drawn -- only those near the view in a long one -- the zoom and
two-page view re-lay them, dragging the split or sliding either sidebar
moves the pages every frame and draws them once it stops, the sidebar's
thumbnails and outline go where they point, the properties dialog shows what
the file says and closes from its backdrop, a picked zoom is drawn again on
a screen of another pixel density, and a file that is not a PDF says so.
The open document is read, and the markdown pane shows it rendered, with
its figures from the workspace, and as numbered source; a reading that
fails says why there; and what was held of a document goes with its tab,
and of every document with the editor, so the next workspace's document of
the same name is read afresh. These tests load the app's stylesheet, so what is hidden is hidden and what
scrolls scrolls. `pdf.test.ts` covers pdf.js as `pdf.ts` sets it up: one
worker for every document, so letting one go never refuses the next; and
what is read out of a document besides its pages -- its properties, its
outline and where each entry points, on a page turned any way, and what is
left when pdf.js cannot read the outline or the properties.
`store.test.ts` covers the store under a document named `__proto__`;
`assets.test.ts`, figures read out of the workspace once, held as object
URLs, and revoked when their document leaves. `snapshots.test.ts` covers
what the thumbnails are drawn from: one copy of a
page, not one per render, replaced only when too narrow for the screen, and
scaled down to an average rather than speckle.

The PDFs are built by `pdfOf` in `harness.ts`, by hand: blank pages with a
number on each, and an info dictionary, outline and /Rotate when a test
asks, so no document of anyone's is needed. The reader's are drawn by
`fixtures/pdf.ts` over pdf-lib, which knows the standard faces' widths:
text at exact positions, sizes and faces, pictures and link boxes.
`cases/case.ts` holds the `Case` type and `summarize`, `cases/text.ts` the
shared prose and leading, and `fixtures/write.ts` writes the cases out for
`bun run fixtures`.

`worker.ts` runs `opfs.ts` and `stage.ts` where they run in the app, since a
synchronous file handle exists only in a worker; `harness.ts` is the wire
between it and a test. Nothing under `tests/` is imported from `src/`, so
none of it reaches a build.

## Adding a reader case

A case is pages drawn with exact positions, sizes and faces, and the blocks
they should read as, in brief. Document-wide decisions -- the body size,
whether bold means anything, heading levels -- are made over the whole PDF,
which is why each case is its own file rather than one page of a shared
test document.

```ts
{
  name: "lists-indent-tolerance",
  about: "Indents within 3pt are one level (72 and 75); 4pt further in is a level deeper (76).",
  pages: [(pen) => [X, X + 3, X, X + 4].forEach((x, i) => pen.text(x, TOP + i * LEADING, `• ${ITEMS[i]}`))],
  blocks: [`bullet • ${ITEMS[0]}`, `bullet • ${ITEMS[1]}`, `bullet • ${ITEMS[2]}`, `  bullet • ${ITEMS[3]}`],
}
```

Write the expectation from what a person reading the page would say, not
from what the reader prints today. Where the two differ, set `known` to why:
the test is then marked as an expected failure, the suite stays green, and
when the reader is fixed the test fails until `known` is removed. Four are
known today: first-line indents, two columns under a full-width title,
ZapfDingbats bullets, and lettered lists past `h.`.
