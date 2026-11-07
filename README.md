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

## Tech stack

What runs in your browser. Every file is served from the same origin as the
app — no CDN, no fonts or workers fetched from anywhere else.

|          |                                                                                          |
| -------- | ---------------------------------------------------------------------------------------- |
| ui       | `react`, `react-router`, `tailwind`, `lucide-react` icons                                |
| state    | `zustand` — one store for what both editor panes read                                    |
| pdf      | `pdfjs-dist` 6 - drawing pages and reading them; its worker, cmaps and fonts same-origin |
| markdown | `micromark` + GFM, a page at a time in workers; `hast-util-to-jsx-runtime` draws it      |
| fonts    | Literata (serif), Geist Sans (ui), JetBrains Mono (code) - self-hosted via `@fontsource` |
| archives | `fflate` - unzip on the way in, zip on the way out                                       |
| storage  | the browser's origin private file system (OPFS) — the workspace never leaves it          |

## Browser floor

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

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md): setup, scripts, what CI runs, and
what goes into the build.

---

MIT — see [LICENSE](LICENSE).
