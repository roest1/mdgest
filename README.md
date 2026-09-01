<p align="center">
  <img src="docs/brand/lockup-wide.svg" alt="mdgest" width="420">
</p>

<p align="center">
  <em>pdf → markdown, page by page — offline, and measured back against the page it came from.</em>
</p>

<!-- ─────────────────────────────────────────────────────────────────────────
     BADGES. Each one is its own comment, so uncommenting is deleting the
     two markers around a single line. Four or five is the useful limit;
     past that a row reads as decoration and people discount all of them.

     Working today, nothing to configure:
-->
<!-- [![desktop](https://github.com/roest1/mdgest/actions/workflows/desktop.yml/badge.svg)](https://github.com/roest1/mdgest/actions/workflows/desktop.yml) -->
<!-- [![license](https://img.shields.io/github/license/roest1/mdgest?color=B01221)](LICENSE) -->
<!-- ![platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-B01221) -->
<!-- ![python](https://img.shields.io/badge/python-3.11%2B-B01221) -->
<!-- [![ruff](https://img.shields.io/badge/lint-ruff-B01221)](https://docs.astral.sh/ruff/) -->
<!-- [![tauri](https://img.shields.io/badge/built%20with-Tauri%202-B01221)](https://tauri.app) -->

<!-- Needs something set up first:

     release + downloads — only render once you cut a GitHub release
-->
<!-- [![release](https://img.shields.io/github/v/release/roest1/mdgest?color=B01221)](https://github.com/roest1/mdgest/releases/latest) -->
<!-- [![downloads](https://img.shields.io/github/downloads/roest1/mdgest/total?color=B01221)](https://github.com/roest1/mdgest/releases) -->

<!--  coverage — needs a Codecov account and an upload step in CI -->
<!-- [![coverage](https://img.shields.io/codecov/c/github/roest1/mdgest?color=B01221)](https://codecov.io/gh/roest1/mdgest) -->

<!--  OpenSSF Best Practices — a self assessment questionnaire; swap in your
      project id once registered at bestpractices.dev. Of everything here this
      is the strongest "someone thought about supply chain" signal.
-->
<!-- [![openssf](https://www.bestpractices.dev/projects/PROJECT_ID/badge)](https://www.bestpractices.dev/projects/PROJECT_ID) -->

<!--  OpenSSF Scorecard — add the scorecard workflow, then this scores itself -->
<!-- [![scorecard](https://api.securityscorecards.dev/projects/github.com/roest1/mdgest/badge)](https://scorecard.dev/viewer/?uri=github.com/roest1/mdgest) -->
<!-- OpenSSF Scorecard is more impressive than the badge passing because its a self-assessment questionaire. -->
<!-- An interesting tool to look into: google/oss-fuzz -->
<!-- SLSA provenance / sigstore-signed releases  for pypi packages, but this repo won't become one -->

<!-- ─────────────────────────────────────────────────────────────────────────
     BEYOND BADGES. What actually moves a reader from "interesting" to
     "I will run this on my own documents", roughly in order of payoff for
     a desktop app people have to download and trust:

     1. A screenshot, right under the lockup. For anything with a window this
        is worth more than every badge combined — you already have
        web/src/assets/hero.png sitting unused.
          <p align="center"><img src="docs/brand/screenshot.png" width="820"></p>

     2. Install, above the fold. Three platform links and a one-line CLI
        install, before the architecture. Right now a reader meets the
        mermaid diagram before they learn how to get it.

     3. Checksums on releases. "Works completely offline" is a security claim,
        and an unsigned binary from a stranger is the exact thing that claim
        asks people to run. A SHA256SUMS file per release, and a line saying
        how to verify, costs one CI step and reads as serious.

     4. SECURITY.md. GitHub gives it a tab and a "Report a vulnerability"
        button. Three sentences is enough.

     5. CITATION.cff. GitHub renders a "Cite this repository" button. You are
        pitching RAG and agent pipelines — that is a crowd who cites tooling
        in papers, and almost no comparable tool makes it easy.

     6. CHANGELOG.md, keepachangelog format. Tells a reader the project is
        maintained without them having to read commits.

     7. Issue and PR templates under .github/. Cheap, and the repo starts
        behaving like one that expects contributors.

     8. Prove the offline claim. A test that fails if the engine opens a
        socket turns your headline feature from an assertion into something
        CI enforces — then say so here. That is a differentiator no badge
        can buy.

     9. Table of contents. This file is past 130 lines and growing.

     10. CODE_OF_CONDUCT.md. Expected in any repo hoping for contributors.
-->

# mdgest

PDF to Markdown. The one missing feature to [pdf.net](https://pdf.net).

**Novelty of pdf content in markdown**: Inject content into prompts or RAG based-pipelines for downstream, text-based, LLM-agent things

<!-- **Novelty of our markdown conversion**: Provide a schema for citing and referencing parsed content to use with OpenAI SDK compatible things-->

PDF to Markdown converter. Works page-by-page, getting smarter the more you work with it. Works completely offline. The shaping happens in the UI, where the page is; the shell is for what a corpus needs — ingest a tree of PDFs, build the citation index, and gate the output in CI.

---

## How it works

Every other converter is a one-way pipe: PDF in, markdown out, and no way to
ask whether the markdown is right. mdgest is a loop. The words come off the
page and nowhere else, a person supplies the shape, and the output is measured
back against **the same page map it was read from** — never against a
hand-made reference copy, because a reference is itself unverified.

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

Two things the picture is trying to make unmissable:

- **Only one file is precious.** `edits.json` holds what a person decided and
  nothing else does. `analysis.json`, the page renders and the markdown all
  regenerate from the PDF, so losing them costs time and never costs a
  decision.
- **Nothing invents.** A block's text is read off the page and is not
  writable, so the only words that can reach the markdown another way are the
  ones a person typed — and those arrive labeled. A word in the output that
  is on no page and in no insert is a bug in mdgest, which is precisely what
  the gate reports.

---

## Quick Start

**Prerequisites**:

```bash
curl -fsSL https://bun.com/install | bash # install bun
curl -fsSL https://astral.sh/uv/install.sh | bash # install uv (the engine needs only this)
```

**Get the GUI Going**:

**Setup PDF Directory**:

This is where `.pdf` files you want to generate go. It's a folder. Any file-structure goes.

```bash
make add
```

```bash
make setup  # uv sync + bun install
```

1 `mdgest add` takes src filepath to a .zip or directory of .pdf files or to a single .pdf and creates a either a folder of markdown files or just a single markdown file (depending on the complexity of the upload). mdgest is preconfigured to heuristically size .md files based on content completeness and length (conscioenscious of tokens). Default directory `out/`

- `mdgest
  Every piece of text and every image is an indexed item that can be reordered via click-and-drag or manual index chnage.

Subgroups of text can be made and reordered via the click-and-drag.

Formatting that can be added:

- Headers: # H1, ## H2, ### H3
- **bold** / _italics_
- bullet lists: (`-`, `a.`, `1.`, `i.`)
- insert page break: ---

---

## Desktop app

The same product as one double-clickable install — a Rust (tauri) shell that
carries the engine inside it as a packaged binary. No Python, bun, or network
on the target machine.

```bash
make desktop-dev     # run it (packages the engine first)
make desktop-build   # AppImage / deb / rpm on Linux; dmg / nsis via CI
```

How the shell, the sidecar and the UI fit together: [docs/desktop.md](docs/desktop.md).
The app in detail (blocks, rules, versions, what the shell is for): [docs/app.md](docs/app.md).
What has to be fixed before this branch lands: [docs/known-issues.md](docs/known-issues.md).
