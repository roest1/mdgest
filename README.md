<p align="center">
  <img src="docs/brand/lockup-wide.svg" alt="mdgest" width="750">
</p>

<p align="center">
  <em>pdf to markdown converter, page by page, your data stays on your machine.</em>
</p>

# mdgest

PDF to Markdown. The one missing feature to [pdf.net](https://pdf.net).

**Why would you need this?** Maybe to use pdf content in LLM prompts or RAG based-pipelines for downstream image and/or text models.

---

## How it works

Instead of one function that takes a `.pdf` and returns a `.md`, `mdgest` is an
offline pdf→md tool where a human in the loop can verify the markdown is right,
page by page. Nothing is uploaded anywhere: the conversion runs in your browser,
and the workspace lives in your browser's own storage.

Upload any collection of pdfs:

- a single pdf
- a zip of pdfs
- a folder with pdfs in it

**What every conversion guarantees:**

- all text from the pdf makes it into the markdown
- every picture large enough to be a figure is written beside the markdown and
  linked from it. Images below the figure thresholds — hairline rules, bullet
  glyphs drawn as bitmaps, stretched one-pixel shims — are decoration, and are
  left out on purpose (`src/lib/read.ts`).

Nothing is summarized, rewritten or dropped for being hard to place: a block the
engine cannot make sense of comes out as a paragraph, where you can see it and
fix it.

**Working today**

- the conversion: pdf.js reads every line and picture, `structure.ts` makes
  blocks in reading order and gives each a role, `emit.ts` writes the markdown.
  The result is cached as `analysis.json` and written to `markdown/<doc>.md`
  with its figures beside it
- review: every block boxed and numbered on the page, the same numbers beside
  the markdown lines they became, click to select, `shift`-click for a range,
  `ctrl`/`cmd`-click for distinct blocks, `esc` to deselect
- editing: select blocks and set what they are from the floating toolbar —
  heading level or paragraph, list kind and depth, bold, italic, quote, a page
  break before or after, hide, join. Each edit is written to `edits.json` as it
  is made, and the editor says *Autosaved* where a save button would be. Undo
  with `ctrl`+`z`, redo with `ctrl`+`shift`+`z` or `ctrl`+`y`, or revert to
  original to drop every edit and read the PDF again
- mark done, which locks a document until it is reopened, and export, as a zip
  or into a folder (*Exporting*, below)
- a guided tour on a bundled two-page example, so none of this has to be learned
  on your own document

**Not built yet** — in the order they matter

|                              |                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| the rest of the editor       | divide, drag to reorder, insert space, page numbers, editing from the markdown pane                               |
| `rules.json`                 | what the engine learns from a folder's documents                                                                  |
| tables                       | read as the lines they are printed as, not as a table                                                             |
| math                         | read as the glyphs it is set in, not as `$…$`                                                                     |
| repeated headers and footers | no detection, so running heads and page numbers come through on every page                                        |
| rotate                       | a page's own rotation is applied, but a block cannot be turned by hand                                            |

### Review and edit

Every image and line of text is boxed into indexed blocks. What the toolbar
does with a selection — what is marked _not built yet_ is the design still to
come:

- click-and-drag reordering of text and images — _not built yet_
- control groups of text: **join** two blocks into one, or **divide** one into
  two (divide is _not built yet_)
- modify markdown headings: (**H1**, `#`), (**H2**, `##`), (**H3**, `###`), (**H4**, `####`), or back to a paragraph
- edit font styles: **bold** and _italics_
- lists: (unordered: `-`), (ordered: numerical, alpha, or roman), a level in or
  out. Every ordered list is written `1.` in the markdown, which has no lettered
  or numeral lists; the rendered view letters and numerals the levels back
- **quote**: a block written as a blockquote, whatever it is
- insert space (paragraph, indentation) — _not built yet_
- `---` page breaks (before/after line). Today one is written between every page
- page numbers (on by default) — _not built yet_
- hide — the block stays on the page and leaves the markdown
- (ctrl + z) undo, (ctrl + shift + z or ctrl + y) redo, a hundred deep and kept
  across a reload. There is no version history: undo covers a sitting, and
  after reopening a done document, undoing what changed since puts it back as
  it was marked done
- revert to original — below

**Revert to original**, the third of the markdown pane's history buttons, drops
a document's edits and reads its PDF again, as if it had just been added. It
asks first, because undo cannot take it back: the undo history lives in the
`edits.json` it removes. It removes what a revised source loses — `edits.json`,
`analysis.json`, the figures and the markdown — keeps the PDF, and reads it
again on the spot. A document marked done is locked, so it is reopened first.

The reader that turns a PDF into blocks is versioned, and every reading
records the version that made it. A reading is kept once made, so a document
read by an earlier version keeps that version's reading after mdgest's reader
improves (*When the reader changes*, below).
Reverting is how it gets the current one: it is not *back to the reading first
made*, but a new reading by the current reader version. The button names both
versions before it acts:

- **edits to drop**: it asks first, and says which reader version made the
  reading and which one will make the new one
- **no edits, read by an older reader version**: it reads the document again
  without asking, since nothing is lost
- **no edits, read by the current reader version**: it is disabled. A new
  reading would be the same as the one there is

> Fixing in the markdown editor will apply and record changes the same way —
> _not built yet_; the markdown pane is read-only today.

## The more technical: Workspaces, rules, and how learning works

<p align="center">
  <img src="docs/diagrams/workspace.svg" alt="Drop files from your disk into the stage, commit them to the workspace in browser storage, export the workspace back to disk" width="100%">
</p>

Browser storage is evictable and there is no account, so **exporting is what
saving means**. An export is a folder you keep:

- `mdgest.json` carrying every decision
- `sources/` as you gave them
- `markdown/` as it came out.

Hand it back later and you carry on where you left off. Nothing in it is hidden.
A workspace is a tree in your browser's own storage, and an export of it is a
folder on your disk. Folders are yours to organize however you like — mdgest
mirrors them. Say you upload `invoice1.pdf` into an `invoices` folder:

    <workspace>/
      mdgest.json                              the manifest: each document's SHA-256 and every decision
      sources/invoices/invoice1.pdf            the source PDF, untouched
      markdown/invoices/invoice1.md            the output, same tree
      markdown/invoices/invoice1.assets/       its figures, as PNGs
      .mdgest/invoices/invoice1.pdf/
        analysis.json                          the engine's read of the PDF (blocks, fonts, roles) — regenerable until it has edits
        edits.json                             your corrections, whether it is done, and its undo history

Every edit is written to `edits.json` as it is made; there is no save button.

### Exporting

**Export**, in the editor's header, writes the workspace out as a zip on any
browser, or straight into a folder you pick on Chromium ones:

    my-project/
      mdgest.json          every document's hash and decisions, in one file
      sources/             the PDFs, exactly as they went in
      markdown/            each document marked done, with its figures

A markdown-only export writes `markdown/` alone. Markdown is written for done
documents only, so nothing half-finished goes out looking finished. Into a
folder, the folder must be empty or one an earlier export wrote; what that
export wrote is replaced, and nothing else there is touched.

`mdgest.json` is the browser's per-document `edits.json` files gathered into
one, without their undo history. Each document's entry carries its source's
SHA-256, the `reader` version its blocks came from, whether it is done, its
edits, and a `check`: the SHA-256 of the rest of the entry. In a zip the file is
marked read-only, which most unzip tools honor. That is a hint, not a lock.
What protects it is the check:

- **an entry changed since it was exported** is marked `edited` when the
  project is dropped back in, and continuing asks first. Its edits come in as
  they are now
- **an entry whose edits do not make sense** (a heading level of 9, a role
  that does not exist) costs that one document its decisions, never the whole
  import. It is marked `starts over`, with the reason, and is read from scratch
- **an entry from another reader**, whose block ids would point at different
  blocks, starts over the same way

Continuing unpacks each entry back into that document's `edits.json`.

In the browser, the workspace lives at `workspaces/default/` in the site's own
storage. Only one workspace is kept at a time, but it already has a folder of
its own so that more can sit beside it later.

### Adding, continuing, and replacing

Everything you drop — PDFs, folders, zips — is listed before anything is
written. The list says what the button under it will do to each file, and
nothing reaches the workspace until you press it.

**A project to continue is recognized by one file.** A folder or zip with
`mdgest.json` at its root, or one folder down, is an earlier export, and it continues where it left
off. Anything else is PDFs to add. Loose PDFs join whichever workspace is
there, whether you just dropped it or it's left over from a previous visit.

**One workspace per browser.** A second project is refused until the first is
discarded, so an old export is continued into an empty browser, as a whole.
Documents are never mixed between the two. Discarding the browser's workspace
asks first, because it holds the only copy of anything you haven't exported.

**A document is its path.** `invoices/invoice1` is the id its edits are keyed
to. A file's SHA-256 is evidence about it, never its identity. Each
row in the list gets one of these marks:

| mark        | meaning                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------- |
| _(none)_    | already here, byte for byte, and nothing is written — or, creating a workspace, new      |
| `new`       | not here yet, and added as-is, when continuing a workspace                               |
| `revised`   | here already, with different bytes under the same name. You're asked again before commit |
| `missing`   | listed in the manifest with no PDF. The decisions are kept and wait for the file         |
| `duplicate` | the same bytes as another row, under another name. Both are kept unless you take one out |
| `conflict`  | two different files for one name. Keep one or rename the other before you can continue   |

Dropping a file the workspace already holds, under the same name, adds no
row; the drop just says it was already uploaded.

Matching is exact, with no fuzzy "this looks like the same PDF". The case that
really happens is the same file picked again from the same folder, and exact
equality catches it without false positives. Two PDFs that are only _similar_
have different block layouts, so their edits wouldn't transfer anyway.

**Revised is the one to be careful with: a revised PDF starts over.** A
block's id is its position (`p{page}b{index}`, or `p{page}i{index}` for a
picture), not its content, so edits made
to the old file would resolve against the new one to whatever block now sits
in each position — a heading on a paragraph, a hide on real text. Markdown
that looks done and is wrong is worse than redoing the work. So committing a
revised PDF replaces the old one and drops everything made from it: its
analysis, its markdown and figures, its edits and its done mark. The new file
is read from scratch the next time it is opened. Only one version of a
document is ever kept, and there is no restoring the old edits; an export made
beforehand is the only copy. That is why the drop tells revised files apart
from unchanged ones, and why committing one asks a second time.

**Before writing**, the list checks there is room: twice the size of what
arrives, because markdown and analysis come out of it later. It also checks
that no other tab has changed the workspace since the list was drawn. If one
has, nothing is written, and you're asked to reload. Committing also asks the
browser to keep the site's storage, but that request can be refused, so
exporting is still what saving means.

### When the reader changes

The same failure as a revised PDF, from the other side: the bytes stay the
same, and `read.ts` or `structure.ts` changes how they become blocks. Block ids
are positions, so an analysis made by the new reader can put a different block
at `p3b7`, and edits keyed to the old one would land on it.

`READER` in `analysis.ts` is a number bumped by hand whenever a change to the
reader could move, merge or split a block, and every analysis records the one
that made it. In the browser, a document's analysis is read once and kept, so
its edits always apply to the blocks they were made on. An export writes that
analysis's `reader` into the entry of each document that has edits — not this
build's, since a kept analysis can be older — and an import from a different
reader starts that document over, as a revised source does. The analysis
itself is not exported: with the same reader, reading the PDF again makes the
same blocks, and its figures with them.

**pdf.js is part of the reader.** It is not pinned, and an upgrade can change
the text runs `read.ts` is given as surely as a change to `read.ts` can.
`READ_WITH`, beside `READER`, is the pdf.js version the reader was made with,
and a test in `tests/reader.test.ts` fails when the installed one differs. The
fix is to bump `READER` and move `READ_WITH` up together, without checking
whether any block moved: nothing here can say so for embedded fonts or odd
encodings, which the drawn cases in [docs/testing.md](docs/testing.md) do not
use. A needless bump costs only an older export's edits on import, and nobody
else has exports yet. Once they do, pin pdf.js and upgrade it on purpose
rather than take every release as a bump.

**A kept reading is not refreshed for you.** A document read by an older
reader is not wrong — its edits still apply — only not getting the newer
reading, and the editor does not say so. The reader will still change —
tables, math, and diagram edges each move blocks — but all of that lands
before anyone else has work in mdgest, and once its thresholds are chosen it
is meant to stop. A person who wants the newer reading has *Revert to
original* (*Review and edit*, above), the one way to refresh a document's
reading as well as its edits. If the reader does change after people have work
in it, their kept documents keep the old reading without being told — the
case to revisit this for.

Decided against:

- **a corpus of real PDFs with a block snapshot**, to tell an upgrade that
  moved blocks from one that did not. It would cover the few producers it
  holds and no others, and it only saves bumps that cost nothing today
- **offering a better reader** when a document's reading is older than the
  build's. A prompt that fires only during development is code to keep for
  nothing
- **re-mapping edits onto a new reader's blocks by content**: when the reader
  regroups blocks, the block an edit was about no longer exists in any form to
  map to

### What gets learned, and when

_Designed, not built._

A rule maps how a block looks on the page — font size, weight, indent, marker — to the role you decided it should have. Not the text, the shape: "14pt bold, indent 2 → heading level 2." Text-based rules exist too, for repeated headers/footers, keyed by wording with digits wildcarded so page numbers don't break the match.

Rules are learned when you mark a document **done**, not on every edit. A heading level you try and undo on page 2 never touches `rules.json` — only your final, confirmed edits do. The one exception is hiding a repeated line at folder scope, which is deliberately explicit and shown across every occurrence before you commit.

When you apply a rule, the deepest matching folder wins, and your own `edits.json` always overrides whatever a rule guesses.

### Why it's worth caring about

The second document in `invoices/` that shares a template edits faster than the first — headings, footers, and boilerplate that formatted the same way get recognized before you touch them. And because a rule is a plain, readable JSON entry with an example block attached, you can see exactly why the engine made a call, and delete or override any single rule without retraining anything.

---

## Getting Started

```bash
git clone https://github.com/roest1/mdgest.git && cd mdgest
curl -fsSL https://bun.com/install | bash
bun install
bun run dev          # http://127.0.0.1:2048, or set WEB_PORT
```

`bun run lint` (oxlint), `bun run typecheck` (`tsc -b`), `bun run test`
(vitest in headless Chromium, [docs/testing.md](docs/testing.md)) and
`bun run build` (`tsc -b` then vite) are what CI runs, in that order.

## Tech stack

**the app** — one bundle, hosted as static files on Cloudflare Pages. No server,
no account, and no request to any other origin: what it fetches after the page
loads — the editor, pdf.js's worker and data, the tour — is its own.

|          |                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| build    | `vite` 8 (rolldown), `typescript` 7, `oxlint`                                                                                                     |
| ui       | `react` 19, `react-router` 8, `tailwind` 4, `lucide-react` icons                                                                                  |
| state    | `zustand` — one store for what both editor panes read                                                                                             |
| pdf      | `pdfjs-dist` 6, with cmaps, standard fonts and the wasm fallback emitted as assets by a plugin in `vite.config.ts`                                |
| markdown | `react-markdown` + `remark-gfm` for the rendered view                                                                                             |
| archives | `fflate` — unzip on the way in, zip on the way out                                                                                                |
| fonts    | Literata (serif), Geist Sans (ui), JetBrains Mono (code), Caveat (the tour's hand) — self-hosted via `@fontsource`, never a request off-origin |

**pdf.js reads the PDF.** Every line with its box, size and weight, and every
picture with the bounds it was drawn to. It was chosen over pdfium by
measurement, not preference — see [docs/pipeline.md](docs/pipeline.md). Its own
parsing worker does the decoding; `src/lib/read.ts` does the geometry.

**OPFS is the workspace.** The origin-private file system is the only storage
every browser has, and its synchronous access handle reads or writes a whole
file in one call. The workspace runs in a worker, because that handle is not
exposed on the main thread.
That worker is a module worker, which is what actually sets the floor on
Firefox: 114, not the 111 that OPFS alone would ask for. Web Locks, which keep
two tabs from writing one workspace at once, set Safari's: 15.4. The whole
table is in [docs/deployment.md](docs/deployment.md).

## Documentation

|                                              |                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [docs/pipeline.md](docs/pipeline.md)         | how a page becomes markdown: read → structure → emit, and every threshold either one leans on |
| [docs/storage.md](docs/storage.md)           | what is left in the workspace story: unexported changes                                       |
| [docs/testing.md](docs/testing.md)           | running the tests, what they cover, and adding a reader case                                  |
| [docs/deployment.md](docs/deployment.md)     | commit to edge to browser, the worker boundary, the browser floor                             |
| [docs/brand/README.md](docs/brand/README.md) | the mark, and why there are two drawings of it                                                |

---
