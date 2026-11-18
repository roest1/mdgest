/** Every benchmark the suite runs, and what pins it: the dataset and the
 *  commit of it the inputs are taken from, which of its files are fetched,
 *  and the version of its scorer. A score is only comparable with another
 *  made on the same three, so each results line names them, and changing
 *  one here starts a new series rather than moving an old one. */

export interface Benchmark {
  /** What it is run as: `bun run bench:accuracy <name>`. */
  name: string;
  /** The Hugging Face dataset its data is fetched from. */
  repo: string;
  /** The commit of `repo` the data is at, in full: a short one or a branch
   *  can come to mean other files. */
  revision: string;
  /** The files of `repo` that are fetched; the rest is left there. */
  files: RegExp;
  /** The scorer's package and the version of it that scores: the one
   *  `<name>/pyproject.toml` installs, checked before each scoring. One
   *  installed from a repository is pinned by its commit, written after
   *  the version: "0.1.0 @ceab1548". */
  scorer: { package: string; version: string };
}

export const BENCHMARKS: Benchmark[] = [
  {
    name: "olmocr",
    repo: "allenai/olmOCR-bench",
    revision: "54a96a6fb6a2bd3b297e59869491db4d3625b711",
    files: /^bench_data\/(?:[^/]+\.jsonl|pdfs\/.+\.pdf)$/,
    scorer: { package: "olmocr", version: "0.4.27" },
  },
  {
    name: "fr-bench",
    repo: "pulsia/fr-bench-pdf2md",
    revision: "7f1f8e7896474cea34a46c15a72a7be3c01e8c4b",
    files: /^pdfs\/.+\.(?:pdf|json|jsonl)$/,
    scorer: { package: "benchpdf2md", version: "0.1.0 @ceab1548" },
  },
];

export function benchmark(name: string): Benchmark {
  const found = BENCHMARKS.find((b) => b.name === name);
  if (!found)
    throw new Error(
      `no benchmark "${name}": there is ${BENCHMARKS.map((b) => b.name).join(", ")}`,
    );
  return found;
}

/** A page counts as one a reader can get right without OCR when the PDF's
 *  own text layer holds at least this share of what the page should say
 *  (`split.ts`). */
export const TEXT_LAYER_CUTOFF = 0.8;
