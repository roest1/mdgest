# bench

How long an edit takes to show on a long book. Run by hand, never in CI:
timings on shared runners are too noisy to gate on, and the book is not ours
to commit.

```sh
cp ~/books/some-long-book.pdf .vitest/bench/book.pdf   # any long PDF; gitignored
bun run bench                         # production React, every scenario
VITE_BENCH=raw bun run bench          # only the scenarios matching /raw/
BENCH_DEV=1 bun run bench             # development React, for comparison
```

Each run adds to `.vitest/bench/results.txt`: the commit (with `+changes` for
a dirty tree), the build, the book, then a row a scenario, the median of six
presses in ms:

- **call**: the press itself, the markdown emitted and stored.
- **paint**: from the press to the frame painted after it. The number to watch.
- **saved**: until the edit is written to OPFS, in a worker.
- **longest**: the longest task in the second after, such as the scroll sync
  measuring again. 0 means none over 50ms.

A production row over the budget, 50ms painted or a long task, says `OVER`.

## Production, not dev

React's development build copies every changed prop of every component it
renders into the browser's performance timeline. On a long book, whose
props are the whole document, that cost several times what the app did:
a hide that painted in 80ms in production took 6s in `bun run dev`, then
ran out of memory. Judge speed here, on the production build. `bun run dev`
being slow on a long book is a hint, not a measure.

The bench runs production React, and fails if it gets the other. The app's
own code still comes through Vite's dev server, so `preview.ts` times the
same presses on the app as built and served:

```sh
bun run build && bun run preview --port 4173 --strictPort &
bun bench/preview.ts
```

On 2026-11-17 the two agreed within 3ms on every scenario.

## What an edit may cost

An edit emits the whole markdown again (about 10ms for 792 pages), so every
memoised piece of the panes is handed new objects. Each must draw again only
for what it shows:

- **Compare what is drawn, not who holds it.** A page of the markdown takes
  the whole map of placed blocks for its notes' numbers. Compared by
  identity, every edit redrew all 792 pages. Comparing the numbers of its
  own selected blocks instead took 80ms to 25ms.
- **Split what moves from what is said.** An edit early in the book
  renumbers every line after it but rewrites none of them. A thin wrapper
  takes the number and an inner memo the lines: 42ms to 33ms for a delete,
  353ms to 225ms in dev. Writing the number to the DOM from an effect
  measured the same, so the React way won.
- **Add a scenario with the feature.** Undo, redo, and every edit after them
  get a row here, early and mid book, in both views.
