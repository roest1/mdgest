# Where the work lives

**No account, no server: a project is a folder, and exporting one is what
saving means.**

This document is the reasoning behind `mdgest/project.py` and the storage half
of the browser build. It is written down because the decisions interlock — the
storage follows from dropping Python, which follows from swapping the reader —
and because each one looks arbitrary on its own.

---

## How we got here

Three decisions upstream of this one, in the order they fell:

1. **pdf.js replaces pypdfium2.** pypdfium2's PyEmscripten wheels are
   experimental, crash at runtime by the maintainers' own account, and are
   deliberately not published to PyPI, so there is no shipping a binary pdfium
   to a browser. Measured over four documents, the pdf.js reader reproduces the
   goldens byte for byte and disagrees with pdfium on nine markdown lines, every
   one of which is pdfium being wrong. See `mdgest/pdfjs.py` and
   `tests/test_reader_conformance.py`.
2. **TypeScript replaces Python.** With no CLI and no server, Python's only
   remaining job would be to be a multi-megabyte runtime shipped to a browser to
   run code that could be TypeScript. The engine's ~3,300 pure lines port; the
   fixtures and goldens are language-neutral and are what keeps the port honest.
3. **Which leaves the file system.** `store.py` is 351 lines: 63 of path
   algebra and validation that port anywhere, and 221 that need a file system
   underneath them. This document is about those 221.

---

## OPFS is the workspace; the File System Access API is the door

The obvious answer is `showDirectoryPicker()` — let a person choose a folder
and work in it, the way the desktop build did. It fails on two counts.

**Support.** `showDirectoryPicker()` is Chromium-only. Firefox has never
shipped the local-disk pickers and Safari has them on no platform. OPFS is in
Chrome and Edge 86+, Firefox 111+ and Safari 15.2+, including iOS. For a tool
whose pitch is that it works in your browser, a Chromium-only store is a
ceiling, not a detail.

**Synchronous versus asynchronous, which actually decides it.** The engine is
synchronous from top to bottom — `ops.analyze` calls `ws.write_analysis`
inline, `corpus` walks the tree inline — and the File System Access API is
asynchronous everywhere: `getFileHandle`, `createWritable`, all promises. Put
that under the store and `await` propagates through `ops`, `emit` and `corpus`
until the port no longer resembles what it was ported from. OPFS is the way
out: `createSyncAccessHandle()` is genuinely synchronous, and has been
available since March 2023. It is Worker-only, which costs nothing, because
the engine has to run in a worker regardless or reading a 200-page document
freezes the tab.

So:

| | |
|---|---|
| **OPFS**, in the worker | the workspace. Synchronous, everywhere, invisible to the user |
| **File System Access API** | import and export only, where it exists |
| `<input webkitdirectory>` + a zip download | the same door, everywhere else |

The consequence to be honest about: while someone is working, their documents
are in origin-private browser storage, not in a folder they can open. *Never
leaves your machine* is true and is the claim worth making. *Stays on your
disk* is only true after an export, and someone will check.

---

## Export is save, so the export format is the save format

Browser storage is evictable. `navigator.storage.persist()` asks for
durability and does not promise it, and a person clearing site data is not
doing anything unusual. `edits.json` is the one file that does not regenerate.
So an export is not a convenience feature — it is the only thing between a
storage eviction and every decision a person made.

That makes the format's requirements unusually concrete. It has to survive
being emailed, zipped by Finder, unzipped by Explorer, and handed back through
a file input.

```
my-project/
  mdgest.json     the manifest — every decision, in one visible file
  sources/        the PDFs, exactly as they went in
  markdown/       what came out, with its figures
```

**Nothing is hidden, and that is the point.** The working `.mdgest/` is a cache
directory and stays one; it is not the save format. A dot-directory in an
export would be invisible where a person keeps it, silently dropped by some
`webkitdirectory` uploads, and padded with `__MACOSX` by the mac zip tool —
three ways to lose the only irreplaceable part. A single visible file has none
of those failure modes, and a person sees exactly the two things they think in
terms of: the PDFs they gave it and the markdown it made.

**It fits in one file because of a decision the engine already made.** Measured
on a real 14-page report:

| | | |
|---|---|---|
| `edits.json` | 5.7 kB | precious |
| `rules.json` | 1.1 kB | precious |
| `analysis.json` | 76 kB | regenerates from the PDF |
| `renders/` | ~2.8 MB | cache |

The manifest carries the 6.8 kB and leaves the rest. A sixty-document corpus is
a few hundred kilobytes of JSON. In practice it is smaller still — the export
of that same document is 2,214 bytes, because undo and redo stacks do not
travel. An undo history is the shape of one working session, not a decision
about a document, and it is most of what makes `edits.json` large.

`renders/` is never exported. Page images are the bulk of a workspace and come
back on demand; carrying them would roughly double what a person stores in
exchange for nothing they could not regenerate.

There are two exports, because there are two reasons to want one.
`export_to(..., output_only=True)` writes `markdown/` alone — what someone came
for, to hand to whatever reads it next. The default writes the resumable
project.

---

## Continuing is its own operation

A dropped folder is either work to continue or PDFs to add, and the interface
has to know which before it writes anything. `looks_like_project()` reads one
visible file at the root and answers. No sniffing directory contents, no
inferring from a dot-directory the upload may never have delivered.

They cannot share a code path. `store.add_pdf` slugs a filename and renames
around a collision — right for an upload, wrong for a restore, where an id in a
manifest is already the id its edits are keyed to. Importing `pumps` into a
workspace that holds `pumps` would produce `pumps-2` and resume nothing while
looking like it had. So `import_from` writes sources to their recorded ids
directly, and the interface offers *Continue a project* as a separate button.

---

## Refusing to lose work

The failure this format exists to prevent: export at two, work until four,
re-import the two o'clock folder, lose two hours, with nothing said.

A revision counter would catch it, and `compare()` does better for less.
Comparing the decisions themselves — a dict comparison — knows not merely which
export is newer but exactly which documents would lose work, and reports four
outcomes:

| | |
|---|---|
| `added` | not here yet |
| `unchanged` | here, and identical |
| `conflicts` | here, with different edits — someone must choose |
| `resourced` | here, but a different PDF is underneath |

Nothing is written until a person has seen that list, and `apply(documents=…)`
takes a subset, so *keep mine* for the flagged rows is expressible. An
all-or-nothing import is not an answer to a conflict.

`resourced` is separate from `conflicts` on purpose. A block id is
`p{page}b{index}` — position, not content. Replace the PDF under a name and
every edit still resolves, to different blocks, and nothing downstream can
notice. Those edits are not merely older than the ones here; they are
meaningless. That distinction is the whole reason the digest exists.

---

## Hashing: evidence, never identity

`Workspace.source_hash` is SHA-256 of the source, cached at
`.mdgest/<doc>/source.sha256` beside the page count and for the same reason —
it answers a question asked about every document in a corpus, and rehashing a
20 MB source in a loop is not the way to answer it.

A document's id is its path under `sources/`, `edits.json` is keyed to that,
and that does not change. A digest may start a conversation and may never move
a decision:

| | |
|---|---|
| same digest, same id | already here. Say so; do not write it again |
| same digest, different id | one PDF under two names. Offer to skip |
| **different digest, same id** | **the source was revised.** Stop and ask |

Only the third row justifies the machinery, and it is a correctness problem
rather than a convenience one.

**Fuzzy matching is deliberately not here.** The case that actually happens on
resume is the identical file picked again from the same folder, which exact
equality catches with no false positives. Two merely *similar* PDFs have
different block geometry, so the edits would not transfer anyway — and
detecting similarity would only tempt an offer to transfer them, which produces
wrong edits that look like work already done. That is worse than asking someone
to redo it.

If a second tier is ever wanted, the honest one is a hash of the normalized
per-page line text, stored after analysis: same text and different bytes means
the same document re-saved by another tool, and *then* the blocks can be
checked before anything is offered. It cannot help at upload time, so it is a
later prompt and never an automatic action.

---

## What ports, and what does not

`manifest`, `compare` and `apply` are pure — dicts in, dicts out, no file
system. They *are* the format, and they are what the browser build
reimplements against OPFS. `export_to` and `import_from` are thin I/O wrappers
and are the only part that changes when a workspace stops being a directory.

Keeping that line sharp is the lesson `store.py` teaches by not having it: its
path algebra ports anywhere and its I/O does not, and the two are interleaved
across 351 lines. `project.py` puts the boundary in the file where a reader can
see it, and `tests/test_project.py` tests the pure half — so the TypeScript
version has the same tests to satisfy that the pdf.js reader had.
