import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";

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
    // Never inline assets (default: under 4 KB). An inlined font subset is
    // base64'd into the render-blocking stylesheet for every visitor; as a
    // file, its unicode-range @font-face is fetched only when a glyph needs it.
    assetsInlineLimit: 0,
  },
});
