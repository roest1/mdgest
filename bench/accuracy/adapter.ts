/** What a benchmark has to say for itself to be run: its inputs, what each
 *  should hold, and its scorer's verdict on a tool's markdown. One module
 *  per benchmark, `<benchmark>/adapter.ts`, exports these. Everything else
 *  -- the fetch, the converters, the split, the history -- is shared. */

import type { Benchmark } from "./manifest.ts";
import type { Quote } from "./split.ts";

/** An input: its PDF, as a path under `pdfs()`, and the category it is in,
 *  the name `--only` takes. */
export interface Input {
  file: string;
  category: string;
}

/** Passed and total, as the scorer counted them. */
export interface Tally {
  passed: number;
  total: number;
}

/** A scorer's verdict on one set of inputs. A benchmark of unit tests
 *  gives a score and, by category, the tests passed; one that measures a
 *  document against its ground truth gives measures. */
export interface Score {
  /** The inputs scored. */
  inputs: number;
  /** The benchmark's one number, 0 to 1, as its scorer works it out, when
   *  it works one out. */
  score?: number;
  tests?: number;
  /** The scorer's own breakdown, in tests. */
  categories?: Record<string, Tally>;
  /** What the scorer measured, each 0 to 1 and the mean over the inputs. */
  measures?: Record<string, number>;
  /** Inputs whose markdown the scorer would not take at all, scored as
   *  empty, when there are any. */
  refused?: number;
}

export interface Adapter {
  /** The folder the PDFs are in, given the folder the data was fetched to. */
  pdfs(data: string): string;
  /** Whatever the fetched data needs before it can be read: archives
   *  unpacked. Done once, and a no-op after. */
  prepare?(b: Benchmark, data: string): Promise<void>;
  /** Every input, sorted. */
  inputs(data: string): Promise<Input[]>;
  /** The text each input should hold, for the text-layer split. */
  quoted(data: string): Promise<Map<string, Quote[]>>;
  /** Score `tool`'s markdown, in `out`, on `files`. `set` names the folder
   *  in the cache the scorer is given and leaves its output in. */
  score(
    b: Benchmark,
    data: string,
    tool: string,
    out: string,
    files: string[],
    set: string,
  ): Promise<Score & { scorer: string }>;
}
