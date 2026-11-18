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
