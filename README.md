<p align="center">
  <img src="docs/brand/lockup-wide.svg" alt="mdgest" width="750">
</p>

<p align="center">
  <em>pdf to markdown converter, page by page, your data stays on your machine.</em>
</p>

# mdgest

Instead of one function that takes a `.pdf` and returns a `.md`, mdgest is an
offline pdf→md editor with a human in the loop: it reads every page in your
browser, shows each block it found beside the markdown it wrote, and lets you
fix the ones it got wrong. Nothing is uploaded anywhere — the conversion runs
in your browser, and the workspace lives in the browser's own storage. Drop in
a single pdf, a zip of pdfs, or a folder with pdfs in it.

[Try it!](https://mdgest.dev)

---

## Development

### Prerequisites

**bun**

```bash
curl -fsSL https://bun.com/install | bash
```

### Get Started

```bash
git clone https://github.com/roest1/mdgest.git && cd mdgest
bun install
bun run dev # http://127.0.0.1:2048, or set WEB_PORT
```

**CI jobs**:

1. `bun install --frozen-lockfile`
2. `bun run lint` (oxlint)
3. `bun run format:check` (prettier)
4. `bun run typecheck` (`tsc -b`),
5. `bun run build` (`tsc -b` then vite) after , on every push to `main` and every pull request.

### Tech stack

**web app deployment plan**: one bundle, hosted as static files on Cloudflare Pages.

|       |                                                                                          |
| ----- | ---------------------------------------------------------------------------------------- |
| build | `vite` (rolldown), `typescript`, `oxlint`                                                |
| ui    | `react`, `tailwind`                                                                      |
| fonts | Literata (serif), Geist Sans (ui), JetBrains Mono (code) - self-hosted via `@fontsource` |

---

MIT — see [LICENSE](LICENSE).
