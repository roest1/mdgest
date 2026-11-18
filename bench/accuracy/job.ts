/** What a converter is asked for and what it says back, as the files they
 *  are passed in: `job.json` in, `run.json` out. Shared by every converter,
 *  in the browser and in Python, and by the script that starts them. */

export interface Job {
  /** The folder the PDFs are in. */
  pdfs: string;
  /** The folder the markdown goes to: `<input>.md` for each input. */
  out: string;
  /** The PDFs to convert, as paths under `pdfs`. */
  files: string[];
  /** Also leave, for each PDF, its first page as a picture
   *  (`<input>.jpg`) and where the reader's blocks are on it
   *  (`<input>.blocks.json`, a `Drawn`): what the review report shows. */
  draw?: boolean;
  /** The file, under `out`, to say how it went in: `run.json`, or one of
   *  its own for each of several converters at work on one folder. */
  run: string;
}

/** One PDF of a job: its pages, the time its reading took, in ms, and why
 *  it could not be read, when it could not. */
export interface FileRun {
  pages: number;
  ms: number;
  error?: string;
}

/** How mdgest's conversion went. */
export interface MdgestRun {
  /** `READER`, and the pdf.js it was made with. */
  reader: number;
  pdfjs: string;
  files: Record<string, FileRun>;
}

/** How a peer's conversion went. */
export interface PeerRun {
  version: string;
  files: Record<string, FileRun>;
}

/** A page as the reader saw it, for the review report: its size, in
 *  points, and each block's box on it, with the number the markdown
 *  counts it by -- 0 for one that is written nowhere. */
export interface Drawn {
  width: number;
  height: number;
  blocks: {
    n: number;
    role: string;
    box: { x: number; y: number; w: number; h: number };
  }[];
}
