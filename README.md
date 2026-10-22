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

|          |                                                                                          |
| -------- | ---------------------------------------------------------------------------------------- |
| build    | `vite` (rolldown), `typescript`, `oxlint`, `prettier` (formatting)                       |
| ui       | `react`, `tailwind`, `lucide-react` icons                                                |
| fonts    | Literata (serif), Geist Sans (ui), JetBrains Mono (code) - self-hosted via `@fontsource` |
| archives | `fflate` - unzip on the way in, zip on the way out                                       |

### Browser floor

Desktop browsers and tablets. Phones are turned away at load with a screen that
says so, before the app mounts: a phone runs out of memory far below the limits
in `limits.ts`, and the editor puts a page and its markdown side by side. A
phone is a touch-only device whose screen's short side is under 600 CSS px
(`IS_PHONE` in `main.tsx`).

| Requirement                             | Chrome / Edge | Firefox | Safari |
| --------------------------------------- | ------------- | ------- | ------ |
| `pdfjs-dist` 6, legacy build (its FAQ)  | **125**       | **ESR** | **18** |
| OPFS with sync access handle            | 102           | 111     | 15.2   |
| `move()` replacing a file already there | 102           | 111     | 17.0   |
| module worker (`type: "module"`)        | 80            | 114     | 15     |
| Web Locks (`navigator.locks`)           | 69            | 96      | 15.4   |
| `Intl.Segmenter`                        | 87            | 125     | 14.1   |
| regex lookbehind                        | 62            | 78      | 16.4   |

The floor is the bold row: what pdf.js's own FAQ lists for its legacy build,
which is the build the app uses. Everything below it in the table is under
that floor, so the rest is a record of what else the app leans on, not of what
sets the floor. (`getDirectory` alone is Chrome 86; the handle is not.)

`OffscreenCanvas` adds no row: figures are drawn on the main thread, into an
ordinary canvas. `FileSystemFileHandle.move()` is what every text file is
written through (WebKit implemented it in October 2021; MDN does not list it),
and Safari made it replace a file already at its destination in 17.0. At the
floor, a move that refuses is reported as a failed write, with the file as it
was: there is no in-place fallback.

---

MIT — see [LICENSE](LICENSE).
