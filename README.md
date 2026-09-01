<p align="center">
  <img src="docs/brand/lockup-wide.svg" alt="mdgest" width="420">
</p>

<p align="center">
  <img src="docs/brand/lockup-wide.svg" alt="mdgest" width="100%">
</p>

<p align="center">
  <em>pdf → markdown, page by page — offline, and measured back against the page it came from.</em>
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

```mermaid
flowchart TB
    PDF[("source.pdf")]

    subgraph READ ["1 &nbsp; READ &nbsp;&mdash;&nbsp; deterministic, no model, no network"]
        direction LR
        PM["<b>pagemap</b><br/>every line with its box, size<br/>and weight; runs on one baseline<br/>rejoined by re-reading their union"]
        ST["<b>structure</b><br/>recursive XY-cut for reading order,<br/>headings by size, list nesting<br/>by marker indent"]
        PM --> ST
    end

    RU["<b>rules.json</b><br/>per folder, deeper wins<br/>shape keyed by how a block is <i>set</i><br/>hide keyed by its <i>words</i>"]
    AN["<b>analysis.json</b><br/>blocks and their default roles<br/><i>regenerable</i>"]

    subgraph DECIDE ["2 &nbsp; DECIDE &nbsp;&mdash;&nbsp; the only step with a person in it"]
        direction LR
        UI["<b>UI &middot; API</b><br/>numbered boxes on the page,<br/>the same numbers in the markdown"]
        ED["<b>edits.json</b><br/>role, level, order, joins,<br/>hides, inserts<br/><i>precious &mdash; the one file<br/>that does not regenerate</i>"]
        UI --> ED
    end

    EM["<b>emit</b><br/>resolve(analysis, edits)<br/>blocks &rarr; markdown"]
    MD[("markdown/&lt;doc&gt;.md")]
    GA{{"<b>fidelity</b> &mdash; the gate<br/>coverage &middot; invention<br/>leaks &middot; headings"}}

    PDF ==> PM
    ST ==> AN
    RU -.->|"shapes the defaults<br/>before anyone sees them"| AN
    AN ==> UI
    AN ==> EM
    ED ==> EM
    EM ==> MD
    MD ==> GA
    PM -.->|"<b>the loop</b><br/>measured against the page it<br/>came from, not a reference"| GA
    ED -.->|"margin furniture becomes a rule;<br/>body wording stays put"| RU

    classDef source fill:#475569,stroke:#334155,stroke-width:2px,color:#f8fafc
    classDef regen fill:#94a3b8,stroke:#64748b,stroke-width:1px,color:#0f172a
    classDef precious fill:#f59e0b,stroke:#b45309,stroke-width:2px,color:#1c1917
    classDef gate fill:#10b981,stroke:#047857,stroke-width:2px,color:#052e16
    classDef step fill:#e0e7ff,stroke:#6366f1,stroke-width:1px,color:#1e1b4b

    class PDF,MD source
    class AN,RU regen
    class ED precious
    class GA gate
    class PM,ST,EM,UI step
```

- **Only `edits.json` is important**. It holds what you decided and nothing else does. This is where rules come from.

## The more technical: Workspaces, rules, and how learning works

A workspace is a directory. Folders are yours to organize however you like — mdgest mirrors them. Say you upload `invoice1.pdf` into an `invoices` folder:

    workspace/
      sources/invoices/invoice1.pdf            the source PDF, untouched
      markdown/invoices/invoice1.md            the output, same tree
      .mdgest/invoices/invoice1/
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

## Requirements

- `backend`: _uv_ (python) package / project manager
- `frontend`: _bun_ (package manager / runtime)

```bash
curl -fsSL https://astral.sh/uv/install.sh | bash
curl -fsSL https://bun.com/install | bash
```

## Tech stack

**mdgest**

- `python-multipart` for pdf uploads
- `pypdfium2` for pdf parsing
- `pilow`
- `fastapi`
- `uvicorn` python webserver
- `typer` CLI builder

**mdgest CI deps**

- `pytest`
- `ruff`
- `httpx`
- `pyinstaller`

`hatchling` over `setuptools` because hatchling has reproducable builds by default and hatchling config takes up less files. (only in `backend/pyproject.toml`).
Also, we could probably get away th `uv_build` as the backend, but we would lose the ability to do any version tagging in the future.

**webapp**

---

**[TBD] desktop app**

Install rust and cargo

```bash
curl https://sh.rustup.rs -sSf | sh
```

---
