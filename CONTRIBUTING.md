# Contributing to mdgest

## Getting set up

```bash
make setup     # uv sync
make check     # what CI runs: pytest, ruff, and the two conventions checks
make test      # the engine's tests
make fmt       # ruff --fix, then ruff format
```

Run `make check` before calling a change finished. CI runs `ruff check` but not
`ruff format --check`, so formatting drift is not enforced — do not reformat
files you did not otherwise touch, because incidental reformatting buries the
change a reviewer is trying to read.

## Layout

```
engine/     python (uv)         the engine, and the CLI and HTTP faces over it
web/        typescript (bun)    the UI
src-tauri/  rust (cargo)        the desktop shell
```

Three toolchains, three lockfiles, one product. Each tool only looks in its own
directory. The import graph inside `engine/mdgest/` is a directed acyclic graph
and should stay one; a cycle there is a design error rather than an
inconvenience.

## Language

**American English.** `analyze`, `normalized`, `color`, `judgment`, `labeled`,
`center`, `license`. `make check` enforces it.

The check is a fixed list of word pairs, never a suffix pattern, because
`\w+ise` matches `otherwise`, `promise` and `raise`, and `\w+yse` matches
`analyses` — which is the correct plural of *analysis* and appears throughout
the engine. Add a pair to `scripts/check_language.py` when one turns up. Do not
turn it into a regex.

## How to write

The reader is a competent engineer arriving in six months with a bug. They can
read Python. They cannot read your mind about why the number is 0.12.

**Say what would go wrong otherwise.** A comment that restates the code earns
nothing. A comment that names the failure the code prevents earns its line.

```python
# BAD  -- restates the code
# Check if the line is in the margin.

# GOOD -- names what it prevents
# A page number is only a page number where a page number goes: a bare `4`
# is one in the footer and a list item in the body.
```

**Lead a module docstring with the question the module answers**, not a
restatement of its name.

```python
"""Where else does this wording appear, and where on the page does it sit?"""
"""The gate: does the markdown say what the page says, and nothing else?"""
```

**Cite the failure that earned the rule.** Rules here were paid for. Say what
they cost, with numbers where there are numbers.

```python
#: A roman numeral, properly formed. The tempting `[ivxlcdm]+` also matches
#: ordinary words -- civil, mill, did -- which is how a margin line of real
#: text becomes a page number and disappears.
```

**Give every tuned constant a `#:` line** saying what the value means and why
it holds that value. A bare `0.12` is a mystery; `MARGIN_FRACTION = 0.12` with
a line about header and footer bands is a decision.

**Name the alternative you rejected**, when a reader would reasonably reach for
it. `mark` writes an HTML comment rather than a heading *because* headings
become citation anchors — that sentence stops the next person "fixing" it.

**Be honest about what is not proven.** The gate catches loss and invention,
not misreading, and the docs say so. Never let a doc imply more coverage than
the code has.

## The prose budget

Comments grow quietly, so `make check` fails a module whose docstring runs past
20 lines or whose comments and docstrings exceed 0.45 lines per line of code.
Run `scripts/prose_budget.py` with no arguments to see every module's ratio.

Both numbers come from this repo rather than from a book: 20 is the longest
module docstring the engine carries, and 0.45 is where a module full of
hard-won rules still passes while narration does not.

When a module goes over, the fix is almost never to delete a good comment:

- The module docstring is repeating something in `docs/`. Point at it instead.
- A comment *develops* its point over five lines when the point is one line.
  Say the thing; do not argue for it.
- Two comments are making the same observation in different places.

## Cost

Measure before claiming. `scripts/bench.py` builds a synthetic corpus the shape
of a real one — around 60 documents, 1,000 pages, folders seven deep — plus a
single document of 300 pages, because those two put different pressure on the
engine and a two-page fixture shows neither.

Four rules, each of which names a bug this repo actually had:

- **Nothing quadratic in a per-page or per-corpus path.** Assigning boxes to
  bands once scanned every cut per box; a page of 800 lines cost 8.5 ms instead
  of 0.5 ms, and it grew 3.5x per doubling where it should grow 2x.
- **Do not hold a corpus in memory to answer a question about it.** Reading
  every analysis into one dict before building an index over it cost 19 MB for
  sixty documents where the index itself is 2.6 MB.
- **Do not re-read a PDF to apply a decision that does not need one.** Changing
  a folder setting re-parsed every document in it: 1,487 ms where re-shaping
  the cached analysis is 108 ms, and on real documents it need not open them at
  all.
- **A response the UI loads must not scale with document length.** `ops.view()`
  returns 2.3 MB for a 300-page document; a page is 2.6 kB. Paginate.

## Tests

Name the property, not the function. `test_hiding_is_not_losing` says what must
be true; `test_set_block` says nothing. The docstring is where the reasoning
goes:

```python
def test_hiding_is_not_losing(ws):
    """A hidden block leaves the markdown *and* the expectation. Coverage that
    fell when someone hid a running header would train people to ignore it."""
```

Select fixture blocks by their wording, never by index. Block ids shift the
moment a fixture changes, and a positional test then breaks for reasons that
have nothing to do with what it was checking.

`engine/tests/fixtures/` is generated by `make_fixtures.py` and is entirely
synthetic. **Nothing from a real document anyone else owns goes in this
repository, ever** — it is public, and no amount of "just for a test" survives
being wrong about that once.

`engine/tests/golden/` is the markdown those fixtures must produce. See the
README beside it.

## Commits

A title that states what changed, in sentence case, no `feat:` prefix. A body
in prose saying why it matters and what it cost — not a bullet list of files.

```
Make over-hiding visible: the gate cannot see it, so report it

Coverage is computed over what is visible, which means hiding a line removes
it from the expectation as well as from the output. Over-hiding therefore
cannot move coverage -- hide a whole banner and `verify` still reads 100% PASS.
```

If a change departs from an earlier decision, say so and say why. The commit
log is the only place that reasoning survives.

## Do not

- Hedge. No "we might want to", "this should probably", "consider".
- Sell. No "powerful", "seamless", "robust", "simply", "just".
- Explain the language. The reader knows what a dataclass is.
- Leave a `TODO` without a name and a reason.
- Use emoji in code, docstrings, or commit messages.
