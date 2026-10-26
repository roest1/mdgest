/** pdf.js, set up once for this app: where its worker and data files are. */

import {
  getDocument,
  PDFWorker,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export type { PDFDocumentProxy, PDFPageProxy };

/** pdf.js parses in a worker of its own, separate from the engine's. Started
 *  on the first open rather than at import, so the landing never pays for it,
 *  and the same one serves every document after. A module worker from a
 *  same-origin file, so a `worker-src 'self'` policy lets it start.
 *
 * Held here and handed to every `getDocument`, rather than set as
 * `GlobalWorkerOptions.workerPort`: a task given no worker takes the port's
 * as its own and tears it down on `destroy`, and any document opened before
 * that finishes -- the next tab, or a remount -- is refused outright. */
let worker: PDFWorker | null = null;
function ensureWorker(): PDFWorker {
  return (worker ??= PDFWorker.create({
    port: new Worker(workerUrl, { type: "module" }),
  }));
}

/** Where vite.config.ts serves the files pdf.js fetches by name. */
const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;

/** Start parsing `bytes`. The buffer is handed to pdf.js's worker, so it is
 *  empty here afterwards. */
export function openPdf(
  bytes: Uint8Array<ArrayBuffer>,
): PDFDocumentLoadingTask {
  return getDocument({
    data: bytes,
    worker: ensureWorker(),
    cMapUrl: `${ASSETS}cmaps/`,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    // The wasm decoders need a policy that grants `'wasm-unsafe-eval'`; the
    // plain-JS ones beside them do the same work without it. (The
    // `isEvalSupported` switch older guides pair with this is gone: pdf.js 6
    // no longer compiles anything with `new Function`.)
    useWasm: false,
    // Nothing in this app runs a PDF's JavaScript or fills its forms.
    enableXfa: false,
  });
}
