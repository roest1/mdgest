import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

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
    outDir: "dist",
    emptyOutDir: true,
    // Never inline an asset. The default 4 KB limit caught exactly one thing:
    // the JetBrains Mono Cyrillic-Extended subset, 2.4 KB gzipped, base64'd
    // into the render-blocking stylesheet for every visitor. A @font-face with
    // a unicode-range is fetched only when a glyph in that range is rendered,
    // so inlining it does not save a request — it creates one nobody needed.
    // Keeping this at 0 is also what lets public/_headers say `font-src 'self'`
    // with no `data:`.
    assetsInlineLimit: 0,
  },
});
