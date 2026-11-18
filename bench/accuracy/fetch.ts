/** A benchmark's files, fetched once into the cache and checked against the
 *  pinned revision.
 *
 *  The list of files comes from Hugging Face's tree of that one commit,
 *  which names every file with a hash of its bytes: the git blob id for a
 *  file kept in git, the SHA-256 for one kept in LFS. Each file is checked
 *  against its hash as it arrives and only then moved into place, so what
 *  is in the cache is what the revision holds, whole, or is not there.
 *  `verified.json` is written last and says the fetch finished: with it,
 *  the next run touches nothing on the network. */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDir } from "./cache.ts";
import type { Benchmark } from "./manifest.ts";

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
}

interface Verified {
  repo: string;
  revision: string;
  /** Each file fetched, and the hash it was checked against. */
  files: Record<string, string>;
}

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

/** Every file of `b.repo` at its revision that `b.files` asks for. The
 *  tree comes a thousand entries at a time, the next page named in `Link`. */
async function listing(b: Benchmark): Promise<Entry[]> {
  const entries: Entry[] = [];
  let url: string | undefined =
    `${HUB}/api/datasets/${b.repo}/tree/${b.revision}?recursive=true&limit=1000`;
  while (url) {
    const res = await get(url);
    entries.push(...((await res.json()) as Entry[]));
    url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1];
  }
  return entries.filter((e) => e.type === "file" && b.files.test(e.path));
}

/** The hash `entry` says its bytes have, and that hash of `bytes`. */
function hashes(entry: Entry, bytes: Uint8Array): [want: string, got: string] {
  if (entry.lfs)
    return [entry.lfs.oid, createHash("sha256").update(bytes).digest("hex")];
  const blob = createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes);
  return [entry.oid, blob.digest("hex")];
}

async function download(b: Benchmark, entry: Entry, dir: string) {
  const url = `${HUB}/datasets/${b.repo}/resolve/${b.revision}/${entry.path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const bytes = new Uint8Array(await (await get(url)).arrayBuffer());
  const [want, got] = hashes(entry, bytes);
  if (want !== got)
    throw new Error(
      `${entry.path} is not the file at ${b.revision.slice(0, 8)}: its hash is ${got}, the revision's is ${want}`,
    );
  const to = join(dir, entry.path);
  await mkdir(dirname(to), { recursive: true });
  await writeFile(`${to}.part`, bytes);
  await rename(`${to}.part`, to);
  return want;
}

/** The folder `b`'s files are in, fetched first if they have not been. */
export async function fetchData(b: Benchmark): Promise<string> {
  const dir = dataDir(b);
  const marker = join(dir, "verified.json");
  if (existsSync(marker)) return dir;

  const entries = await listing(b);
  if (!entries.length)
    throw new Error(
      `${b.repo} at ${b.revision} has none of the files asked for`,
    );
  const bytes = entries.reduce((sum, e) => sum + e.size, 0);
  console.log(
    `fetching ${b.repo} at ${b.revision.slice(0, 8)}: ${entries.length} files, ${(bytes / 1e6).toFixed(0)} MB`,
  );

  const files: Record<string, string> = {};
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < entries.length) {
      const entry = entries[next++];
      files[entry.path] = await download(b, entry, dir);
      if (++done % 200 === 0) console.log(`  ${done}/${entries.length}`);
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));

  const verified: Verified = {
    repo: b.repo,
    revision: b.revision,
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
