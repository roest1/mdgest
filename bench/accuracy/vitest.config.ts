import { playwright } from "@vitest/browser-playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { defineConfig, mergeConfig, type Plugin } from "vitest/config";
import app from "../../vite.config.ts";
import type { Job } from "./job.ts";

// The converter's config: `convert.run.ts` in headless Chromium, over the
// app's own Vite config, so `src/…` resolves and pdf.js finds its worker,
// cmaps and fonts the way the app does. Nothing from `tests/` is in it, and
// `bun run test` never comes here. Started by `tools.ts`, which says what to
// convert in the file `BENCH_JOB` names.

/** `path` under `dir`, refused if it would climb out of it. */
function under(dir: string, path: string): string {
  const to = resolve(dir, path);
  if (!to.startsWith(resolve(dir) + sep)) throw new Error(`${path} is outside`);
  return to;
}

/** The converter's way to the disk, which a page has none of: the job, each
 *  PDF's bytes, and a place to put what it made of them. */
function benchFiles(): Plugin {
  return {
    name: "mdgest:bench-files",
    configureServer(server) {
      const at = process.env.BENCH_JOB;
      if (!at) return;
      const job = JSON.parse(readFileSync(at, "utf8")) as Job;
      let written = 0;
      server.middlewares.use("/__bench", (req, res, next) => {
        try {
          const url = new URL(req.url ?? "/", "http://bench");
          const path = url.searchParams.get("path") ?? "";
          if (url.pathname === "/job") {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(job));
          } else if (url.pathname === "/pdf") {
            res.setHeader("Content-Type", "application/pdf");
            res.end(readFileSync(under(job.pdfs, path)));
          } else if (url.pathname === "/out" && req.method === "PUT") {
            const chunks: Buffer[] = [];
            req.on("data", (chunk: Buffer) => chunks.push(chunk));
            // The body arrives after this handler has returned, so what
            // goes wrong with it is answered here, not by the catch below.
            const refuse = (cause: unknown) => {
              res.statusCode = 500;
              res.end(String(cause));
            };
            req.on("error", refuse);
            req.on("end", () => {
              try {
                const to = under(job.out, path);
                mkdirSync(dirname(to), { recursive: true });
                writeFileSync(to, Buffer.concat(chunks));
              } catch (cause) {
                refuse(cause);
                return;
              }
              if (
                path.endsWith(".md") &&
                ++written % 100 === 0 &&
                !process.env.BENCH_QUIET
              )
                console.log(`  ${written}/${job.files.length}`);
              res.end();
            });
          } else next();
        } catch (cause) {
          res.statusCode = 500;
          res.end(String(cause));
        }
      });
    },
  };
}

export default mergeConfig(
  app,
  defineConfig({
    plugins: [benchFiles()],
    test: {
      include: ["bench/accuracy/convert.run.ts"],
      // One test converts every PDF of the job; each PDF has its own limit.
      testTimeout: 24 * 60 * 60 * 1000,
      browser: {
        enabled: true,
        provider: playwright(),
        headless: true,
        instances: [{ browser: "chromium" }],
      },
    },
  }),
);
