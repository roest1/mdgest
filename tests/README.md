# Testing

```bash
bunx playwright install --with-deps chromium   # once, for bun run test
bun run test          # everything, once, in headless Chromium
bun run test:watch    # re-run on save
```

## What is tested

What this code decides, not what the language or the browser guarantees.

**The workspace.** `workspace.test.ts` covers ids, the places a document has,
and what `parseManifest` refuses; `upload.test.ts`, the file-type policy and
where an exported workspace sits in a drop; `unzip.test.ts`, what an archive
gives up and what it is refused for; `tree.test.ts`, the order a listing
folds into; `opfs.test.ts`, the file layer: truncating writes, replacing ones
and what a write cut short leaves, `walk`'s order, `sha256`, and what
`removeDerived` may touch; `stage.test.ts`, what a drop stages, how a conflict
is settled, what a commit writes and what it refuses, and the bytes the editor
reads back; `engine.test.ts`, what
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
laid out and drawn, the zoom and two-page view re-lay them, the sidebar's
thumbnails and outline go where they point, the properties dialog shows
what the file says, and a file that is not a PDF says so. These tests load
the app's stylesheet, so what is hidden is hidden and what scrolls scrolls.
`pdf.test.ts` covers pdf.js as `pdf.ts` sets it up: one worker for every
document, so letting one go never refuses the next; and what is read out of
a document besides its pages -- its properties, its outline and where each
entry points.

The PDFs are built by `pdfOf` in `harness.ts`, by hand: blank pages with a
number on each, and an info dictionary and outline when a test asks, so no
document of anyone's is needed.

`worker.ts` runs `opfs.ts` and `stage.ts` where they run in the app, since a
synchronous file handle exists only in a worker; `harness.ts` is the wire
between it and a test. Nothing under `tests/` is imported from `src/`, so
none of it reaches a build.
