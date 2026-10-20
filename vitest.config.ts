import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// The app's own Vite config underneath, so tests resolve `src/…` and pdf.js
// finds its cmaps and fonts the way the app does. Tests run in headless
// Chromium: the reader needs a canvas and OPFS needs a real browser.
export default mergeConfig(
  viteConfig,
  defineConfig({
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
