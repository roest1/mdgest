/** A benchmark's files, fetched once into the cache and checked against the
 *  pinned revision.
 *
 *  The list of files comes from Hugging Face's tree of that one commit,
 *  which names every file with a hash of its bytes: the git blob id for a
 *  file kept in git, the SHA-256 for one kept in LFS. Each file is checked
 *  against its hash as it arrives and only then moved into place, so what
 *  is in the cache is what the revision holds, whole, or is not there.
 *  `verified.json` is written last and says the fetch finished, and of
 *  what: with it, the next run touches nothing on the network, until the
 *  manifest asks for other files of the revision. Then the listing is
 *  read again and only the files not yet checked are fetched. */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDir } from "./cache.ts";
import { revisionOf, type Benchmark } from "./manifest.ts";

const HUB = "https://huggingface.co";
/** Downloads at once: enough to be quick, few enough to stay polite. */
const AT_ONCE = 8;
const TRIES = 5;

interface Entry {
  type: "file" | "directory";
  path: string;
  size: number;
  /** The git blob id: of the file, or of its LFS pointer. */
  oid: string;
  lfs?: { oid: string; size: number };
  /** The commit it is listed at: added here, not part of the listing. */
  revision: string;
}

interface Verified {
  repo: string;
  revision: string;
  /** What was asked for (`asked`): the fetch is of these and no others. */
  asked: string[];
  /** Each file fetched, and the hash it was checked against. */
  files: Record<string, string>;
}

/** What the manifest asks of `b`'s repo: each commit, and the files of
 *  it. */
const asked = (b: Benchmark) =>
  [b, ...(b.also ?? [])].map((at) => `${at.revision} ${at.files.source}`);

/** The hash the revision gives `entry`'s bytes: a file kept in LFS is
 *  named by their SHA-256; one kept in git, by git's hash of them. */
const hashOf = (entry: Entry) => entry.lfs?.oid ?? entry.oid;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A GET that waits out a rate limit or a passing failure and asks again. */
async function get(url: string): Promise<Response> {
  let problem = "";
  for (let attempt = 0; attempt < TRIES; attempt++) {
    if (attempt) await sleep(1000 * 2 ** attempt);
    let res: Response;
    try {
      res = await fetch(url, { redirect: "follow" });
    } catch (cause) {
      problem = String(cause);
      continue;
    }
    if (res.ok) return res;
    problem = `${res.status} ${res.statusText}`;
    if (res.status === 429) {
      // "ratelimit: ...;t=23": the seconds until the window opens again.
      const wait = /;t=(\d+)/.exec(res.headers.get("ratelimit") ?? "")?.[1];
      await sleep((Number(wait) || 30) * 1000);
    } else if (res.status < 500) break;
  }
  throw new Error(`${url}: ${problem}`);
}

/** Every file of `b.repo` at `revision` that `files` asks for. The tree
 *  comes a thousand entries at a time, the next page named in `Link`. */
async function listing(
  b: Benchmark,
  revision: string,
  files: RegExp,
): Promise<Entry[]> {
  const entries: Entry[] = [];
  let url: string | undefined =
    `${HUB}/api/datasets/${b.repo}/tree/${revision}?recursive=true&limit=1000`;
  while (url) {
    const res = await get(url);
    entries.push(...((await res.json()) as Entry[]));
    url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1];
  }
  const wanted = entries.filter((e) => e.type === "file" && files.test(e.path));
  if (!wanted.length)
    throw new Error(`${b.repo} at ${revision} has none of the files asked for`);
  return wanted.map((entry) => ({ ...entry, revision }));
}

/** `entry` downloaded to its place under `dir`, checked against the hash
 *  the revision gives it. Written as it arrives, since a file can be over
 *  a gigabyte, to a name beside its own, and moved into place only once
 *  the hash agrees. A download cut short is begun again. */
async function download(b: Benchmark, entry: Entry, dir: string) {
  const url = `${HUB}/datasets/${b.repo}/resolve/${entry.revision}/${entry.path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const to = join(dir, entry.path);
  await mkdir(dirname(to), { recursive: true });
  const want = hashOf(entry);
  let got = "";
  let problem = "";
  for (let attempt = 0; attempt < TRIES; attempt++) {
    // Git's hash is SHA-1 over a short header and the bytes.
    const hash = entry.lfs
      ? createHash("sha256")
      : createHash("sha1").update(`blob ${entry.size}\0`);
    try {
      const res = await get(url);
      const part = await open(`${to}.part`, "w");
      try {
        for await (const chunk of res.body!) {
          hash.update(chunk);
          await part.write(chunk);
        }
      } finally {
        await part.close();
      }
    } catch (cause) {
      // Kept to be said if every try ends this way: a full disk and a
      // dataset that wants a login are not the same thing to put right.
      problem = cause instanceof Error ? cause.message : String(cause);
      continue;
    }
    got = hash.digest("hex");
    if (got === want) {
      await rename(`${to}.part`, to);
      return want;
    }
  }
  throw new Error(
    got
      ? `${entry.path} is not the file at ${entry.revision.slice(0, 8)}: its hash is ${got}, the revision's is ${want}`
      : `${entry.path} could not be downloaded: ${problem}`,
  );
}

/** The folder `b`'s files are in, fetched first if they have not been. */
export async function fetchData(b: Benchmark): Promise<string> {
  const dir = dataDir(b);
  const marker = join(dir, "verified.json");
  const had = existsSync(marker)
    ? (JSON.parse(await readFile(marker, "utf8")) as Verified)
    : null;
  if (had && JSON.stringify(had.asked) === JSON.stringify(asked(b))) return dir;

  const entries = (
    await Promise.all(
      [b, ...(b.also ?? [])].map((at) => listing(b, at.revision, at.files)),
    )
  ).flat();
  // What an earlier fetch checked against the same hash is not fetched
  // again.
  const files: Record<string, string> = {};
  const todo = entries.filter((entry) => {
    const have =
      had?.files[entry.path] === hashOf(entry) &&
      existsSync(join(dir, entry.path));
    if (have) files[entry.path] = hashOf(entry);
    return !have;
  });
  const bytes = todo.reduce((sum, e) => sum + e.size, 0);
  console.log(
    `fetching ${b.repo} at ${revisionOf(b)
      .split("+")
      .map((revision) => revision.slice(0, 8))
      .join("+")}: ${todo.length} files, ${(bytes / 1e6).toFixed(0)} MB` +
      (had ? `; ${entries.length - todo.length} are here already` : ""),
  );

  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const entry = todo[next++];
      files[entry.path] = await download(b, entry, dir);
      if (++done % 200 === 0) console.log(`  ${done}/${todo.length}`);
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));

  const verified: Verified = {
    repo: b.repo,
    revision: revisionOf(b),
    asked: asked(b),
    files: Object.fromEntries(
      Object.entries(files).sort(([a], [z]) => (a < z ? -1 : 1)),
    ),
  };
  await writeFile(marker, `${JSON.stringify(verified, null, 2)}\n`);
  return dir;
}

/** The files a finished fetch checked, by path. */
export async function fetched(b: Benchmark): Promise<string[]> {
  const marker = join(dataDir(b), "verified.json");
  return Object.keys(
    (JSON.parse(await readFile(marker, "utf8")) as Verified).files,
  );
}
