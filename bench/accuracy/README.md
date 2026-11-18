# bench/accuracy

mdgest scored on public PDF-to-Markdown benchmarks, by each benchmark's own
scorer, so a change to the reader shows up as a number that moved. Run by
hand, never in CI, and nothing here gates a merge: a lower score is a
finding, and the regression tests stay in [`tests/`](../tests/README.md).

How long an edit takes to show is measured apart, in
[`bench/speed/`](../speed/README.md).

```sh
bun run bench:accuracy olmocr                                # mdgest, every input
bun run bench:accuracy fr-bench --tool pymupdf4llm           # a peer, through the same steps
bun run bench:accuracy olmocr --only arxiv_math --limit 50   # a slice, while working on one thing
bun run bench:accuracy all                                   # every benchmark in turn
```

| Benchmark  | Inputs                      | Scored by                                        |
| ---------- | --------------------------- | ------------------------------------------------ |
| `olmocr`   | 1,403 single-page PDFs      | `olmocr.bench`, 8,413 unit tests                 |
| `fr-bench` | 721 single-page French PDFs | `benchpdf2md`, 2,318 unit tests of the same kind |

It needs [uv](https://docs.astral.sh/uv/) and a Python 3.12 for the scorers,
and the Chromium `bun run test` already uses. The first run of a benchmark
fetches its data (about 350 MB each) and builds its scorer's environment;
both are kept in `~/.cache/mdgest-bench/`, or wherever `MDGEST_BENCH_CACHE`
says.

## What a run does

| Step     | Where                                      | What                                                                                            |
| -------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| manifest | `manifest.ts`                              | each benchmark's dataset, the commit of it that is pinned, and its scorer's version             |
| fetch    | `fetch.ts`                                 | downloads the pinned files once, each checked against the hash the revision gives it            |
| convert  | `convert.run.ts`, in Chromium              | every PDF through `openPdf`, `readPage`, `structure` and `emit`: the path `reader.test.ts` runs |
| adapt    | `<benchmark>/adapter.ts`                   | lays the markdown out under the names the scorer expects                                        |
| score    | `<benchmark>/pyproject.toml`, a uv project | the benchmark's own code at a pinned version, every package under it pinned by `uv.lock`        |
| record   | `results.ts`                               | one line added to `results/<benchmark>.jsonl`                                                   |

Only the converter is mdgest. Scorers are never rewritten here: one that is
drifts from the numbers its benchmark publishes for other tools.

## The two numbers

Every run scores twice.

- **All pages**: every input, scans included. What a person with that mix
  of documents gets.
- **Text-layer pages**: the inputs whose PDF carries its words as text. The
  number that should move when the reader improves.

mdgest has no OCR. It reads the text a PDF carries and cannot read words
that are only pixels, so on a scan it scores about zero whatever the reader
does, and a benchmark that is one third scans hides the reader behind them.

A page is a text-layer page when its PDF's own text layer holds at least 80%
of what the page should say (`split.ts`):

- **What the page should say** is the text its tests quote from it: a
  present or an absent test's text, both stretches of an order test, a
  table test's cell and its neighbours. A formula is not counted, since its
  LaTeX is not text the page prints. fr-bench's tests on charts quote what
  a description of the chart should say, so a chart drawn as a picture is
  not a text-layer page.
- **What the PDF carries** is the text pdf.js finds in it, before the reader
  touches it, so a change to the reader never moves a page across the line.
- **A quote is there** when it is found with spaces, punctuation, case and
  accents set aside, allowing one differing character in ten, or as many as
  its test allows if that is more.
- **A page tested only on formulas** quotes nothing to hold its text layer
  against. It is a text-layer page when the layer has at least 200 letters
  and digits: a scan has none, a printed page thousands.

The split is made once for a pinned revision and committed as
`results/<benchmark>.text-layer.json`, so every run and every tool is
scored on the same pages. Delete the file to have it made again.

## The history

`results/<benchmark>.jsonl` holds one line a run: the date, the commit, the
tool and what it was made of (`READER` and pdf.js for mdgest, the version
for a peer), the dataset's revision, the scorer's version, pages a second,
both scores with every category's passed and total under them, and a hash
of all the markdown written, which is equal on two lines exactly when the
two runs wrote the same markdown.

A line is added only by a run of every input from a tree with no changes in
it. A slice, or a run from a tree a commit does not describe, prints its
scores and adds nothing: nobody could make that number again.

Categories are reported as the scorer reports them and never re-weighted,
and the score is the one number each scorer gives:

- **olmOCR-bench**: the mean of the pass rates of its seven test files and
  of the `baseline` test the scorer adds for every page.
- **fr-bench**: the share of all tests passed. Its `baseline` checks, one
  beside every test, are listed but not in the score.

A document the tool could not read is scored as empty markdown, and so is
one fr-bench's scorer will not take: its text normaliser raises on a NUL
character, which would end the run with no score. Both are counted on the
line (`unread`, `refused`) and named when the run prints.

## Peers

A peer is another converter put through the same fetch, adapter, scorer
and pages, so its line and mdgest's are made the same way. Each is a pinned
uv project under `tools/<name>/` with a `convert.py` that takes the same
job the mdgest converter does. What a peer made of a dataset revision is
kept in the cache and reused until its lock or the revision changes.

| Tool          | Version | How it is run                                  |
| ------------- | ------- | ---------------------------------------------- |
| `pymupdf4llm` | 2.1     | its defaults, layout analysis on, with OCR off |

## Layout

| Path                         | Holds                                                                   | Committed |
| ---------------------------- | ----------------------------------------------------------------------- | --------- |
| `run.ts`                     | `bun run bench:accuracy`: the steps above, in order                     | yes       |
| `manifest.ts`                | the pins                                                                | yes       |
| `fetch.ts`, `cache.ts`       | the data, and where everything uncommitted is kept                      | yes       |
| `vitest.config.ts`           | the converter's own config: Chromium, nothing from tests                | yes       |
| `convert.run.ts`, `job.ts`   | the converter, in the browser, and what it is asked for                 | yes       |
| `tools.ts`, `tools/<name>/`  | mdgest and the peers as converters                                      | yes       |
| `split.ts`                   | the text-layer split                                                    | yes       |
| `adapter.ts`, `<benchmark>/` | what a benchmark must say for itself; its adapter and its scorer's pins | yes       |
| `results/`                   | the history, and each benchmark's split                                 | yes       |
| `~/.cache/mdgest-bench/`     | datasets, converted markdown, scorer environments                       | no        |

In the cache, `work/<benchmark>/<tool>/<set>/` is the folder the scorer was
last given, with `scorer.txt`, everything it printed: each failed test and
why.

Like `tests/`, nothing under `bench/` is imported from `src/`.
