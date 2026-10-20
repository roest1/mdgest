(delete this file when items completed — but first move the gap → test-case
table under _Fidelity: where it's still missing_ into tests/README.md, which
links here for it)

# TODO

## [] Rules: what gets learned

_Designed, not built — the `rules.json` row of the roadmap._

A rule maps how a block looks on the page — font size, weight, indent, marker — to the role you decided it should have. Not the text, the shape: "14pt bold, indent 2 → heading level 2." Text rules are in the design too, for repeated headers and footers, keyed by wording with digits wildcarded so page numbers don't break the match — the per-document detection is already built (_Fidelity: where it's still missing_, below); what a rule adds is carrying the choice across a folder.

Rules are learned when you mark a document **done**, not on every edit. A heading level you try and undo on page 2 never touches `rules.json` — only your final, confirmed edits do. The one exception is hiding a repeated line at folder scope, which is deliberately explicit and shown across every occurrence before you commit. When rules apply, the deepest matching folder wins, and your own `edits.json` always overrides whatever a rule guesses.

The payoff: the second document in `invoices/` that shares a template edits faster than the first — headings, footers, and boilerplate that formatted the same way get recognized before you touch them. And because a rule is a plain, readable JSON entry with an example block attached, you can see exactly why the engine made a call, and delete or override any single rule without retraining anything.

---

## [] Fidelity: where it's still missing

Every decision the reader makes is a _default_, and every default is a guess a
person should be able to overrule. That is `edits.json`: the analysis is
regenerable from the PDF — and kept once made — and the markdown regenerates
from the analysis and the edits. The _To build_ table below lists
features to build; this is
what the reader gets wrong today, and what fixing it would take.

Page furniture — page numbers, repeated headers and footers — is already
handled per document (detection in `src/lib/furniture.ts`, keep / hide / delete
in the editor); what remains for it is folder scope, under _Rules_ above.

Beyond that, what a conversion cannot yet get right — a gap with a test case
named beside it is drawn as an expected failure in the suite
([tests/README.md](tests/README.md)):

| gap                                                                      | what comes out today                                                                                                            | what it would take                                                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **tables**                                                               | the cells as separate blocks, in XY-cut order — usually one paragraph per cell                                                  | a ruling/alignment pass over a band: detect the grid from line boxes and drawn rules, then emit a GFM table. `remark-gfm` already renders them                  |
| **math**                                                                 | the glyphs as printed, so a fraction comes out as its numerator and denominator on two lines                                    | recognizing math runs by font (the `CM`/`STIX`/`MS` families) and layout, then emitting `$…$`. This is the hardest one                                          |
| **hyphenation**                                                          | a word broken across two lines stays broken                                                                                     | joining `-` at a line end when the next line continues lowercase — safe in prose, wrong in code and in compound terms, so it wants to be an edit, not a default |
| **rotate**                                                               | the page's own rotation is applied; a block cannot be turned                                                                    | a per-block override in the edits, and a reading pass over sideways text                                                                                        |
| **reading order across pages**                                           | each page is cut on its own, so a paragraph spanning a page break is two blocks until a person joins them                       | a rule for continuation                                                                                                                                         |
| **columns under a full-width line** (`blocks-two-columns-under-a-title`) | two columns between a title and a footer that span the gutter are read across, row by row, where their paragraph breaks line up | cutting on the gutter where it runs, not only where it crosses the whole region                                                                                 |
| **first-line indents** (`blocks-first-line-indent`)                      | paragraphs told apart only by an indented first line, as books and papers set them, run together                                | reading an indented line after a full-width one as a new paragraph                                                                                              |
| **long lettered lists** (`lists-lettered-past-h`)                        | `i.` after `h.` is read as the numeral one, and the count restarts there                                                        | judging an ambiguous marker by the items around it                                                                                                              |
| **ZapfDingbats bullets** (`lists-dingbat-bullets`)                       | a bullet in that face comes through pdf.js as a letter (`l` for ●) and stands apart from its item                               | remapping that face's codes the way Wingdings' are                                                                                                              |

Each of these is a fidelity feature, not a rewrite: they add roles and
attributes to `Block`, and lines to `emit.ts`. The frame, the ids and the cache
do not move.

---

## To build

|     |                                        |                                                                                                                                                                                                                                                     |
| --- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| []  | cross out                              | ~~strikethrough~~ option in floating toolbar. Needs to click and drag to highlight text.                                                                                                                                                            |
| []  | task Lists                             | Use - [ ] for unchecked boxes and - [x] for checked boxes.                                                                                                                                                                                          |
| []  | mutable indices                        | click-and-drag to reorder or click and edit index                                                                                                                                                                                                   |
| []  | tables                                 | convert to markdown table syntax                                                                                                                                                                                                                    |
| []  | code                                   | `inline_code()` and ```<language> multi-line code                                                                                                                                                                                                   |
| []  | math                                   | Needs research. Markdown supports latex. `$...$`                                                                                                                                                                                                    |
| []  | images                                 | drag corners to resize height / width; choose left, center, right placement; rotate                                                                                                                                                                 |
| []  | mermaid diagrams                       | https://mermaid.ai/open-source/intro/ for different diagrams. Simple one to start: DAG (detect arrows)                                                                                                                                              |
| []  | capital lists                          | `A.` / `I.` variants of alpha and roman lists. Could show on hover over `a.` / `i.` in the toolbar, like the iPhone keyboard's press-and-hold                                                                                                       |
| []  | tour upkeep                            | the guided tour needs to stay up to date with each new feature                                                                                                                                                                                      |
| []  | `rules.json`                           | what the engine learns from a folder's documents (biggest design piece left)                                                                                                                                                                        |
| []  | toc tooling                            | decide: is tooling needed for a table of contents and configuring it?                                                                                                                                                                               |
| []  | footnotes                              | decide: `[^1]` footnote syntax?                                                                                                                                                                                                                     |
| []  | index the workspace for downstream RAG | **link to sections (he citation contract)**. mdgest owns one half: every emitted heading gets a stable, unique, GitHub-style anchor, and a citable id is the document's folder-relative path minus .md. Those compose into `[[doc:<doc-id>#<anchor> | display]]`. Repairing, validating and resolving tokens against a corpus is the other half and deliberately not here |

---

When done, convert a bunch of different pdfs and see if new rules can become the default.
