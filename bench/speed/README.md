# bench/speed

How long an edit takes to show on a long book. Run by hand, never in CI:
timings on shared runners are too noisy to gate on, and the book is not ours
to commit.

```sh
cp ~/books/some-long-book.pdf .vitest/bench/book.pdf   # any long PDF; gitignored
bun run bench:speed                    # production React, every scenario
VITE_BENCH=raw bun run bench:speed     # only the scenarios matching /raw/
BENCH_DEV=1 bun run bench:speed        # development React, for comparison
```

Each run adds to `.vitest/bench/results.txt`: the commit (with `+changes` for
a dirty tree), the build, the book, then a row a scenario, the median of six
presses in ms:

- **call**: the press itself, the markdown emitted and stored.
- **paint**: from the press to the frame painted after it. The number to watch.
- **saved**: until the edit is written to OPFS, in a worker.
- **drawn**: until every page of the pane shows the edit. Pages in view
  show it at paint; the rest are drawn again a batch at a time after it.
- **longest**: the longest task in the second after, such as the scroll sync
  measuring again. 0 means none over 50ms.
- **first**: paint/drawn of the first press alone. Its pages are parsed for
  the first time; the presses after it take the edit back and make it again,
  and find them parsed. A person's edit is usually a first press, so this is
  the number a person feels.

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
bun bench/speed/preview.ts
```

On 2026-11-17 the two agreed within 3ms on every scenario.

## What an edit may cost

An edit emits the whole markdown again (about 10ms for 792 pages, 190ms for
a 1,404-page textbook), so every memoised piece of the panes is handed new
objects. Each must draw again only for what it shows:

- **Compare what is drawn, not who holds it.** A page of the markdown takes
  the whole map of placed blocks for its notes' numbers. Compared by
  identity, every edit redrew all 792 pages. Comparing the numbers of its
  own selected blocks instead took 80ms to 25ms.
- **Split what moves from what is said.** An edit early in the book
  renumbers every line after it but rewrites none of them. A thin wrapper
  takes the number and an inner memo the lines: 42ms to 33ms for a delete,
  353ms to 225ms in dev. Writing the number to the DOM from an effect
  measured the same, so the React way won.
- **Draw a page again as it was first drawn.** An edit can change every
  page: hiding a 1,404-page book's page numbers drew all of them again in
  one go, parsing each new page on the page's thread: 6.3s painted on the
  first press, 1.2s on later ones. Now a changed page keeps what it showed
  until its turn, those in view are drawn again before the paint, and the
  rest are parsed in workers and drawn in batches (`progressive.ts`), with
  "Updating pages…" at the foot of the pane meanwhile.
- **Keep a component's type across renders.** A component made anew inside
  a render is a new type to React, which then rebuilds everything under it
  instead of updating it. Each page's block elements were made that way,
  and an edit to every page rebuilt the book's DOM: 1,166ms to 949ms when
  they were made once.
- **Write again only the pages that changed.** Each page of the markdown is
  written alone, so `emit` keeps every page as last written and writes one
  again only when its blocks' edits or furniture choices change: an edit to
  one block took emit from 190ms to 50ms on a 1,404-page book, and the
  paint from about 280ms to 130ms. What is left is putting the pages
  together: 200,000 lines and a record of 106,000 blocks. An edit to every
  page writes every page, as before.
- **Add a scenario with the feature.** Every edit gets a row here, early and
  mid book, in both views, with what takes it back: undo, redo and revert
  have theirs.
