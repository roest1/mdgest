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

The Python reference for the project layer is `engine/mdgest/project.py` and
`engine/tests/test_project.py` on `spike/tauri`, which are not committed yet.
Neither is `pdfjs.py` or `test_reader_conformance.py`, the measurement that
chose pdf.js over pdfium: over four documents it reproduces the goldens byte
for byte and disagrees with pdfium on nine markdown lines, every one of them
pdfium's mistake. `structure.py` and the emitter are the ones already ported,
as `src/lib/structure.ts` and `src/lib/emit.ts`.

---

## Export

Nothing writes a workspace out yet, and that is the gap that matters most.
Browser storage is evictable. `navigator.storage.persist()` asks for
durability and does not promise it, and clearing site data is an ordinary
thing to do. `edits.json` does not regenerate, and neither does the analysis
it was made against (below), so an export is not a convenience: it is the only
thing between an eviction and every decision a person made. Everything else
autosaves into browser storage; an export is the one save a person can be
sure of, and the editor says so in those words.

**The door.** OPFS is the workspace; the File System Access API is only a way
in and out. `showDirectoryPicker()` writes a folder where it exists, which is
Chromium only. Everywhere else the export is a zip download, as the import is
already a `webkitdirectory` input or a zip. `unzip.ts` is the way in and runs
in the worker; the way out is the same dependency's `zipSync` and belongs in
the same place, for the same reason — deflating a workspace is exactly the
work that freezes a tab.

**The format** has to survive being emailed, zipped by Finder, unzipped by
Explorer, and handed back through a file input:

```
my-project/
  mdgest.json     the manifest: every decision, in one visible file
  sources/        the PDFs, exactly as they went in
  analysis/       what each edited document's edits were made against
  markdown/       what came out of each document marked done, with its figures
```

Nothing is hidden, on purpose. The working `.mdgest/` is a cache and stays one.
A dot-directory in an export would be invisible where a person keeps it,
silently dropped by some `webkitdirectory` uploads, and padded with `__MACOSX`
by the macOS zip tool. That is three ways to lose the only part that cannot be
replaced.

**What the manifest carries.** The TypeScript side reads `format`, `documents`
and each document's `sha256`, and passes everything else through untouched
(`workspace.ts`, `parseManifest`). Building one is still to port from
`project.py`'s `manifest()`. Per document it carries the hash, the page count,
`edits` without the undo and redo stacks, its versions, whether it is done,
and the `reader` version its analysis came from (below). Per folder it carries
the learned `rules`. Measured on a real 14-page report:

| | | |
|---|---|---|
| `edits.json` | 5.7 kB | precious |
| `rules.json` | 1.1 kB | precious |
| `analysis.json` | 76 kB | precious once the document has edits; regenerates until then |
| `renders/` | ~2.8 MB | cache |

The manifest carries the 6.8 kB. The analysis travels beside it, in
`analysis/<doc>.json`, for every document with edits and for no other: it is
what those edits' block ids mean, and the reason is under *What a change to
the reader does to edits*. It stays out of `mdgest.json` so the manifest stays
small enough to read. Undo and redo do not travel: an undo history is the
shape of one working session, not a decision about a document.

`renders/` is never exported, and in this build is never written either: the
thumbnail strip keeps its page renders in memory (`snapshots.ts`), bounded at a
hundred, and redraws the rest. What *is* written and does travel is
`markdown/<doc>.assets/`, the figures — they are part of what came out, and a
markdown file whose images 404 is not a conversion anyone can use.

**Markdown is written for done documents only.** A document still being
edited has no output anyone should hand on yet, and an export that mixed
finished and half-finished files would not say which was which.

**Two exports**, because there are two reasons to want one. The default writes
the resumable project. A markdown-only export writes `markdown/` alone, which
is what someone came for, to hand to whatever reads it next.

---

## Decided, not built: where decisions live in the browser

**The manifest is only the exchange format.** A commit unpacks an imported
manifest into `.mdgest/<doc>.pdf/edits.json`, `versions.json` and the folder's
`rules.json`, and an export packs them back into one `mdgest.json`. Writes stay
per document, and the layout in the README stays true.

The other shape, the manifest as the store, would make editing one block of one
document rewrite a file that grows with the whole workspace. `convert` already
writes per document, under exactly that path, and `analysis` reads one
document's cache without touching any other's; the edits go beside it.

Until the editor reads them, an imported manifest's edits sit in the
workspace's `mdgest.json` exactly as they arrived, and nothing reads them.

Once there are edits, the working tree gains three files, beside the
`analysis.json` it already has:

    .mdgest/invoices/invoice1.pdf/
      analysis.json    the engine's read of the PDF — regenerable until the document has edits, then kept
      edits.json       your corrections: role/level overrides, hidden blocks, splits, inserts
      versions.json    the automatic snapshots of edits.json that History restores
    .mdgest/invoices/rules.json   what the engine has learned from documents in this folder

**What cannot be made again.** Edits, versions and rules hold what a person
decided, and nothing else does; an export packs them into `mdgest.json`. The
analysis of an edited document is the fourth, because the edits' block ids
mean nothing without it; it travels as `analysis/<doc>.json`. The sources are
carried so an export restores on its own. Everything else regenerates: an
unedited document's analysis from its PDF, and the markdown from the analysis
and the edits.

---

## Decided, not built: editing, history, and done

**There is no save button.** Every edit is written to browser storage as it is
made, and the editor shows that as a quiet *Autosaved*. A button would say that
unsaved work is at risk, and here it never is — until the browser's storage is,
which a button cannot help with and an export can.

**Undo** steps back through single edits: the spike's stack in `edits.json`, a
hundred deep, kept across a reload and never exported.

**History** is versions a person never has to make. A version is a snapshot of
a document's edits, taken automatically:

- **when a document is opened**, if its edits changed since its last version —
  one restore point per sitting;
- **when it is marked done.** A document has one done version: marking it done
  again replaces it rather than adding another.

Restoring a version is one undoable step, so a wrong restore is one Ctrl+Z
away. Versions travel in the export, so History survives what undo does not: a
hundred edits, and a move to another machine. The shape is the spike's
`versions.py`, parent pointers and all, with the manual trigger removed; the
tree is kept in the data and shown as a list by time.

**Done locks a document.** It cannot be edited until someone chooses
**Reopen**, which takes no version of its own — the done version stands until
the document is marked done again and replaces it. Done is also what learns
folder rules (README, *What gets learned, and when*) and what earns a document
its markdown in an export.

---

---

## Decided, not built: what a revised source does to its edits

A `revised` row is a new PDF under an id that already has decisions. Block ids
are positions (`p{page}b{index}`), so whether those decisions still apply
depends entirely on what changed in the PDF. A typo fix moves nothing. An
inserted clause shifts every block after it, and the edits land on whatever
now sits there: a heading on a paragraph, a hide on real text. That is
markdown that looks done and is wrong, which is worse than redoing work.

**The rule: a revised PDF replaces the old one, and its edits carry over only
if the layout they were made against is unchanged. Otherwise the document
starts over from scratch.** Only one version of a document is ever kept. There
is no restoring the old edits: they described a PDF that is gone.

**Unchanged layout** means all of the following, compared block by block:

- the same number of pages, and the same number of blocks on every page;
- every block's box within about a point of where it was, with the same font
  size and weight;
- every block's text within a small edit distance of what it was.

Anything else counts as changed, and one change anywhere starts the whole
document over. It is all or nothing per document, not per edit: joins,
reordering and page breaks depend on neighboring blocks, so one edit can
match while what surrounds it has moved. The check leans towards starting
over. A spelling fix that rewraps a line fails it, and that costs redone work,
never wrong work.

Starting over drops the document's edits and versions. Folder rules are
kept: they describe shapes, not this document's blocks, and they apply to the
new PDF as guesses like they would to any other.

**What it needs.** The hash of the source the edits were made for, in each
document's manifest entry: a mismatch with the current source is what triggers
the check. That catches a revised drop, and also a PDF swapped by hand inside
an export. The other side of the comparison is the analysis the edits were made
against, which is kept and exported for exactly this (next section). An earlier
draft of this rule carried a separate per-block fingerprint in `mdgest.json`
for the purpose; the kept analysis is that fingerprint, already on hand.

**Where it runs.** The check needs an analysis of the staged bytes, and the
reader is not in the worker — pdf.js is open on the page's thread, which is
where a canvas exists and where `read.ts` runs. So the landing does it: a
`revised` row is read on the page while it is staged, and the row then says
which it is — edits kept, or starting over — instead of today's "edits may no
longer line up" at commit. It is the one place the landing needs pdf.js, and
it is worth the chunk: the alternative is telling someone after the fact. An
export beforehand is the only way back, and the prompt should say so. The
editor runs the same check when it opens a document whose edits name another
hash, which covers anything that got past the landing.

**What the commit must stop doing.** `opfs.removeDerived` deletes a revised
document's whole cache directory, `edits.json` included. Once edits exist, a
revised commit keeps the old analysis and edits until the check has decided.

Until then, a commit keeps a revised document's edits in the manifest and
nothing reads them, so nothing wrong can show.

---

## Decided, not built: what a change to the reader does to edits

The same failure as a revised PDF, from the other side: the bytes stay the
same, and `read.ts` or `structure.ts` changes how they become blocks. Block ids
are positions, so an analysis made by the new reader can put a different block
at `p3b7`, and edits keyed to the old one land on it.

**A document with edits keeps the analysis its edits were made against.** It
is never regenerated on its own, and it travels in the export
(`analysis/<doc>.json`). A document without edits re-reads freely and always
gets the current reader.

**Each document records the `reader` version that produced its analysis**, a
number bumped by hand whenever a change to the reader could move, merge or
split a block. A hash cannot stand in for it: the PDF did not change. The
number detects; the kept analysis is what makes detecting safe. When they
disagree, nothing is wrong — the edits still apply to the analysis they were
made on — and the editor offers *a better reader is available: read again and
start over*, which asks first, as starting over does for a revised source. A
`reader` newer than this build is refused on import, as a newer `format` is.

Re-mapping edits onto a new reader's blocks by content was considered and not
taken: when the reader regroups blocks, the block an edit was about no longer
exists in any form to map to.

---

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
