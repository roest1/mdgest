# Where the work lives: what is left

**No account, no server: a project is a folder, and exporting one is what
saving means.**

What is built is in the README, under *The more technical* and *Adding,
continuing, and replacing*: the workspace layout, the one-workspace rule, the
staged listing and its marks, exact hashing, the checks before a commit, and
what a change to the reader does to edits.
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
