# bench

Two measures of mdgest, both run by hand and neither part of CI.

- [`accuracy/`](accuracy/README.md): what the reader makes of public
  PDF-to-Markdown benchmarks, scored by each benchmark's own scorer.
  `bun run bench:accuracy <benchmark>`.
- [`speed/`](speed/README.md): how long an edit takes to show on a long
  book. `bun run bench:speed`.
