# Where the work lives: what is left

**No account, no server: a project is a folder, and exporting one is what
saving means.**

What is built is in the README, under *The more technical* and *Adding,
continuing, and replacing*: the workspace layout, the one-workspace rule, the
staged listing and its marks, exact hashing, and the checks before a commit.
This file holds only what is not built yet, and the reasoning it will need.
Each section moves into the README as it ships, and the file goes when the
last one does.

The Python reference for all of it is `engine/mdgest/project.py` and
`engine/tests/test_project.py` on `spike/tauri`, which are not committed yet.
Neither is `pdfjs.py` or `test_reader_conformance.py`, the measurement that
chose pdf.js over pdfium: over four documents it reproduces the goldens byte
for byte and disagrees with pdfium on nine markdown lines, every one of them
pdfium's mistake.

---

## Export

Nothing writes a workspace out yet, and that is the gap that matters most.
Browser storage is evictable. `navigator.storage.persist()` asks for
durability and does not promise it, and clearing site data is an ordinary
thing to do. `edits.json` is the one file that does not regenerate, so an
export is not a convenience: it is the only thing between an eviction and
every decision a person made.

**The door.** OPFS is the workspace; the File System Access API is only a way
in and out. `showDirectoryPicker()` writes a folder where it exists, which is
Chromium only. Everywhere else the export is a zip download, as the import is
already a `webkitdirectory` input or a zip. There is an unzip, but no zip
writer yet.

**The format** has to survive being emailed, zipped by Finder, unzipped by
Explorer, and handed back through a file input:

```
my-project/
  mdgest.json     the manifest: every decision, in one visible file
  sources/        the PDFs, exactly as they went in
  markdown/       what came out, with its figures
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
`edits` without the undo and redo stacks, and saved versions. Per folder it
carries the learned `rules`. Measured on a real 14-page report:

| | | |
|---|---|---|
| `edits.json` | 5.7 kB | precious |
| `rules.json` | 1.1 kB | precious |
| `analysis.json` | 76 kB | regenerates from the PDF |
| `renders/` | ~2.8 MB | cache |

The manifest carries the 6.8 kB and leaves the rest. The export of that
document is 2,214 bytes, because undo and redo do not travel: an undo history
is the shape of one working session, not a decision about a document.
`renders/` is never exported.

**Two exports**, because there are two reasons to want one. The default writes
the resumable project. A markdown-only export writes `markdown/` alone, which
is what someone came for, to hand to whatever reads it next.

---

## Open: where decisions live in the browser

Today an imported manifest's edits sit in the workspace's `mdgest.json`
exactly as they arrived, and nothing reads them. The editor will need them, and
there are two shapes:

- **The manifest is the store.** One file per workspace, and export is a copy
  that drops undo and redo. Every edit rewrites the whole manifest.
- **The manifest is only the exchange format.** A commit unpacks it into
  `.mdgest/<doc>.pdf/edits.json` and friends, and an export packs it again.
  Writes stay per document, and the layout in the README stays true.

This is decided with the editor port.

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
reordering and page breaks depend on neighbouring blocks, so one edit can
match while what surrounds it has moved. The check leans towards starting
over. A spelling fix that rewraps a line fails it, and that costs redone work,
never wrong work.

Starting over drops the document's edits and saved versions. Folder rules are
kept: they describe shapes, not this document's blocks, and they apply to the
new PDF as guesses like they would to any other.

**What it needs from the edit format**, decided with the editor port:

- **The hash of the source the edits were made for.** A mismatch with the
  current source is what triggers the check. That catches a revised drop, and
  also a PDF swapped by hand inside an export.
- **A fingerprint of that source's layout:** per block, the rounded box, the
  font, and the text or a hash of it. It is small enough to travel in
  `mdgest.json`, so the check works after an export and import, where no old
  PDF or analysis exists.

**Where it runs.** Once the reader is ported, the worker can analyze a revised
PDF while it is staged and settle the question before commit, so the row says
which it is: edits kept, or starting over. The prompt at commit then says
exactly that, instead of today's "edits may no longer line up". An export
beforehand is the only way back, and the prompt should say so. The editor
runs the same check when it opens a document whose edits name another hash,
which covers anything that got past the landing.

Until then, a commit keeps a revised document's edits in the manifest and
nothing reads them, so nothing wrong can show.

---

## Not built: knowing what is unexported

Discarding the browser's workspace asks first, but it cannot say what would be
lost. Recording the manifest as of the last export, and comparing it with the
current one, turns that into "3 documents have edits that are in no export".
The same record gives each workspace an unsaved mark once there is an editor,
and more than one workspace. The folder under `workspaces/` is already
per-workspace, so it is the natural place to keep it.
