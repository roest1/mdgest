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
4. `bun run typecheck` (`tsc -b`)
5. `bun run test` (vitest in headless Chromium, see [tests/README.md](tests/README.md))
6. `bun run build` (`tsc -b` then vite)

On every push to `main` and every pull request.

### Tech stack

**web app deployment plan**: one bundle, hosted as static files on Cloudflare Pages.

|       |                                                                                          |
| ----- | ---------------------------------------------------------------------------------------- |
| build | `vite` (rolldown), `typescript`, `oxlint`, `prettier` (formatting)                       |
| ui    | `react`, `tailwind`                                                                      |
| fonts | Literata (serif), Geist Sans (ui), JetBrains Mono (code) - self-hosted via `@fontsource` |

### Browser floor

Desktop browsers and tablets. Phones are turned away at load with a screen that
says so, before the app mounts: a phone runs out of memory far below the limits
in `limits.ts`, and the editor puts a page and its markdown side by side. A
phone is a touch-only device whose screen's short side is under 600 CSS px
(`IS_PHONE` in `main.tsx`).

| Requirement                      | Chrome / Edge | Firefox | Safari   |
| -------------------------------- | ------------- | ------- | -------- |
| OPFS with sync access handle     | **102**       | 111     | 15.2     |
| module worker (`type: "module"`) | 80            | **114** | 15       |
| Web Locks (`navigator.locks`)    | 69            | 96      | **15.4** |

The floor is the bold number in each column (`getDirectory` alone is Chrome
86; the handle is not). Dropping to a classic worker would need a bundled
script and would lower Firefox only to 111.

`pdfjs-dist` 6 declares no browser floor of its own — only a Node one, for its
build — so this table is the app's, worth re-measuring on a browser near its
bottom. `OffscreenCanvas` adds no row: figures are drawn on the main thread,
into an ordinary canvas. Nor does `FileSystemFileHandle.move()`, which
`edits.json` and the manifest are written through: Chrome 102, Firefox 111,
Safari 15.2, per MDN's compatibility data.

---

MIT — see [LICENSE](LICENSE).
