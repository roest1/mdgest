import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";

/** pdf.js fetches its character maps, the standard fourteen fonts and the
 *  no-wasm fallback decoders as files rather than bundling them. This copies
 *  them out of the package into `dist/pdfjs/` and serves them in dev from
 *  memory, so there is one list of them -- the `take` calls below -- and not
 *  a `public/` copy anyone has to remember to refresh. */
function pdfjsAssets(): Plugin {
  const pkg = new URL("./node_modules/pdfjs-dist/", import.meta.url);
  const files = new Map<string, URL>();
  const take = (dir: string, keep: (name: string) => boolean) => {
    for (const name of readdirSync(new URL(`${dir}/`, pkg))) {
      if (keep(name))
        files.set(`pdfjs/${dir}/${name}`, new URL(`${dir}/${name}`, pkg));
    }
  };
  take("cmaps", (n) => n.endsWith(".bcmap"));
  take("standard_fonts", (n) => /\.(pfb|ttf)$/.test(n));
  take("wasm", (n) => n.endsWith("_nowasm_fallback.js"));

  return {
    name: "mdgest:pdfjs-assets",
    configureServer(server) {
      // Read once and kept: a document can ask for many cmaps, and each
      // request should not block the dev server on the disk again.
      const cache = new Map<string, Buffer>();
      server.middlewares.use((req, res, next) => {
        // This runs on every dev request, and any of them can carry an
        // escape `decodeURIComponent` refuses; that is a miss, not an error.
        let key: string;
        try {
          key = decodeURIComponent((req.url ?? "").split("?")[0]).slice(1);
        } catch {
          return next();
        }
        const file = files.get(key);
        if (!file) return next();
        // The decoders are `import()`ed, and a module needs a script type.
        if (file.pathname.endsWith(".js"))
          res.setHeader("Content-Type", "text/javascript");
        let body = cache.get(key);
        if (!body) cache.set(key, (body = readFileSync(file)));
        res.end(body);
      });
    },
    generateBundle() {
      for (const [fileName, file] of files) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(file) });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), pdfjsAssets()],
  resolve: {
    // Dev-only crutch: `vite build` runs through rolldown, whose oxc resolver
    // reads `paths` out of tsconfig.app.json itself, but the dev server's
    // import-analysis does not. Drop this and every `from "src/…"` 404s in
    // dev while the production build stays green — which is the trap.
    alias: [
      {
        find: /^src\//,
        replacement: fileURLToPath(new URL("./src/", import.meta.url)),
      },
      // The markdown's parser decodes `&copy;` and its like with this
      // package, whose browser build makes an element to do it with -- at
      // import, so a worker, which has no `document`, fails to start, and
      // the markdown pane's parsing falls back to the page's thread. Its
      // `"worker"` export carries the table instead, but vite resolves a
      // worker's imports as the page's, in dev and build alike, so that
      // build is taken everywhere: its 12 KB (gzipped) of entities is the
      // price of one parser for both threads.
      {
        find: /^decode-named-character-reference$/,
        replacement: fileURLToPath(
          new URL(
            "./node_modules/decode-named-character-reference/index.js",
            import.meta.url,
          ),
        ),
      },
    ],
  },
  server: {
    // pin IPv4: `localhost` can resolve to ::1 only
    host: "127.0.0.1",
    // `||`, not `??`: an exported-but-empty WEB_PORT is Number('') === 0,
    // which means "pick a random port".
    port: Number(process.env.WEB_PORT) || 2048,
  },
  build: {
    // Never inline assets (default: under 4 KB). An inlined font subset is
    // base64'd into the render-blocking stylesheet for every visitor; as a
    // file, its unicode-range @font-face is fetched only when a glyph needs it.
    assetsInlineLimit: 0,
  },
});
