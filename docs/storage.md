# Where the work lives: what is left

**No account, no server: a project is a folder, and exporting one is what
saving means.**

What is built is in the README, under *The more technical* and *Adding,
continuing, and replacing*: the workspace layout, the one-workspace rule, the
staged listing and its marks, exact hashing, and the checks before a commit.
The reader is built too, and is its own document — [pipeline.md](pipeline.md).
This file holds only what is not built yet, and the reasoning it will need.
Each section moves into the README as it ships, and the file goes when the
last one does.

---

## Decided, not built: history

Editing, undo, and done are built: every edit autosaves to `edits.json`, the
editor says *Autosaved* where a save button would be, undo is a hundred deep and
kept across a reload, and done locks a document until it is reopened (README,
*Exporting*). One piece of the design is not:

**History** is versions a person never has to make. A version is a snapshot of
a document's edits, taken automatically:

- **when a document is opened**, if its edits changed since its last version —
  one restore point per sitting;
- **when it is marked done.** A document has one done version: marking it done
  again replaces it rather than adding another.

Restoring a version is one undoable step, so a wrong restore is one Ctrl+Z
away. Versions travel in the export, so History survives what undo does not: a
hundred edits, and a move to another machine. Each version points at the one
it was taken from, so the data is a tree; it is shown as a list by time.

**Reopen** takes no version of its own — the done version stands until the
document is marked done again and replaces it. Versions would live in
`versions.json` beside `edits.json`, and travel in each document's manifest
entry. Done is also what will learn folder rules (README, *What gets learned,
and when*).

**Revert to original** (README, *Review and edit*) takes a version first, once
History ships, so a revert under the same reader is recoverable after all. A
version keeps the `reader` of the blocks it was taken on, and one from another
reader is listed but not restored: its block ids would point at different
blocks.

---

## Decided: what a change to the reader does to edits

The same failure as a revised PDF, from the other side: the bytes stay the
same, and `read.ts` or `structure.ts` changes how they become blocks. Block ids
are positions, so an analysis made by the new reader can put a different block
at `p3b7`, and edits keyed to the old one land on it.

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
`READ_WITH`, beside `READER` in `analysis.ts`, is the pdf.js version the reader
was last checked against, and a test in `tests/reader.test.ts` fails when the
installed one differs. So an upgrade cannot land unlooked-at: read real PDFs
with the old version and the new, bump `READER` if any block moved, merged or
split, and only then move `READ_WITH` up. The reader cases in
[testing.md](testing.md) are part of that look but not all of it — they are
drawn PDFs in standard fonts, and an upgrade that only changes how embedded
fonts or odd encodings read passes them.

**Decided against: offering a better reader.** A document whose kept analysis
is older than this build's reader is not wrong — its edits still apply — only
not getting the newer reading. The editor does not say so. The reader will
still change — tables, math, and diagram edges each move blocks — but all of
that lands before anyone else has work in mdgest, and once its thresholds are
chosen it is meant to stop. A prompt that fires only during development is
code to keep for nothing; a person who wants the newer reading has *Revert to
original* (README, *Review and edit*), which is the one way to refresh a
document's reading as well as its edits. If the reader does change after people have work in it, the cost is
that their kept documents keep the old reading without being told — the case
to revisit this for.

Re-mapping edits onto a new reader's blocks by content was considered and not
taken: when the reader regroups blocks, the block an edit was about no longer
exists in any form to map to.

---

## Not built: knowing what is unexported

Closing a tab loses nothing: every edit is already in browser storage. What
can be lost is anything in no export, and that risk is the same whether the
tab is open or closed, so it is shown where the work is rather than asked
about on the way out.

Recording the manifest as of the last export, and comparing it with the
current one, turns it into a count: "3 documents changed since your last
export". The editor shows that as a standing line that links to Export and
clears when one is made; the landing's *Workspace in this browser* row shows
it too; and discarding the browser's workspace, which already asks first, can
now say what would be lost. The folder under `workspaces/` is already
per-workspace, so it is the natural place to keep the record.

The browser's own prompt on leaving (`beforeunload`) is used twice, and only
where it is true:

- **a write still in flight** when the tab closes — the one moment an edit is
  not yet stored;
- **unexported changes when `navigator.storage.persist()` was refused**, where
  eviction is likelier than a person would guess.

Otherwise it stays quiet. Its text is the browser's, not ours ("changes you
made may not be saved"), and asked on every close it would be false, and
learned as noise.
