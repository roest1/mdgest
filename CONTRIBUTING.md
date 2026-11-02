# Contributing

## Development

### Prerequisites

**bun**

```bash
curl -fsSL https://bun.com/install | bash
```

The version is pinned once, in `packageManager` in `package.json`; CI reads
it from there.

### Get started

```bash
git clone https://github.com/roest1/mdgest.git && cd mdgest
bun install
bun run dev # http://127.0.0.1:2048, or set WEB_PORT
```

### Scripts

| Command                | What it does                                                                    | CI  |
| ---------------------- | ------------------------------------------------------------------------------- | --- |
| `bun run dev`          | vite dev server on 127.0.0.1:2048 (`WEB_PORT` to change it)                     |     |
| `bun run lint`         | oxlint                                                                          | ✓   |
| `bun run format:check` | prettier, pinned exactly, every option spelled out in `.prettierrc.json`        | ✓   |
| `bun run format`       | prettier, writing the fixes                                                     |     |
| `bun run typecheck`    | `tsc -b`, on its own so a type error does not read as a build failure           | ✓   |
| `bun run test`         | vitest in headless Chromium, see [tests/README.md](tests/README.md)             | ✓   |
| `bun run test:watch`   | the same, re-run on save                                                        |     |
| `bun run build`        | `tsc -b`, then `vite build` into `dist/`                                        | ✓   |
| `bun run preview`      | serves `dist/` as it would be deployed                                          |     |
| `bun run fixtures`     | writes every reader case to `tests/out/` as a PDF, to look at or open in mdgest |     |

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs the ✓ rows in
that order, after `bun install --frozen-lockfile`, on every push to `main` and
every pull request.

### Tooling

|       |                                                                                       |
| ----- | ------------------------------------------------------------------------------------- |
| build | `vite` (rolldown), `typescript`                                                       |
| style | `tailwind` — a build-time compiler: the CSS it writes ships, the package does not     |
| check | `oxlint`, `prettier`                                                                  |
| tests | `vitest` in headless Chromium via `playwright`; `pdf-lib` draws the reader's fixtures |

None of these reach the browser. What runs there is the
[tech stack in the README](README.md#tech-stack).

## Build

```bash
bun run build
```

### What goes in

The build is what vite reaches, not a list of what to leave out:

- **the import graph from `index.html`** — everything `src/` imports, and the
  packages it imports, split into chunks (the editor and the engine worker
  are their own)
- **`public/`**, copied as it is: the favicon marks and the cursors
- **pdf.js's own files** — character maps, the standard fonts and the no-wasm
  fallback decoders, copied out of `pdfjs-dist` into `dist/pdfjs/` by the
  `pdfjsAssets` plugin in `vite.config.ts`. pdf.js fetches them only when a
  document needs one.

Nothing is inlined into the JS or CSS (`assetsInlineLimit: 0`): a font subset
stays a file, fetched only when a glyph in its `unicode-range` is drawn.

### What comes out

```
dist/
  index.html
  assets/      hashed JS, CSS and font files
  pdfjs/       cmaps/, standard_fonts/, wasm/
  cursors/     from public/
  mark.svg, mark-small.svg
```

### What stays out

`tests/`, `scripts/`, `docs/` and every devDependency — nothing in the import
graph reaches them. That is also why `dependencies` versus `devDependencies`
in `package.json` is not the answer to what ships: a package ships when
`src/` imports it.

## Deploy

Static files on Cloudflare Workers, set up through the dashboard. Each
setting gets written down here, with its value, as it is made.

<!-- build command, output directory, Bun version, caching headers, domain -->
