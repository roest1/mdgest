# mdgest

PDF to Markdown. The one missing feature to [pdf.net](https://pdf.net).

**Novelty of pdf content in markdown**: Inject content into prompts or RAG based-pipelines for downstream, text-based, LLM-agent things

<!-- **Novelty of our markdown conversion**: Provide a schema for citing and referencing parsed content to use with OpenAI SDK compatible things-->

PDF to Markdown converter. Works page-by-page, getting smarter the more you work with it. Works completely offline. Designed as dual-purpose, UI and CLI so you can accomplish all the things from anywhere.

---

## Quick Start

**Prerequisites**:

```bash
curl -fsSL https://bun.com/install | bash # install bun
curl -fsSL https://astral.sh/uv/install.sh | bash # install uv (CLI route only needs this)
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
The app in detail (blocks, rules, versions, CLI mirror): [docs/app.md](docs/app.md).
What has to be fixed before this branch lands: [docs/known-issues.md](docs/known-issues.md).

