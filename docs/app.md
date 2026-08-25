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
  only other words that can enter are a person's inserts, which arrive labelled.
  A word that is on no page and in no insert is an engine bug, not a judgement
  call — and this is what finds it.
- **Leaks** — nothing hidden reaches the markdown. Wording that survives
  somewhere else on purpose is not a leak.
- **Headings** — every heading emitted from the page is text really printed on
  it, in that order. Coverage cannot see a heading assembled from two blocks on
  opposite ends of the page; this can.

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
2. **The citation contract** — mdgest's job is to emit markdown whose headings
   carry stable, unique anchors, and to write down the token grammar
   (`[[doc:<doc-id>#<anchor>]]`) that a downstream asker resolves against. The
   grammar and the anchoring rules live here; repairing, validating and
   resolving tokens against a corpus is a separate tool's job, not this one's.
   mdgest itself stays offline and model-free.
3. **Block splitting** by line (today a block can be joined to another, not cut).
4. A relationship graph view over the folder hierarchy + indexes.
