import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The SPA talks to /api on its own origin; in dev Vite forwards it to the
// engine (uvicorn). In prod the engine serves web/dist itself, so no rewrite.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss()],
  server: {
    // pin IPv4: `localhost` can resolve to ::1 only, and the tauri shell
    // polls (and devUrl names) http://127.0.0.1:5173
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      "/api": {
        target: process.env.MDGEST_API ?? "http://127.0.0.1:8770",
        changeOrigin: true,
      },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
