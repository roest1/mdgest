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
is settled, what a commit writes and what it refuses; `engine.test.ts`, what
the engine worker does with a call it has no method for; `words.test.ts`, the
counting the UI phrases with.

**The landing.** `landing.test.ts` mounts the page over the real engine and
drops files on it: what a drop lists, how a conflict is settled from the
page, what commit and discard ask first, and what each leaves on screen.
The decisions are the engine's and tested there; this checks that the page
shows them and that every button comes back as the next view.

`worker.ts` runs `opfs.ts` and `stage.ts` where they run in the app, since a
synchronous file handle exists only in a worker; `harness.ts` is the wire
between it and a test. Nothing under `tests/` is imported from `src/`, so
none of it reaches a build.
