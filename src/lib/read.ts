/** Reading a page with pdf.js: every line of text with its box and style,
 *  every picture with its drawn bounds and its pixels.
 *
 * Runs on the page's thread, where pdf.js already has the document open,
 * and hands what it reads to `structure.ts` for blocks and to the engine
 * to keep. pdf.js does the parsing in its own worker; what happens here is
 * geometry, joining, and drawing decoded images into a canvas for a PNG.
 *
 * Boxes come out in the analysis frame: points, origin top-left, y down,
 * rotation applied -- see analysis.ts. */

import { AnnotationMode, ImageKind, OPS, Util, type PDFPageProxy } from "pdfjs-dist";
import { union, type Box, type Line, type Picture } from "./analysis";
import type { Figure } from "./protocol";
import { BULLET_ONLY, MARKER_ONLY, type ReadPage } from "./structure";
import { figureName } from "./workspace";

export interface Read {
  page: ReadPage;
  figures: Figure[];
}

type Matrix = [number, number, number, number, number, number];

// ---- pdf.js internals this file reaches into -----------------------------------

/** `page.objs` and `page.commonObjs`: pdf.js's store of decoded things.
 *  Typed narrowly, to the two calls used. With a callback, `get` waits for
 *  the object to arrive from pdf.js's worker. */
interface Objects {
  has(id: string): boolean;
  get(id: string, callback?: (data: unknown) => void): unknown;
}

/** A decoded image as pdf.js hands it to its canvas: a bitmap where the
 *  browser could make one, packed pixels otherwise. */
interface ImageObj {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8ClampedArray | Uint8Array | null;
  bitmap?: ImageBitmap | null;
}

/** What `paintImageMaskXObject` carries: the mask's pixels, or the id they
 *  were sent under. */
interface MaskArg extends Omit<ImageObj, "data"> {
  data: string | Uint8ClampedArray | Uint8Array | null;
}

/** A loaded font, as pdf.js keeps it under the text items' `fontName`. */
interface FontObj {
  name?: string;
  bold?: boolean;
  italic?: boolean;
  black?: boolean;
}

function isImageObj(value: unknown): value is ImageObj {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ImageObj).width === "number" &&
    typeof (value as ImageObj).height === "number"
  );
}

/** How long to wait for pdf.js's worker to send an image the operator list
 *  named before giving up on its pixels and drawing the page region instead. */
const OBJECT_WAIT = 15_000;

function resolveObject(page: PDFPageProxy, id: string): Promise<unknown> {
  const objs = (id.startsWith("g_") ? page.commonObjs : page.objs) as unknown as Objects;
  if (objs.has(id)) return Promise.resolve(objs.get(id));
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), OBJECT_WAIT);
    objs.get(id, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// ---- geometry -------------------------------------------------------------------

function mul(a: Matrix, b: Matrix): Matrix {
  return Util.transform(a, b) as Matrix;
}

/** The box around `points`, in whatever frame they are in. */
function around(points: [number, number][]): Box {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function rounded(box: Box): Box {
  return { x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h) };
}

// ---- pictures -------------------------------------------------------------------

/** Below this, in points, an image is a rule or a glyph, not a figure. */
const MIN_PICTURE_PT = 4;
/** Below this many pixels an image is decoration -- a stretched bitmap
 *  rule -- unless it is drawn large on the page, where a few pixels blown
 *  up are still a picture. A single pixel never is. */
const MIN_PICTURE_PX = 64;
/** How large, in points each way, a few-pixel image has to be drawn to
 *  count as a picture anyway. */
const BIG_ENOUGH_PT = 24;
/** The most pixels a figure is written at, per side. */
const MAX_SIDE_PX = 4096;
/** The fewest pixels per point a figure is written at: enough for a mask or
 *  a small image to stay legible. */
const MIN_DENSITY = 2;

/** Where an image was drawn: its transform, and where its pixels are. */
interface Drawn {
  ctm: Matrix;
  source:
    | { kind: "object"; id: string }
    | { kind: "inline"; data: unknown }
    | { kind: "mask"; arg: MaskArg };
}

/** Walk the page's operators with the transform pdf.js's canvas would
 *  have at each, and note every image painted. Forms are inlined in the
 *  list between begin and end operators, which save and restore around
 *  their matrix; transparency groups save and restore too. */
async function findDrawn(page: PDFPageProxy): Promise<Drawn[]> {
  const { fnArray, argsArray } = await page.getOperatorList({
    annotationMode: AnnotationMode.DISABLE,
  });
  const found: Drawn[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  for (let i = 0; i < fnArray.length; i++) {
    const args = argsArray[i] as unknown[] | null;
    switch (fnArray[i]) {
      case OPS.save:
      case OPS.beginGroup:
        stack.push(ctm);
        break;
      case OPS.restore:
      case OPS.endGroup:
      case OPS.paintFormXObjectEnd:
        ctm = stack.pop() ?? ctm;
        break;
      case OPS.transform:
        ctm = mul(ctm, args as Matrix);
        break;
      case OPS.paintFormXObjectBegin: {
        stack.push(ctm);
        const m = args?.[0];
        if (Array.isArray(m) && m.length === 6) ctm = mul(ctm, m as Matrix);
        break;
      }
      case OPS.paintImageXObject:
        found.push({ ctm, source: { kind: "object", id: args![0] as string } });
        break;
      case OPS.paintImageXObjectRepeat: {
        const [id, sx, sy, positions] = args as [string, number, number, number[]];
        for (let k = 0; k + 1 < positions.length; k += 2) {
          found.push({
            ctm: mul(ctm, [sx, 0, 0, sy, positions[k], positions[k + 1]]),
            source: { kind: "object", id },
          });
        }
        break;
      }
      case OPS.paintInlineImageXObject:
        found.push({ ctm, source: { kind: "inline", data: args![0] } });
        break;
      case OPS.paintImageMaskXObject:
        found.push({ ctm, source: { kind: "mask", arg: args![0] as MaskArg } });
        break;
    }
  }
  return found;
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  return canvas;
}

/** A packed 1-bit image as pdf.js decodes it: rows padded to a byte, a
 *  clear bit black. `blank` is what a set bit becomes: white for an image,
 *  nothing for a mask. */
function unpackBits(src: Uint8Array | Uint8ClampedArray, w: number, h: number, blank: number): ImageData {
  const out = new ImageData(w, h);
  const px = new Uint32Array(out.data.buffer);
  const rowBytes = (w + 7) >> 3;
  const black = 0xff000000;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const byte = src[y * rowBytes + (x >> 3)] ?? 0xff;
      px[y * w + x] = byte & (0x80 >> (x & 7)) ? blank : black;
    }
  }
  return out;
}

/** The image's pixels as something a canvas can draw, or null for a shape
 *  this does not know. A mask's set pixels come out black on nothing. */
function sourceOf(img: ImageObj, mask: boolean): CanvasImageSource | null {
  const { width: w, height: h } = img;
  if (img.bitmap) {
    if (!mask) return img.bitmap;
    const canvas = canvasOf(w, h);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img.bitmap, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    return canvas;
  }
  const data = img.data;
  if (!data || typeof data === "string") return null;
  let pixels: ImageData;
  if (mask || img.kind === ImageKind.GRAYSCALE_1BPP) {
    pixels = unpackBits(data, w, h, mask ? 0 : 0xffffffff);
  } else if (img.kind === ImageKind.RGBA_32BPP && data.length >= w * h * 4) {
    pixels = new ImageData(w, h);
    pixels.data.set(data.subarray(0, w * h * 4));
  } else if (img.kind === ImageKind.RGB_24BPP && data.length >= w * h * 3) {
    pixels = new ImageData(w, h);
    for (let i = 0, j = 0; i < w * h * 3; i += 3, j += 4) {
      pixels.data[j] = data[i];
      pixels.data[j + 1] = data[i + 1];
      pixels.data[j + 2] = data[i + 2];
      pixels.data[j + 3] = 255;
    }
  } else {
    return null;
  }
  const canvas = canvasOf(w, h);
  canvas.getContext("2d")!.putImageData(pixels, 0, 0);
  return canvas;
}

async function png(canvas: HTMLCanvasElement): Promise<ArrayBuffer | null> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? blob.arrayBuffer() : null;
}

/** Draw the image as the page shows it -- through its transform, so a
 *  rotated or mirrored picture comes out the way it is seen -- at its own
 *  resolution, into a canvas the size of its bounds. */
function drawFigure(
  source: CanvasImageSource,
  box: Box,
  imageToPage: Matrix,
  srcW: number,
  srcH: number,
): HTMLCanvasElement {
  const cap = MAX_SIDE_PX / Math.max(box.w, box.h);
  const native = Math.sqrt((srcW * srcH) / (box.w * box.h));
  const s = Math.max(Math.min(native, cap), Math.min(MIN_DENSITY, cap));
  const canvas = canvasOf(box.w * s, box.h * s);
  const ctx = canvas.getContext("2d")!;
  const out = mul([s, 0, 0, s, -box.x * s, -box.y * s], imageToPage);
  // A few pixels blown up are squares, not a gradient: no smoothing once
  // each source pixel covers several of the output's, as the page draws it.
  ctx.imageSmoothingEnabled = Math.hypot(out[0], out[1]) < 4;
  ctx.setTransform(...out);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

/** The page region under `box`, rendered: what a picture falls back to
 *  when its pixels cannot be had on their own. */
async function drawRegion(page: PDFPageProxy, box: Box): Promise<HTMLCanvasElement> {
  const s = Math.min(3, MAX_SIDE_PX / Math.max(box.w, box.h));
  const canvas = canvasOf(box.w * s, box.h * s);
  const viewport = page.getViewport({ scale: s, offsetX: -box.x * s, offsetY: -box.y * s });
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

async function readPictures(page: PDFPageProxy): Promise<{ pictures: Picture[]; figures: Figure[] }> {
  const viewport = page.getViewport({ scale: 1 });
  const toPage = viewport.transform as Matrix;
  const pictures: Picture[] = [];
  const figures: Figure[] = [];
  const clip = { x: 0, y: 0, w: viewport.width, h: viewport.height };

  for (const drawn of await findDrawn(page)) {
    // The unit square under the transform is where the image lands.
    const m = mul(toPage, drawn.ctm);
    const corners = ([[0, 0], [1, 0], [0, 1], [1, 1]] as [number, number][]).map((p) => {
      Util.applyTransform(p, m); // in place
      return p;
    });
    let box = around(corners);
    // Clipped to the page: a scan pasted larger than its page is the page.
    const x = Math.max(box.x, clip.x);
    const y = Math.max(box.y, clip.y);
    box = {
      x,
      y,
      w: Math.min(box.x + box.w, clip.w) - x,
      h: Math.min(box.y + box.h, clip.h) - y,
    };
    if (box.w < MIN_PICTURE_PT || box.h < MIN_PICTURE_PT) continue;

    let img: ImageObj | null = null;
    let mask = false;
    const { source } = drawn;
    if (source.kind === "object") {
      const got = await resolveObject(page, source.id);
      img = isImageObj(got) ? got : null;
    } else if (source.kind === "inline") {
      img = isImageObj(source.data) ? source.data : null;
    } else {
      mask = true;
      const { arg } = source;
      const got = typeof arg.data === "string" ? await resolveObject(page, arg.data) : arg;
      img = isImageObj(got) ? got : null;
    }
    if (img) {
      const pixels = img.width * img.height;
      if (pixels <= 1) continue;
      if (pixels < MIN_PICTURE_PX && (box.w < BIG_ENOUGH_PT || box.h < BIG_ENOUGH_PT)) continue;
    }

    let canvas: HTMLCanvasElement;
    const pixels = img ? sourceOf(img, mask) : null;
    if (img && pixels) {
      const w = img.bitmap?.width ?? img.width;
      const h = img.bitmap?.height ?? img.height;
      // Image pixels fill the unit square top-down, the way pdf.js paints
      // them: (0,0) at the square's top-left.
      canvas = drawFigure(pixels, box, mul(m, [1 / w, 0, 0, -1 / h, 0, 1]), w, h);
    } else {
      canvas = await drawRegion(page, box);
    }
    const bytes = await png(canvas);
    if (!bytes) continue;
    const name = figureName(page.pageNumber, pictures.length);
    pictures.push({ box: rounded(box), path: name, px: [canvas.width, canvas.height] });
    figures.push({ name, bytes });
  }
  return { pictures, figures };
}

// ---- text -----------------------------------------------------------------------

/** A run of text as pdf.js reads it: one string in one font on one line, or
 *  a piece of one. */
interface Run {
  text: string;
  box: Box;
  size: number;
  bold: boolean;
  italic: boolean;
  font: string;
}

/** Runs whose vertical middles fall in one another's span, with at least
 *  this much of a run's height in the overlap, share a baseline. */
const BASELINE_OVERLAP = 0.5;
/** Runs closer than this (× the taller one's height) are one line... */
const JOIN_GAP_RATIO = 0.6;
/** ...and after a list marker, this much: the gap behind a bullet is wide. */
const MARKER_GAP_RATIO = 3;
/** A gap this wide (× height) between two runs of a line is a space. */
const SPACE_GAP_RATIO = 0.15;

function isMarker(text: string): boolean {
  const t = text.trim();
  return BULLET_ONLY.test(t) || MARKER_ONLY.test(t);
}

/** The font's own name without the subset prefix a PDF writer adds:
 *  `ABCDEF+Helvetica-Bold` is `Helvetica-Bold`. */
function fontName(raw: string | undefined): string {
  const name = raw ?? "";
  return name.includes("+") ? name.slice(name.indexOf("+") + 1) : name;
}

async function readRuns(page: PDFPageProxy): Promise<Run[]> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const commonObjs = page.commonObjs as unknown as Objects;
  const fonts = new Map<string, { font: string; bold: boolean; italic: boolean }>();
  const styleOf = (loadedName: string) => {
    let style = fonts.get(loadedName);
    if (style) return style;
    // The operator list has been read by now, which is what loads the fonts;
    // a font it did not send is not there, and the name says what it can.
    let obj: FontObj | null = null;
    try {
      if (commonObjs.has(loadedName)) obj = commonObjs.get(loadedName) as FontObj;
    } catch {
      obj = null;
    }
    const font = fontName(obj?.name);
    style = {
      font,
      bold: !!(obj?.bold || obj?.black) || /bold|black|heavy|semibold|demibold/i.test(font),
      italic: !!obj?.italic || /italic|oblique/i.test(font),
    };
    fonts.set(loadedName, style);
    return style;
  };

  const runs: Run[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !("transform" in item)) continue;
    const text = item.str.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const [a, b, c, d, e, f] = item.transform as Matrix;
    const size = item.height;
    if (!(size > 0)) continue;
    const style = content.styles[item.fontName];
    const ascent = style?.ascent > 0 ? style.ascent : 0.8;
    const descent = style?.descent < 0 ? style.descent : -0.2;
    // The run in its own frame: `width` along the text's x-axis, the font's
    // ascent and descent along its y-axis, both axes as `transform` lays
    // them, and its length is the font size.
    const at = (t: number, y: number): [number, number] => {
      const [vx, vy] = viewport.convertToViewportPoint(
        e + (t * a) / size + (y * c) / size,
        f + (t * b) / size + (y * d) / size,
      ) as [number, number];
      return [vx, vy];
    };
    const w = item.width;
    const box = around([
      at(0, descent * size),
      at(w, descent * size),
      at(0, ascent * size),
      at(w, ascent * size),
    ]);
    runs.push({ text, box, size, ...styleOf(item.fontName) });
  }
  return runs;
}

/** Runs on one baseline, top to bottom: bands of runs whose vertical
 *  middles fall within the band and which overlap it by half their height. */
function baselines(runs: Run[]): Run[][] {
  const bands: Run[][] = [];
  let span: [number, number] = [0, 0];
  for (const run of [...runs].sort((p, q) => p.box.y - q.box.y || p.box.x - q.box.x)) {
    const { y, h } = run.box;
    const middle = y + h / 2;
    const overlap = Math.min(span[1], y + h) - Math.max(span[0], y);
    if (bands.length && span[0] <= middle && middle <= span[1] && overlap >= BASELINE_OVERLAP * h) {
      bands[bands.length - 1].push(run);
      span = [Math.min(span[0], y), Math.max(span[1], y + h)];
    } else {
      bands.push([run]);
      span = [y, y + h];
    }
  }
  return bands;
}

/** A band's runs left to right, cut where the gap is wide enough to be a
 *  column, not a space. */
function neighbors(band: Run[]): Run[][] {
  const groups: Run[][] = [];
  let edge = 0;
  let previous: Run | null = null;
  for (const run of [...band].sort((p, q) => p.box.x - q.box.x)) {
    const ratio = previous && isMarker(previous.text) ? MARKER_GAP_RATIO : JOIN_GAP_RATIO;
    const reach = ratio * Math.max(previous?.box.h ?? 0, run.box.h);
    if (groups.length && run.box.x - edge <= reach) {
      groups[groups.length - 1].push(run);
      edge = Math.max(edge, run.box.x + run.box.w);
    } else {
      groups.push([run]);
      edge = run.box.x + run.box.w;
    }
    previous = run;
  }
  return groups;
}

/** One line from the runs that make it: the words joined, spaced where the
 *  page left a gap, and the style most of the characters have. */
function lineOf(group: Run[]): Line {
  let text = group[0].text;
  let box = group[0].box;
  let edge = box.x + box.w;
  for (const run of group.slice(1)) {
    const gap = run.box.x - edge;
    text += gap > SPACE_GAP_RATIO * Math.max(run.box.h, 1) ? ` ${run.text}` : run.text;
    box = union(box, run.box);
    edge = Math.max(edge, run.box.x + run.box.w);
  }
  const chars = (r: Run) => r.text.length;
  const total = group.reduce((n, r) => n + chars(r), 0);
  const bold = group.filter((r) => r.bold).reduce((n, r) => n + chars(r), 0) * 2 > total;
  const italic = group.filter((r) => r.italic).reduce((n, r) => n + chars(r), 0) * 2 > total;
  const most = group.reduce((p, q) => (chars(q) > chars(p) ? q : p));
  return {
    text: text.replace(/\s+/g, " ").trim(),
    box: rounded(box),
    size: Math.round(most.size * 10) / 10,
    bold,
    italic,
    font: most.font,
  };
}

async function readLines(page: PDFPageProxy): Promise<Line[]> {
  const runs = await readRuns(page);
  const lines: Line[] = [];
  for (const band of baselines(runs)) {
    for (const group of neighbors(band)) lines.push(lineOf(group));
  }
  return lines.sort((p, q) => p.box.y - q.box.y || p.box.x - q.box.x);
}

// ---- a page ---------------------------------------------------------------------

/** Everything on `page`. The pictures first: reading the operator list is
 *  what loads the page's fonts, which the text's styles are read from. */
export async function readPage(page: PDFPageProxy): Promise<Read> {
  const { width, height } = page.getViewport({ scale: 1 });
  const { pictures, figures } = await readPictures(page);
  const lines = await readLines(page);
  // The decoded images are the bulk of what pdf.js holds per page, and a
  // page being drawn keeps its own; this only frees what nothing is using.
  page.cleanup();
  return {
    page: { n: page.pageNumber, width: round(width), height: round(height), lines, pictures },
    figures,
  };
}
