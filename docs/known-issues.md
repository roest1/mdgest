# Known issues — the gate list before this lands in main

Everything here is a defect or an unverified claim carried by the desktop
branch. It exists so nothing on it reaches `main` by being forgotten rather
than by being decided.

## 1. Writes are not uniformly atomic

The spike verdict said "renders already write temp-then-replace; edits should
too, later." That is stale — it reads the situation backwards. As of this
branch:

**Atomic already** (write a temp file, then `Path.replace`):

| file | written by |
|---|---|
| `edits.json` — the only precious file | `engine/mdgest/edits.py:43` |
| `versions.json` | `engine/mdgest/versions.py:28` |
| page renders (`renders/*.png`) | `engine/mdgest/render.py:29` |

**Truncate-in-place, so torn by a kill mid-write**:

| file | written by | cost if torn |
|---|---|---|
| `analysis.json` | `engine/mdgest/store.py:232` | a re-parse (`mdgest analyze --force`, or Re-analyze) |
| `markdown/<doc>.md` | `engine/mdgest/ops.py:46` | regenerated from `edits.json` on the next write |
| `INDEX.md` | `engine/mdgest/ops.py:403` | rebuilt by `mdgest index <folder>` |

So the file that would actually hurt to lose is the one already protected, and
nothing in the exposed column holds a decision a person made. That is why this
is a gate item and not a release blocker.

Two residual gaps even on the atomic path:

- **No `fsync`** of the temp file or its directory before the replace. That is
  enough to survive the desktop shell's `SIGKILL` of the sidecar — the page
  cache still holds the bytes — but not a power loss or a kernel panic.
- **The temp name is derived from the target** (`path.with_suffix(".tmp")`), so
  every writer of a given file shares one temp path. `analyze_async`
  (`engine/mdgest/api.py:69`) starts an unsynchronized daemon thread per call
  and the module-level lock guards only the `jobs` dict, so two overlapping
  analyses of the same document race on both the temp file and the target.

**Before main**: give `write_analysis` and the two markdown writers the same
temp-then-replace; make the temp name unique per writer; serialize analysis
per document. Decide `fsync` separately — it costs latency on every edit and
buys only power-loss durability.

## 2. Windows and macOS rendering has never been looked at

CI assembles the bundles on all three platforms, which proves the toolchains
resolve and nothing more. Nobody has opened the window on Windows or macOS.
Being checked now on the Windows machine.

## 3. The explorer's drag-to-move will break on Windows

With native file drops enabled, WebView2 disables HTML5 drag-and-drop
entirely. The explorer's drag-to-move rows still depend on it. The PDF pane's
block drag already uses pointer events and is fine; the explorer needs the
same treatment.

## 4. No regression coverage against real documents

`engine/tests/fixtures/` is a synthetic corpus (see `make_fixtures.py`). It
proves the pipeline runs end to end — headings, joined paragraphs, nested
lists, images, rule inheritance — but it cannot prove the engine reads a *real*
PDF well, because the only real corpus is client material and this is a public
repository. Checking in expected-output snapshots from client PDFs is not an
option and will not become one.

`mdgest verify` (the gate ported from v1) changes what is left of this. It
scores a document against its own pages — coverage, invention, leaks,
untraceable headings — so it needs **no reference corpus and no committed
snapshot**, which was the thing blocking every option here. It can be run over
client material locally, and over anything at all in CI, without either
leaving the machine.

What it still does not prove is that the engine reads a real PDF *well*: a
heading given the wrong level, a list nested one step too deep, or a
two-column page read in the wrong order all pass the gate, because every word
is present, on the page, and traceable. The gate catches loss and invention,
not misreading.

So what remains of this issue is narrower than it was: a small public-domain
corpus with committed snapshots, to cover the structural judgments the gate
is blind to. Still undecided, but no longer blocking.

## 5. Code signing is unbought

Unsigned macOS builds are stopped by Gatekeeper, Windows by SmartScreen.
Shipping to a client means an Apple Developer account ($99/yr) and an
Authenticode OV certificate (~$200–400/yr). Known, deferred, unavoidable.
