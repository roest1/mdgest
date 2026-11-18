import { execSync } from "node:child_process";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "../vitest.config.ts";

// The suite's config, pointed at the benchmarks: run by hand, never in CI
// (`bun run bench`; README.md says how).
//
// React is its production build unless BENCH_DEV is set: the development
// build's own bookkeeping -- it copies a component's changed props into
// the browser's performance timeline -- costs a long book many times what
// the app does, and is not what anyone using it runs. Read by the
// dependency optimizer, which bundles React for the one or the other; it
// is made to bundle afresh each run so a run never gets the other's.
const dev = !!process.env.BENCH_DEV;
process.env.NODE_ENV = dev ? "development" : "production";

const rev = (() => {
  try {
    const sha = execSync("git rev-parse --short HEAD").toString().trim();
    const dirty = execSync("git status --porcelain").toString().trim();
    return dirty ? `${sha}+changes` : sha;
  } catch {
    return "unknown";
  }
})();

const config = mergeConfig(
  base,
  defineConfig({
    define: {
      __BENCH__: JSON.stringify({ rev, build: dev ? "dev" : "production" }),
    },
    optimizeDeps: { force: true, include: ["fflate"] },
    test: { fileParallelism: false },
  }),
);
// Replaced, not merged: merging appends to the suite's.
config.test.include = ["bench/**/*.test.ts"];
export default config;
