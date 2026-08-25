# mdgest

**PDF to Markdown, page by page, with a person in the loop and a gate on the way out.**

Markdown is what an LLM agent can actually ground on: cheap to put in a prompt,
cheap to chunk, cheap to cite. Getting there from a PDF is the part everyone
does badly, because a converter that guesses wrong has no way to tell you.

mdgest works completely offline, has a UI and a CLI that do the same things, and
gets better at your documents the more of them you convert.

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
        UI["<b>UI &middot; CLI &middot; API</b><br/>numbered boxes on the page,<br/>the same numbers in the markdown"]
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

## Status

Being built up here one reviewable piece at a time. A working implementation
exists on the `spike/tauri` branch — a Python engine over pypdfium2 with a
FastAPI and typer face, a React UI, and a Tauri shell that carries the engine
as a packaged binary — and it is being carried across rather than merged, so
every part gets read again on the way in.

What is here so far:

| | |
|---|---|
| `engine/tests/fixtures/` | a synthetic two-document corpus, generated and reproducible |
| `engine/tests/golden/` | the markdown those fixtures must produce |
| `scripts/` | the checks CI runs, and a benchmark at real corpus scale |

## Building on it

```bash
curl -fsSL https://astral.sh/uv/install.sh | bash   # the engine needs uv
make setup
make check                                          # tests, ruff, and the conventions
```

Conventions, and the reasoning behind them: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
