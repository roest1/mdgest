import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
