import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
});
