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

Instead of one function that takes a .pdf and outputs a .md, `mdgest` is an offline, pdf->md tool where a human in the loop can verify the markdown is right page-by-page.

Upload any collection of pdfs:

- a single pdf
- a zip of pdfs
- a folder with pdfs in it

**100% Guarantees:**

- all text from pdf makes it into the markdown
- all pictures from pdf make it into the markdown

**Not yet implemented:**

- Math equations
- Tables
- Hyperlinks
- Rotate

**Human Review/Edit**

Every image and text is boxed, using `pdfium`, into indexed items for you to manipulate:

- click to select, (esc) to deselect
- click-and-drag style reording of text and images.
  - (shift + click) select range
  - (ctrl + click) select distinct
- control groups of text: **join** two groups into one, or **divide** one group into two.
- modify markdown headings: (**H1**, `#`), (**H2**, `##`), (**H3**, `###`), (**H4**, `####`)
- edit font styles: **bold** and _italics_
- lists: (unordered: `-`), (ordered: `1.`, `a.`, `i.` - numerical, alpha, or roman)
- insert space (paragraph, indentation)
- `---` page breaks (before/after line)
- page numbers (on by default)
- hide
  - decisions record on _wording_, not position.
- (ctrl + z) undo / with version history

> Fixing in the markdown editor applies and records changes in the same way.

- **Only `edits.json` is important**. It holds what you decided and nothing else does. This is where rules come from.

## The more technical: Workspaces, rules, and how learning works

<p align="center">
  <img src="docs/diagrams/workspace.svg" alt="Drop files from your disk into the stage, commit them to the workspace in browser storage, export the workspace back to disk" width="100%">
</p>

A workspace is a tree in your browser's own storage, and an export of it is a
folder on your disk. Folders are yours to organize however you like — mdgest
mirrors them. Say you upload `invoice1.pdf` into an `invoices` folder:

    <workspace>/
      sources/invoices/invoice1.pdf            the source PDF, untouched
      markdown/invoices/invoice1.md            the output, same tree
      .mdgest/invoices/invoice1.pdf/
        analysis.json                          the engine's read of the PDF (blocks, fonts, roles) — regenerable, deletable
        edits.json                             your corrections: role/level overrides, hidden blocks, splits, inserts — the one precious file
        versions.json                          named snapshots of edits.json you can roll back to
      .mdgest/invoices/rules.json            what the engine has learned from documents in this folder

### What gets learned, and when

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
bun run dev
```

## Tech stack

**the app** — one bundle, hosted as static files on Cloudflare Pages

- `vite` + `react` + `typescript`, `tailwind` for styling, `oxlint` for linting
- `pdf.js` reads the PDF: every line with its box, size and weight, and every
  picture with its drawn bounds.
- **OPFS** is the workspace. The origin-private file system is the only storage
  every browser has (Chrome/Edge 102+, Firefox 111+, Safari 15.2+, iOS
  included), and the only one with a synchronous handle — which is what lets
  the engine stay synchronous instead of turning every call into a promise.
  It runs in a worker, because that handle is not exposed on the main thread.
  That worker is a module worker, which is what actually sets the floor on
  Firefox: 114, not the 111 that OPFS alone would ask for. Web Locks, which
  keep two tabs from writing one workspace at once, set Safari's: 15.4.
- fonts
  - jetbrains-mono
  - liberata
  - geist-sans
- icons (lucide-react)
- react (dom, router)
- state management: zustand
- rendering (react-markdown and remark-gfm)
- maybe pdfjs-dist

**where the work lives**

Browser storage is evictable and there is no account, so **exporting is what
saving means**. An export is a folder you keep:

- `mdgest.json` carrying every decision
- `sources/` as you gave them
- `markdown/` as it came out.

Hand it back later and you carry on where you left off. Nothing in it is hidden.

---
