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
  /** Files taken from other commits of `repo`, when one commit does not
   *  hold everything: a later one's ground truth for an earlier one's
   *  PDFs. */
  also?: { revision: string; files: RegExp }[];
  /** What every number of this benchmark is to be read with, when it is
   *  not the benchmark as published. */
  label?: string;
  /** The scorer's package and the version of it that scores: the one
   *  `<name>/pyproject.toml` installs, checked before each scoring. One
   *  installed from a repository is pinned by its commit, written after
   *  the version: "0.1.0 @ceab1548". */
  scorer: {
    package: string;
    version: string;
    /** For a scorer that is a repository of scripts and not a package:
     *  where it is, and the commit of it that is run. */
    git?: { url: string; commit: string };
  };
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
  {
    name: "readoc",
    repo: "lazyc/READoc",
    revision: "782bf954e4d9a31ae2bcfe14ff59f1f4b2467592",
    // The arXiv and GitHub subsets; the Zenodo one has no ground truth.
    files:
      /^(?:(?:arxiv|github)\.zip|(?:arxiv|github)_ground_truth\/[^/]+\.md)$/,
    scorer: {
      package: "READoc",
      version: "@afa04771",
      git: {
        url: "https://github.com/icip-cas/READoc",
        commit: "afa047715184ac319046ce0230a6109cd270e6fc",
      },
    },
  },
  {
    name: "omnidocbench",
    repo: "opendatalab/OmniDocBench",
    // The pages that were published as PDFs: v1.0's 981, the originals
    // and not the copies made from their images. The 670 pages v1.5 and
    // v1.6 added exist only as images, which mdgest cannot read.
    revision: "f5f559bddf50e36f7f9899d842d0006f13ce8afc",
    files: /^ori_pdfs\/.+\.pdf$/,
    // Scored against v1.6's ground truth, for those pages.
    also: [
      {
        revision: "aa1ee96d106dbe53d0ae59474d75c6e6d9b53fec",
        files: /^OmniDocBench\.json$/,
      },
    ],
    label: "v1.6 GT, 981-page PDF subset",
    scorer: { package: "omnidocbench-eval", version: "1.6.0 @7ddb8df4" },
  },
];

/** Every commit `b`'s data is pinned to, as one word: what a results line
 *  and the cache know a benchmark's data by. */
export const revisionOf = (b: Benchmark) =>
  [b.revision, ...(b.also ?? []).map((more) => more.revision)].join("+");

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
