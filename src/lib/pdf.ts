/** pdf.js, set up once for this app: where its worker and data files are,
 *  and what the page reads out of a document besides its pages.
 *
 * Everything a PDF says about itself -- title, author, outline entries -- is
 * written by whoever made the file. It comes out of here as plain strings and
 * is only ever rendered as text. */

import {
  getDocument,
  GlobalWorkerOptions,
  PDFDateString,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export type { PDFDocumentProxy, PDFPageProxy };

/** pdf.js parses in a worker of its own, separate from the engine's. Started
 *  on the first open rather than at import, so the landing never pays for it,
 *  and the same one serves every document after. A module worker from a
 *  same-origin file, which is what `worker-src 'self'` allows. */
function ensureWorker(): void {
  if (GlobalWorkerOptions.workerPort) return;
  GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: "module" });
}

/** Where vite.config.ts serves the files pdf.js fetches by name. */
const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;

/** Start parsing `bytes`. The buffer is handed to pdf.js's worker, so it is
 *  empty here afterwards. */
export function openPdf(bytes: Uint8Array<ArrayBuffer>): PDFDocumentLoadingTask {
  ensureWorker();
  return getDocument({
    data: bytes,
    cMapUrl: `${ASSETS}cmaps/`,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    // The wasm decoders need `'wasm-unsafe-eval'`, which public/_headers
    // does not grant; the plain-JS ones beside them do the same work. (The
    // `isEvalSupported` switch older guides pair with this is gone: pdf.js 6
    // no longer compiles anything with `new Function`.)
    useWasm: false,
    // Nothing in this app runs a PDF's JavaScript or fills its forms.
    enableXfa: false,
  });
}

// ---- properties -------------------------------------------------------------

export interface Properties {
  fileName: string;
  bytes: number;
  title: string | null;
  author: string | null;
  subject: string | null;
  keywords: string | null;
  created: Date | null;
  modified: Date | null;
  /** The program the document was written in (`Creator`). */
  application: string | null;
  /** The program that turned it into a PDF (`Producer`). */
  producer: string | null;
  version: string | null;
  pages: number;
  /** The first page, in points, as it is shown -- rotation applied. */
  pageSize: { width: number; height: number };
  fastWebView: boolean;
}

/** A string field of the info dictionary, or null when it is missing, not a
 *  string, or blank. The dictionary is whatever the file says it is. */
function text(info: Record<string, unknown>, key: string): string | null {
  const value = info[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function date(info: Record<string, unknown>, key: string): Date | null {
  const value = text(info, key);
  return value ? PDFDateString.toDateObject(value) : null;
}

/** `first` is the first page, which every caller has already asked for --
 *  handed in (a promise is fine) rather than fetched again here. */
export async function readProperties(
  doc: PDFDocumentProxy,
  fileName: string,
  bytes: number,
  first: PDFPageProxy | Promise<PDFPageProxy>,
): Promise<Properties> {
  const [{ info: raw, metadata }, page] = await Promise.all([doc.getMetadata(), first]);
  const info = raw as Record<string, unknown>;
  const { width, height } = page.getViewport({ scale: 1 });
  return {
    fileName,
    bytes,
    // The XMP title where there is one: it is what the authoring tool most
    // recently wrote, and the info dictionary is often left stale.
    title: metadata?.get("dc:title")?.trim() || text(info, "Title"),
    author: text(info, "Author"),
    subject: text(info, "Subject"),
    keywords: text(info, "Keywords"),
    created: date(info, "CreationDate"),
    modified: date(info, "ModDate"),
    application: text(info, "Creator"),
    producer: text(info, "Producer"),
    version: text(info, "PDFFormatVersion"),
    pages: doc.numPages,
    pageSize: { width, height },
    fastWebView: info.IsLinearized === true,
  };
}

// ---- outline ------------------------------------------------------------------

export interface OutlineNode {
  title: string;
  /** Unresolved: a named destination or an explicit one. Resolved on click,
   *  since a long outline would otherwise cost a round trip per entry up
   *  front. Null for entries that go nowhere in the document -- a web link. */
  dest: string | unknown[] | null;
  bold: boolean;
  italic: boolean;
  children: OutlineNode[];
}

type RawOutline = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>;

function outlineNodes(items: RawOutline): OutlineNode[] {
  return items.map((item) => ({
    title: item.title,
    dest: item.dest,
    bold: item.bold,
    italic: item.italic,
    children: outlineNodes(item.items ?? []),
  }));
}

export async function readOutline(doc: PDFDocumentProxy): Promise<OutlineNode[]> {
  return outlineNodes((await doc.getOutline()) ?? []);
}

/** Where a destination points: a 1-based page, and a height on it in PDF
 *  coordinates where the destination names one. Only the height: the pane
 *  scrolls a heading to the top of the view, never sideways. */
export interface Target {
  page: number;
  top: number | null;
}

/** What an outline entry points at, or null when it points at nothing this
 *  document has.
 *
 * An explicit destination is `[page, {name: kind}, ...args]`, the page being
 * a reference or, in some writers' output, an index. The kinds that name a
 * position (PDF 32000-1, 12.3.2.2) put it in different slots. */
export async function resolve(
  doc: PDFDocumentProxy,
  dest: string | unknown[] | null,
): Promise<Target | null> {
  const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || explicit.length === 0) return null;

  const [ref, kind, ...args] = explicit as [unknown, { name?: string } | undefined, ...unknown[]];
  let index: number;
  if (Number.isInteger(ref)) index = ref as number;
  else if (ref && typeof ref === "object") {
    try {
      index = await doc.getPageIndex(ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
    } catch {
      return null;
    }
  } else return null;
  if (index < 0 || index >= doc.numPages) return null;

  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  let top: number | null = null;
  switch (kind?.name) {
    case "XYZ":
      top = num(args[1]);
      break;
    case "FitH":
    case "FitBH":
      top = num(args[0]);
      break;
    case "FitR":
      top = num(args[3]);
      break;
  }
  return { page: index + 1, top };
}
