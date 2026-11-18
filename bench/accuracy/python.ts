/** Running the suite's Python: each scorer and each peer tool is a small uv
 *  project under `bench/accuracy/` -- a `pyproject.toml` naming what it needs and a
 *  `uv.lock` pinning every package under that -- with an environment of
 *  its own in the cache, since their pins disagree. uv makes the
 *  environment from the lock on first use and leaves it alone after. */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { envDir } from "./cache.ts";
import type { Benchmark } from "./manifest.ts";

const BENCH = fileURLToPath(new URL(".", import.meta.url));

/** `python <args>` in the environment of `bench/accuracy/<project>`. What it prints
 *  is returned and its progress bars are dropped -- or, with `show`, both
 *  go to the terminal. One that fails says everything it had to say. */
export function python(project: string, args: string[], show = false): string {
  const ran = spawnSync(
    "uv",
    ["run", "--project", `${BENCH}${project}`, "--frozen", "python", ...args],
    {
      env: { ...process.env, UV_PROJECT_ENVIRONMENT: envDir(project) },
      stdio: show
        ? ["ignore", "inherit", "inherit"]
        : ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      maxBuffer: 1 << 30,
    },
  );
  if (ran.error) throw ran.error;
  if (ran.status !== 0)
    throw new Error(
      `python ${args.join(" ")} (bench/accuracy/${project}) ended with ${ran.status}` +
        (show
          ? ""
          : `:\n${ran.stdout.slice(-2000)}\n${ran.stderr.slice(-2000)}`),
    );
  return show ? "" : ran.stdout;
}

/** The version of `pkg` installed in the environment of
 *  `bench/accuracy/<project>`, with the commit it was installed from when
 *  it came from a repository: "0.1.0 @ceab1548". */
export function installed(project: string, pkg: string): string {
  return python(project, [
    "-c",
    [
      "import importlib.metadata as m, json",
      `d = m.distribution(${JSON.stringify(pkg)})`,
      "url = json.loads(d.read_text('direct_url.json') or '{}')",
      "commit = url.get('vcs_info', {}).get('commit_id')",
      "print(d.version + (' @' + commit[:8] if commit else ''))",
    ].join("\n"),
  ]).trim();
}

const checked = new Map<string, string>();

/** The scorer of `b`, as the history names it, once its environment at
 *  `bench/accuracy/<project>` is seen to hold the version the manifest
 *  pins. Checked once a process. */
export function scorerOf(b: Benchmark, project: string): string {
  let name = checked.get(project);
  if (!name) {
    const version = installed(project, b.scorer.package);
    if (version !== b.scorer.version)
      throw new Error(
        `the scorer is ${b.scorer.package} ${version}, the manifest says ${b.scorer.version}: bring ${project}/pyproject.toml and manifest.ts together`,
      );
    checked.set(project, (name = `${b.scorer.package} ${version}`));
  }
  return name;
}
