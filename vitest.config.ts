import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// The app's own Vite config underneath, so tests resolve `src/…` and pdf.js
// finds its cmaps and fonts the way the app does. Tests run in headless
// Chromium: the reader needs a canvas and OPFS needs a real browser.
export default mergeConfig(
  viteConfig,
  defineConfig({
    // Pre-bundled together, up front. Found one import at a time on a cold
    // cache, `react` and `react-dom/client` are bundled apart, each with a
    // React of its own, and the first component to render fails on a hook.
    optimizeDeps: { include: ["react", "react-dom/client", "lucide-react"] },
    test: {
      include: ["tests/**/*.test.ts"],
      browser: {
        enabled: true,
        provider: playwright(),
        headless: true,
        instances: [{ browser: "chromium" }],
      },
    },
  }),
);
