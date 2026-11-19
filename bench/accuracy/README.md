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

| Benchmark      | Inputs                                                    | Scored by                                                             |
| -------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `olmocr`       | 1,403 single-page PDFs                                    | `olmocr.bench`, 8,413 unit tests                                      |
| `fr-bench`     | 721 single-page French PDFs                               | `benchpdf2md`, 2,318 unit tests of that kind                          |
| `readoc`       | 2,233 whole documents, about 20,000 pages                 | READoc's evaluation suite, against the markdown each was made from    |
| `omnidocbench` | 981 single pages, the ones OmniDocBench published as PDFs | OmniDocBench's evaluator, against v1.6's ground truth for those pages |

It needs [uv](https://docs.astral.sh/uv/), the Pythons the scorers and peers
are pinned to (3.13 for olmOCR-bench's scorer, which does not start on 3.14;
3.11 for OmniDocBench's, the newest it allows; 3.14 for the rest), and the Chromium `bun run test` already uses. The first run of a benchmark
fetches its data (about 350 MB each, and 1.8 GB for READoc, which unpacks
to as much again) and builds its scorer's environment;
both are kept in `~/.cache/mdgest-bench/`, or wherever `MDGEST_BENCH_CACHE`
says. When the manifest comes to ask for other files of the same
revision, the ones not yet there are fetched and the rest left.

## What a run does

| Step     | Where                                      | What                                                                                            |
| -------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| manifest | `manifest.ts`                              | each benchmark's dataset, the commit of it that is pinned, and its scorer's version             |
| fetch    | `fetch.ts`                                 | downloads the pinned files once, each checked against the hash the revision gives it            |
| convert  | `convert.run.ts`, in Chromium              | every PDF through `openPdf`, `readPage`, `structure` and `emit`: the path `reader.test.ts` runs |
| adapt    | `<benchmark>/adapter.ts`                   | lays the markdown out under the names the scorer expects                                        |
| score    | `<benchmark>/pyproject.toml`, a uv project | the benchmark's own code at a pinned version, every package under it pinned by `uv.lock`        |
| record   | `results.ts`                               | one line added to `results/<benchmark>.jsonl`                                                   |

A long job is read in several browsers at once, a document each in turn:
one browser for every two cores, and no more than six. What a document
reads as does not depend on which reads it. Pages a second counts each
document's own reading time, so it is not the speed of the browsers
together; they slow one another all the same (16 pages a second in six
where one reads 20, on the machine the history was made on), so each line
says how many there were (`browsers`), and speeds compare between lines
that agree on it.

A document is given up on after two minutes. That is the clock's verdict
and not the reader's, and a slower machine gives it to more documents, so
a run with one given up on prints its scores and adds no line.

Only the converter is mdgest. Scorers are never rewritten here: one that is
drifts from the numbers its benchmark publishes for other tools.

One thing is done to every tool's markdown before a scorer sees it: a file
that is nothing but white space is left empty. olmOCR-bench's scorer looks
for a test's text with a fuzzy match (rapidfuzz's `partial_ratio`) that a
single space satisfies, so a page a tool wrote only a line break for passes
its "present" tests, and an empty one fails them. pdftotext writes that
line break for every page it finds no text on, which was worth 456 tests to
it. The same match also passes a page whose whole output is a few
characters found in the test's text; that is the scorer's, and is left.

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
  It is taken apart from the reading: a document the reader fails on, or
  is given up on, has its text layer taken from the PDF opened again.
- **A quote is there** when it is found with spaces, punctuation, case and
  accents set aside, allowing one differing character in ten, or as many as
  its test allows if that is more.
- **A document with ground truth**, in READoc, is held against stretches
  of its ground truth's prose, eight words at a time and up to 200 of
  them, with everything written in LaTeX left out.
- **A page with ground truth**, in OmniDocBench, is held against the text
  of its regions, thirty letters at a time -- by letters, since Chinese
  sets no spaces -- with formulas and tables left out.
- **A page tested only on formulas** quotes nothing to hold its text layer
  against. It is a text-layer page when the layer has at least 200 letters
  and digits: a scan has none, a printed page thousands.

Beside both scores goes **words carried** (`coverage.ts`): of the letters
and digits each PDF's text layer prints, the share the tool's markdown
carries, pooled over the inputs -- the reader cases' fidelity check
(`src/lib/fidelity.ts`) over whole documents, and for every tool the same
way. Case, spacing and punctuation are set aside, so a hyphen rejoined
across a line loses nothing; the markdown is read as rendered text, so
markup is not counted. It is reported and held to nothing. It cannot see
order, which the scores measure, and the text layer is pdf.js's as the PDF
carries it, so an ordered list's `a.` that mdgest writes as `1.` is a
letter mdgest does not carry.

The split is made once for a pinned revision and committed as
`results/<benchmark>.text-layer.json`, so every run and every tool is
scored on the same pages. Delete the file to have it made again. No split
is made from a run that could not take some input's text layer: the page
would be out for every tool, for good, by that run's accident.

## The history

`results/<benchmark>.jsonl` holds one line a run: the date, the commit, the
tool and what it was made of (`READER` and pdf.js for mdgest, the version
for a peer), the dataset's revision, the scorer's version, pages a second,
both scores with every category's passed and total under them, the words
carried (absent from lines from before it was measured), and a hash
of all the markdown written, which is equal on two lines exactly when the
two runs wrote the same markdown.

A line is added only by a run of every input from a tree with no changes in
it. A slice, or a run from a tree a commit does not describe, prints its
scores and adds nothing: nobody could make that number again. The tree is
looked at before anything is converted, which is when a run with changes
says it will add nothing, and again at the end: mdgest is read from the
working tree for as long as the run takes, so a run the tree changed under
adds nothing either. The commit on a line is the one the run began at.

Categories are reported as the scorer reports them and never re-weighted,
and the score is the one number each scorer gives:

- **olmOCR-bench**: the mean of the pass rates of its seven test files and
  of the `baseline` test the scorer adds for every page.
- **fr-bench**: the share of all tests passed. Its `baseline` checks, one
  beside every test, are listed but not in the score.

- **READoc**: no one number. Its suite measures each document against its
  ground truth -- text, headings, formulas, tables, reading order -- and
  gives the mean of each measure over the documents, for the arXiv papers
  and the GitHub READMEs apart. `average` is the mean of the measures the
  paper's tables list, which is what the paper calls a system's score.

- **OmniDocBench**: no one number here. Its evaluator gives, for text,
  formulas, tables and reading order, an edit distance (`Edit_dist`: 0 is
  the ground truth exactly, lower is better) and for tables TEDS (higher
  is better); `ALL_page_avg` is the mean over pages, the one its
  leaderboard lists. The leaderboard's Overall needs CDM, a formula
  measure that renders LaTeX and is left off until mdgest writes formulas.

  **Never set these beside the leaderboard.** It scores all 1,651 pages of
  v1.6 from images. This is the 981 of them that exist as PDFs, the easier
  ones, so it runs high, and every line says so in its `label`.

A document the tool could not read is scored as empty markdown, and so is
one fr-bench's scorer will not take: its text normaliser raises on a NUL
character, which would end the run with no score. Both are counted on the
line (`unread`, `refused`) and named when the run prints.

## The review report

```sh
bun run bench:report olmocr    # after a full run of mdgest on it
```

For the benchmarks made of tests, a page of HTML in `out/<benchmark>/`,
not committed: every page with a failed test, drawn, with the reader's
blocks boxed on it and numbered as the markdown counts them, the markdown
beside it, and the tests that failed with the scorer's reason. At its top
are the tests whose verdict is not the one the run before gave. It is for
looking, and decides nothing: the verdicts are the scorer's.

The verdicts are those of the last run of every input, in the history or
not, and the page says which run that was: its commit, its date, its
reader. A slice leaves them alone. The pictures and the markdown are made
when the report is, by the reader as the tree then has it; a page it no
longer writes as the run scored it is marked, and counted at the top.

## From the Actions tab

`.github/workflows/bench.yml` runs one benchmark with one tool when
started by hand, and uploads the history line it wrote and, for mdgest,
the review report. Nothing else starts it, and it is no part of `ci ok`.
A runner there has four cores, so a long job is read in two browsers, and
its pages a second are not this history's.

## Peers

A peer is another converter put through the same fetch, adapter, scorer
and pages, so its line and mdgest's are made the same way. Each is a pinned
uv project under `tools/<name>/` with a `convert.py` that takes the same
job the mdgest converter does. What a peer made of a dataset revision is
kept in the cache and reused until the revision changes or the peer does:
its version, asked of it before each run, its lock, its `convert.py`,
which holds its settings, or `tools/peer.py`.

| Tool          | Version      | How it reads                                | How it is run                         |
| ------------- | ------------ | ------------------------------------------- | ------------------------------------- |
| `pymupdf4llm` | 2.1          | the text layer, with a layout model over it | its defaults, with OCR off            |
| `markitdown`  | 0.1.9        | the text layer                              | as it comes; it has no OCR of its own |
| `docling`     | 2.150.1      | layout and table models over the text layer | OCR off, on the CPU                   |
| `pdftotext`   | the system's | the text layer, as plain text: the floor    | Poppler's, in reading order           |

OCR is off wherever a tool has it: mdgest has none, so the comparison is
between readers of the text layer, on the same pages. What every peer's
`convert.py` shares, the job read and answered, is `tools/peer.py`.

## Layout

| Path                         | Holds                                                                   | Committed  |
| ---------------------------- | ----------------------------------------------------------------------- | ---------- |
| `run.ts`                     | `bun run bench:accuracy`: the steps above, in order                     | yes        |
| `manifest.ts`                | the pins                                                                | yes        |
| `fetch.ts`, `cache.ts`       | the data, and where everything uncommitted is kept                      | yes        |
| `vitest.config.ts`           | the converter's own config: Chromium, nothing from tests                | yes        |
| `convert.run.ts`, `job.ts`   | the converter, in the browser, and what it is asked for                 | yes        |
| `tools.ts`, `tools/<name>/`  | mdgest and the peers as converters                                      | yes        |
| `split.ts`                   | the text-layer split                                                    | yes        |
| `adapter.ts`, `<benchmark>/` | what a benchmark must say for itself; its adapter and its scorer's pins | yes        |
| `results/`                   | the history, and each benchmark's split                                 | yes        |
| `report.ts`, `out/`          | the review report, and where it is written                              | no, `out/` |
| `~/.cache/mdgest-bench/`     | datasets, converted markdown, scorer environments                       | no         |

In the cache, `work/<benchmark>/<tool>/<set>/` is the folder the scorer was
last given, with `scorer.txt`, everything it printed: each failed test and
why. `kept/<benchmark>/<tool>/` is what the last run of every input left
for the review report: its verdicts, the ones before them, and what each
was a run of.

Like `tests/`, nothing under `bench/` is imported from `src/`.
