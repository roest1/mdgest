# The app, in detail

**pdf → markdown, page by page, with a UI and a CLI that do the same things.**

The page is on the left, the markdown it produces is on the right, and every
piece of text and every picture on the page is a numbered box. The same numbers
sit in the markdown's gutter (nvim-style). Click a box and say what it is — a
heading and its level, a bullet / `1.` / `a.` / `i.` item and its depth, bold,
italic, hidden. Drag a box (on the page, or its number in the panel) onto
another and it takes that place; the whole page renumbers under the pointer so
you see the blast radius before you let go. Everything is recorded per
document in a small `edits.json`; the markdown is rewritten on every change
into a tree that mirrors the PDFs'.

```
mdgest/
  engine/    python (uv)   — mdgest: pagemap → structure → emit, FastAPI, typer CLI
  web/       react (bun)   — vite + tailwind 4; the UI
  src-tauri/ rust (cargo)  — the desktop shell (see desktop.md)
  Makefile                 — one entry point for all of it
  workspace/               — default data dir (gitignored); set WS=… / MDGEST_WORKSPACE=…
```

## Run it

```bash
make setup                         # uv sync + bun install
make dev                           # engine :8770 + vite :5173 (proxies /api)  → open http://127.0.0.1:5173
# or
make serve                         # build web/dist and serve everything from the engine on :8770
```

Put documents in from the shell (a pdf, a zip of pdfs, or a directory tree — the
directory structure becomes the folder hierarchy):

```bash
make add SRC=../pdfs TO=manuals
make ls
```

or drop them on the explorer in the UI (files, a zip, or a whole folder).

## The workspace on disk

```
<workspace>/
  sources/<folder…>/<doc>.pdf          what was uploaded; folders are just directories, any depth
  markdown/<folder…>/<doc>.md          the output, same tree        ← replicates the hierarchy
                    /<doc>.assets/     extracted figures
          /<folder>/INDEX.md           a corpus index over that folder (mdgest index)
  .mdgest/<folder…>/<doc>/analysis.json   regenerable: lines, pictures, blocks, roles, default order
                         /edits.json      precious: what a person decided
                         /renders/        page images, rendered on demand
```

A document's id is its path under `sources/` without `.pdf`:
`manuals/hydraulics/pumps/axial-piston`. The hierarchy is whoever's shaping
it — `manuals/training/module-1`, `…/hydraulics/valves` — and an index can be
built over any folder (so any subset of uploads).

## One set of operations, two faces

Every UI action is an `ops.*` function; the API (`engine/mdgest/api.py`) and
the CLI (`engine/mdgest/cli.py`) both call it, so anything you do in the browser
you can do in a shell, and vice versa.

| UI | CLI | API |
|---|---|---|
| drop a pdf / zip / folder | `mdgest add <path> --to <folder>` | `POST /api/upload` (multipart, `folder=`) |
| explorer | `mdgest ls [folder]` | `GET /api/tree` |
| new folder / rename / move / delete | `mdgest mkdir` `mv` `rm` | `POST /api/folders`, `POST /api/move`, `DELETE …` |
| the numbered boxes | `mdgest show <doc> [--page N] [--json]` | `GET /api/docs/<doc>` |
| the markdown | `mdgest md <doc>` | `GET /api/docs/<doc>/markdown` |
| shape bar (H1–H4 ¶ • 1. a. i. depth B I hide) | `mdgest set <doc> <block> --role heading --level 2 --bold …` | `PATCH /api/docs/<doc>/blocks/<block>` |
| drag a box / type a number; click + ⇧click a range and drag the group | `mdgest move <doc> <block>[,<block>…] --to N \| --before <b> \| --after <b>` | `POST …/blocks/<block>/move` (`blocks: […]` for a group) |
| join ↑ / split | `mdgest join <doc> <child> <parent>` / `mdgest split` | `POST …/blocks/<b>/join` / `/split` |
| Insert text (with the warning) | `mdgest insert <doc> "text" --page N --after <block>` | `POST /api/docs/<doc>/inserts` |
| undo / redo / reset | `mdgest undo` `redo` `reset` | `POST …/undo` `/redo` `/reset` |
| Build index on a folder | `mdgest index <folder>` | `POST /api/index` |
| — (not in the UI yet) | `mdgest hide <doc> <block> [--scope …]` | — |
| — (not in the UI yet) | `mdgest suggest [doc\|folder]` | — |
| — (not in the UI yet) | `mdgest settings [folder] --page-numbers …` | — |
| — (not in the UI yet) | `mdgest verify [doc\|folder]` | — |

`mdgest --help` lists them all; `make help` lists the make targets.

Keys in the UI (select a box first): `1`–`6` heading level · `p` paragraph ·
`-` bullet · `n` numbered · `a` lettered · `r` roman · `[` `]` depth · `b` bold ·
`i` italic · `h` hide · `⇧click` select a range (then any key or drag acts on the whole group) · `j`/`k` next/previous block · `J`/`K` move it down/up ·
`t` / `g` / `#` toggle text / image / number overlays · `⌘Z` undo · `Esc` deselect.

## How the engine reads a page (no model, no network)

`pagemap.py` reads the PDF's own text layer with pypdfium2 — every line, its
box, font size, bold, italic — and every image with its drawn bounds. This is
ported from mdgest v1 (the run-rejoining, the bullet reach, the bold probe) and
extended with size/italic. `structure.py` turns lines into blocks and gives
each a default role:

- **reading order** — a recursive XY-cut: a gutter splits columns before a gap
  splits bands, so a paragraph break that lines up across two columns does not
  make the page read across. Pictures go before the text nearest to them
  (label to the right, or caption below).
- **headings** — larger than the body size, or bold when bold is rare in the
  document; levels from size, document-wide.
- **lists** — a printed bullet / `1.` / `a.` / `iv.` starts an item; nesting
  from where the marker sits; a regular line under a bold item at a deeper
  indent is that item's detail.
- **paragraphs** — consecutive lines at one indent, one style, close together.

All of it is a default the UI overrides; `edits.json` is the only precious
file and `analysis.json` regenerates from the PDF (`mdgest analyze --force`,
or Re-analyze in the explorer). Page images render on demand at 1.5× and cache.

## How far a hide reaches

A hide is keyed by the block's *wording*, not its position, so it can reach
other pages and other documents — which is right for a running footer and
wrong for a section heading that happens to be printed twice. Both are
"wording that repeats", and repetition alone cannot tell them apart: on a
twenty-page deck a section banner shown on eight slides clears any sensible
threshold.

Position decides. Repetition is the necessary condition, position the
deciding one:

| where it is printed | reach |
|---|---|
| in a page margin, on several pages | the **folder** — furniture, and a rule is learned |
| in a page margin, on one page | this **block** — a one-off, nothing to generalize |
| in the body, printed once | this **block** |
| in the body, printed several times | this **document**, flagged |

Only the folder scope becomes a rule in `rules.json`. A document-wide hide is
written into that document's own `edits.json`, because that is what it is —
what a person decided about this document — and it survives re-analysis the
way every other edit does. So the scopes need no new file and no new concept;
they are a choice between the two mechanisms that already exist.

`mdgest hide` prints the reach before anything changes (`--dry-run` prints it
and stops), and `--scope` overrides the proposal. Nothing generalizes unseen.

The `--learn` path that the UI drives goes through the same evidence: hiding
margin furniture still records a folder rule, and hiding body wording hides
the block you clicked but *declines* to generalize, saying why. That is the
one case where the gate cannot help afterwards — hiding removes the
expectation along with the content, so coverage stays at 100% either way.

## What else looks like what you hid

`mdgest suggest` proposes further boilerplate — and proposes nothing until you
have hidden something first. mdgest never decides on its own that wording is
furniture: repetition is not evidence, a person's decision is. Once there is
one, the pattern it learns is how the hidden blocks are *set* — the same key
`rules.py` uses for a shape rule, so it carries across documents without
keying on anyone's words.

Hide the copyright footer and the running header set the same way is proposed,
with the scope its own evidence supports. Hide a bold run-in label and the
footer is not proposed, because a pattern learned from body type says nothing
about an 8pt margin line.

Suggestions are proposals and nothing else; `--apply` walks them one at a
time, asking. Nothing is hidden without a person saying so.

## Page numbers

A page number is the one piece of furniture worth keeping. It is not prose —
nobody wants `Page 12` sitting in the markdown as a paragraph — but the number
is how a reader cites the source, and it is not always the page's position in
the file: front matter is numbered in roman, and a chapter extracted from a
larger book starts at 143.

So it is a setting, per folder, deeper folder winning:

| `--page-numbers` | what happens |
|---|---|
| `keep` | left as ordinary text — **the default, because it changes nothing** |
| `hide` | dropped, like any other furniture |
| `mark` | dropped as prose; `<!-- page 12 -->` written at the top of the page instead |

`mark` uses a comment rather than a heading on purpose: the anchors
`corpus.py` builds for citation come from headings, and a page number has no
business among them. A comment is invisible when rendered and readable by a
machine.

Position is checked before the pattern ever is — `4` is a page number in the
footer and a list item in the body — and the roman-numeral case is matched
strictly, because the obvious `[ivxlcdm]+` also swallows `civil`, `mill` and
`did`.

The gate states the policy but never counts it as someone hiding content: the
setting is explicit and visible, and under `mark` the number is recorded
rather than removed.

## The gate: `mdgest verify`

The markdown is checked against the pages it was read from, never against a
reference copy of the document — a reference is itself unverified, and
comparing against one scores the engine's fidelity as the reference's failure.

- **Coverage** — every word of every visible line reaches the markdown.
  Hiding a block removes it from the expectation too, so hiding a running
  header is not scored as loss.
- **Invention** — no word in the markdown is absent from both the page and the
  inserts. Here that is exact rather than approximate: a block's `text` is read
  off the page and is not writable (`edits.BLOCK_FIELDS` has no `text`), so the
  only other words that can enter are a person's inserts, which arrive labeled.
  A word that is on no page and in no insert is an engine bug, not a judgment
  call — and this is what finds it.
- **Leaks** — nothing hidden reaches the markdown. Wording that survives
  somewhere else on purpose is not a leak.
- **Headings** — every heading emitted from the page is text really printed on
  it, in that order. Coverage cannot see a heading assembled from two blocks on
  opposite ends of the page; this can.

Coverage is deliberately blind to one thing, and the report covers it instead:
hiding a line removes it from the expectation as well as from the output, so
over-hiding cannot move coverage — hide a whole banner and it still reads
100%. That matters most when a hide is learned at the folder and reaches a
document nobody has opened, so the report also says how many words are hidden,
what share of the page that is, and which document taught the rule that hid
them. Hiding is legitimate, so none of it fails the gate.

`mdgest verify` exits non-zero if any document fails, so it gates in CI.
Ported from v1's `fidelity.py`, minus its profile-driven "required wording"
check — this engine has no profiles.

## Status / next

Built and working end to end: explorer (folders any depth, drag to move,
rename, delete, upload pdf/zip/folder), tabs, page rail with thumbnails,
overlays (text / images / numbers / raw lines) with click-select and
drag-to-reorder with live blast radius, the shape bar + keyboard, rendered and
source markdown views with the numbered gutter and the same drag, insert-text
with the warning, undo/redo, join/split, per-folder `INDEX.md`, and the CLI
mirror. Engine tests: `make test`.

Not built yet (in order of value):

1. **Cross-page decisions** — "hide this wording everywhere" for running heads
   and footers (v1's margin-vs-body scope model), and "this page reads across
   rows" as a rule instead of a permutation (v1's readings).
2. **The citation contract.** mdgest owns one half of it — every emitted
   heading gets a stable, unique, GitHub-style anchor, and a citable id is the
   document's folder-relative path minus `.md`. Those compose into

   ```
   [[doc:<doc-id>#<anchor>|display text]]

   doc-id   the path under the indexed folder, without `.md`
   anchor   a heading slug from `corpus.slugify`, deduped by `corpus.outline`;
            H2s are the retrieval sections. A bare doc-id is legal only for a
            document with no H2s.
   ```

   Repairing, validating and resolving those tokens against a corpus is the
   other half, and it is deliberately not here: it needs a model in the loop,
   and mdgest stays offline and model-free.
3. **Block splitting** by line (today a block can be joined to another, not cut).
4. A relationship graph view over the folder hierarchy + indexes.
