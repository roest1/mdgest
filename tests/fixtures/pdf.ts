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
      /** Where the run is drawn: its baseline, raised. */
      y: number;
      /** The baseline it is raised off, which a run after it continues. */
      base: number;
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
  | { kind: "link"; x: number; y: number; w: number; h: number; url: string }
  | {
      kind: "inline";
      x: number;
      y: number;
      w: number;
      h: number;
      px: number;
      mask: boolean;
      shade: number;
    };

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
      base: y,
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
      y: last.base - (style.rise ?? 0),
      base: last.base,
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

  /** An inline image (`BI … EI`) of `px` × `px` pixels, drawn into the box
   *  at (`x`, `y`), top-left, between its own save and restore: the shape
   *  pdf.js merges into one operator when ten or more come in a row. A
   *  `mask` is a stencil painted black, which the same `shade` makes the
   *  same image -- pdf.js then repeats one mask rather than group several.
   *  Drawn after everything else on the page. */
  inline(
    x: number,
    y: number,
    w: number,
    h: number,
    { px = 16, mask = false, shade = 0 } = {},
  ): void {
    this.ops.push({ kind: "inline", x, y, w, h, px, mask, shade });
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

const hex = (n: number) => n.toString(16).padStart(2, "0");

/** The content-stream operators for one inline image, in hex. A mask's
 *  rows are bits padded to a byte, a clear bit painted; its `shade` sets
 *  which bits are, so that two shades are two images. */
function inlineImage(op: Extract<Op, { kind: "inline" }>): string {
  const { x, y, w, h, px, mask, shade } = op;
  const row = mask
    ? hex(shade & 0xff).repeat(Math.ceil(px / 8))
    : [90, 120, 160].map(hex).join("").repeat(px);
  const kind = mask ? "/IM true" : "/CS /RGB /BPC 8";
  return (
    `q ${w} 0 0 ${h} ${x} ${PAGE_H - y - h} cm\n` +
    `BI /W ${px} /H ${px} ${kind} /F /AHx ID\n${row.repeat(px)}>\nEI Q\n`
  );
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
    let inline = "";
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
      } else if (op.kind === "inline") {
        inline += inlineImage(op);
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
    if (inline)
      page.node.addContentStream(
        doc.context.register(doc.context.stream(inline)),
      );
  }
  const bytes = await doc.save();
  return new Uint8Array(bytes);
}
