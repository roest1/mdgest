/** Drawing fixture PDFs: text at exact positions, in exact sizes and faces,
 *  so a case can sit a known distance either side of a threshold.
 *
 * Coordinates are the analysis frame's: points, origin top-left, y down. A
 * text's `y` is its baseline. Letter-size pages, the PDF standard faces, and
 * no metadata that changes per run, so a fixture written twice is the same
 * file. */

import { PDFDocument, PDFString, StandardFonts, type PDFFont } from "pdf-lib";
import { solidPng } from "./png";

export const PAGE_W = 612;
export const PAGE_H = 792;

export type Face =
  "regular" | "bold" | "italic" | "boldItalic" | "symbol" | "dingbats";

const FONTS: Record<Face, StandardFonts> = {
  regular: StandardFonts.Helvetica,
  bold: StandardFonts.HelveticaBold,
  italic: StandardFonts.HelveticaOblique,
  boldItalic: StandardFonts.HelveticaBoldOblique,
  symbol: StandardFonts.Symbol,
  dingbats: StandardFonts.ZapfDingbats,
};

export interface Style {
  size?: number;
  face?: Face;
  /** Points above the baseline the run is set on, as `Ts` raises a
   *  superscript. Negative for a subscript. */
  rise?: number;
}

type Op =
  /** `x` is a position, or `{ gap }` past where the run before it ends. */
  | {
      kind: "text";
      x: number | { gap: number };
      y: number;
      text: string;
      size: number;
      face: Face;
    }
  | {
      kind: "image";
      x: number;
      y: number;
      w: number;
      h: number;
      px: [number, number];
    }
  | { kind: "link"; x: number; y: number; w: number; h: number; url: string };

/** The body size every case sets its paragraphs in, unless it says otherwise. */
export const BODY = 10;
/** Baseline to baseline within a paragraph. */
export const LEADING = 12;
/** Baseline to baseline across a paragraph break: an ink gap far over the
 *  1.1 × line height that ends a paragraph. */
export const PARAGRAPH = 24;

/** What a case draws on one page. Records, then `buildPdf` lays it out. */
export class Pen {
  readonly ops: Op[] = [];

  /** One run of text, baseline at `y`. Returns `y`, for chaining. */
  text(x: number, y: number, text: string, style: Style = {}): number {
    this.ops.push({
      kind: "text",
      x,
      y: y - (style.rise ?? 0),
      text,
      size: style.size ?? BODY,
      face: style.face ?? "regular",
    });
    return y;
  }

  /** A run on the previous run's baseline, `gap` points past its end: for
   *  two runs of one line at a chosen distance apart. */
  then(gap: number, text: string, style: Style = {}): void {
    const last = this.ops.findLast((op) => op.kind === "text");
    if (!last) throw new Error("`then` needs a run before it");
    this.ops.push({
      kind: "text",
      x: { gap },
      y: last.y - (style.rise ?? 0),
      text,
      size: style.size ?? BODY,
      face: style.face ?? "regular",
    });
  }

  /** Lines stacked `leading` apart, the first baseline at `y`. Returns the
   *  last line's baseline. */
  lines(
    x: number,
    y: number,
    texts: string[],
    style: Style & { leading?: number } = {},
  ): number {
    const leading = style.leading ?? LEADING;
    texts.forEach((t, i) => this.text(x, y + i * leading, t, style));
    return y + (texts.length - 1) * leading;
  }

  /** A solid image of `px` pixels drawn into the box at (`x`, `y`), top-left. */
  image(
    x: number,
    y: number,
    w: number,
    h: number,
    px: [number, number],
  ): void {
    this.ops.push({ kind: "image", x, y, w, h, px });
  }

  /** A link annotation over the box at (`x`, `y`), top-left. */
  link(x: number, y: number, w: number, h: number, url: string): void {
    this.ops.push({ kind: "link", x, y, w, h, url });
  }
}

export type Draw = (pen: Pen) => void;

async function fonts(doc: PDFDocument): Promise<Record<Face, PDFFont>> {
  const entries = await Promise.all(
    (Object.keys(FONTS) as Face[]).map(
      async (f) => [f, await doc.embedFont(FONTS[f])] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<Face, PDFFont>;
}

export async function buildPdf(
  pages: Draw[],
): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const faces = await fonts(doc);
  for (const draw of pages) {
    const pen = new Pen();
    draw(pen);
    const page = doc.addPage([PAGE_W, PAGE_H]);
    let end = 0;
    for (const op of pen.ops) {
      if (op.kind === "text") {
        const font = faces[op.face];
        const x = typeof op.x === "number" ? op.x : end + op.x.gap;
        page.drawText(op.text, { x, y: PAGE_H - op.y, size: op.size, font });
        end = x + font.widthOfTextAtSize(op.text, op.size);
      } else if (op.kind === "image") {
        const img = await doc.embedPng(solidPng(op.px[0], op.px[1]));
        page.drawImage(img, {
          x: op.x,
          y: PAGE_H - op.y - op.h,
          width: op.w,
          height: op.h,
        });
      } else {
        const annot = doc.context.register(
          doc.context.obj({
            Type: "Annot",
            Subtype: "Link",
            Rect: [op.x, PAGE_H - op.y - op.h, op.x + op.w, PAGE_H - op.y],
            Border: [0, 0, 0],
            A: { Type: "Action", S: "URI", URI: PDFString.of(op.url) },
          }),
        );
        page.node.addAnnot(annot);
      }
    }
  }
  const bytes = await doc.save();
  return new Uint8Array(bytes);
}
