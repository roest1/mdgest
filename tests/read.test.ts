/** What `readPage` hands back beyond the blocks the drawn cases check: the
 *  style of a font still loading, and the pixels of a fallback picture.
 *
 * pdf.js registers a font only once the browser has loaded it, which can
 * be after the operator list that sent it has come back. The drawn cases
 * cannot catch a reader that asks too soon -- their standard faces are
 * never embedded, so there is nothing to wait for -- so that one runs over
 * a stand-in page. */

import { OPS } from "pdfjs-dist";
import { expect, test, vi } from "vitest";
import { openPdf, type PDFPageProxy } from "src/lib/pdf";
import { readPage } from "src/lib/read";
import { buildPdf } from "./fixtures/pdf";

const H = 792;

/** pdf.js's store of decoded things, holding nothing, ever: what a page
 *  whose objects never arrive looks like. */
const nothing = {
  has: () => false,
  get: (id: string, callback?: (data: unknown) => void) => {
    if (!callback) throw new Error(`${id} has not resolved yet`);
  },
};

/** A letter page with nothing on it, standing in for pdf.js's, with any
 *  of its parts replaced. */
function standIn(over: Record<string, unknown>): PDFPageProxy {
  const viewport = ({ scale = 1 }: { scale?: number } = {}) => ({
    width: 612 * scale,
    height: H * scale,
    transform: [scale, 0, 0, -scale, 0, H * scale],
    convertToViewportPoint: (x: number, y: number) => [
      x * scale,
      (H - y) * scale,
    ],
  });
  return {
    pageNumber: 1,
    commonObjs: nothing,
    objs: nothing,
    getViewport: viewport,
    getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
    getTextContent: async () => ({ items: [], styles: {} }),
    getAnnotations: async () => [],
    render: () => ({ promise: Promise.resolve() }),
    cleanup: () => true,
    ...over,
  } as unknown as PDFPageProxy;
}

/** A page of one line, "Safety Rules", in a bold face whose name says
 *  nothing about its weight -- only the font object does -- and which pdf.js
 *  registers `delay` ms after it is first asked for. */
function pageWithLateFont(delay: number): PDFPageProxy {
  const font = { name: "ABCDEF+Face2", bold: true };
  let arrived = false;
  const commonObjs = {
    has: (id: string) => id === "g_d0_f1" && arrived,
    get(id: string, callback?: (data: unknown) => void) {
      if (callback) {
        setTimeout(() => {
          arrived = true;
          callback(font);
        }, delay);
        return undefined;
      }
      if (!arrived) throw new Error(`${id} has not resolved yet`);
      return font;
    },
  };
  return standIn({
    commonObjs,
    getTextContent: async () => ({
      items: [
        {
          str: "Safety Rules",
          transform: [16, 0, 0, 16, 72, 700],
          width: 100,
          height: 16,
          fontName: "g_d0_f1",
          dir: "ltr",
          hasEOL: false,
        },
      ],
      styles: {
        g_d0_f1: { ascent: 0.9, descent: -0.2, vertical: false },
      },
    }),
  });
}

test("a font still loading is waited for, not read as regular", async () => {
  const { page } = await readPage(pageWithLateFont(50));
  expect(page.lines).toHaveLength(1);
  expect(page.lines[0]).toMatchObject({
    text: "Safety Rules",
    font: "Face2",
    bold: true,
  });
});

/** The RGB of the pixel at (`x`, `y`) in a PNG. */
async function pixel(png: ArrayBuffer, x: number, y: number) {
  const bitmap = await createImageBitmap(new Blob([png]));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  return [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
}

test("a picture with no pixels of its own is the page under it, in place", async () => {
  // The right half of the undecodable image's box is a solid picture, drawn
  // first; the left half is the page.
  const bytes = await buildPdf([
    (pen) => {
      pen.image(122, 100, 50, 100, [100, 60]);
      pen.undecodable(72, 100, 100, 100);
    },
  ]);
  const task = openPdf(bytes);
  try {
    const pdf = await task.promise;
    const { page, figures } = await readPage(await pdf.getPage(1));
    expect(page.pictures.map((p) => p.px)).toEqual([
      [100, 200],
      [300, 300],
    ]);
    const fallback = figures[1].bytes;
    // 3 pixels a point: the solid picture starts 150 pixels in.
    expect(await pixel(fallback, 146, 150)).toEqual([255, 255, 255]);
    expect(await pixel(fallback, 154, 150)).toEqual([90, 120, 160]);
  } finally {
    await task.destroy();
  }
});

test("images that never arrive are waited for together, not in turn", async () => {
  // Three images, each a box of the page, whose pixels pdf.js never sends.
  const ids = ["img_p0_1", "img_p0_2", "img_p0_3"];
  const page = standIn({
    getOperatorList: async () => ({
      fnArray: ids.flatMap(() => [
        OPS.save,
        OPS.transform,
        OPS.paintImageXObject,
        OPS.restore,
      ]),
      argsArray: ids.flatMap((id, i) => [
        null,
        [100, 0, 0, 100, 72 + i * 150, 500],
        [id, 64, 64],
        null,
      ]),
    }),
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let read: Awaited<ReturnType<typeof readPage>> | null = null;
  try {
    void readPage(page).then((r) => (read = r));
    // One wait's length: enough for all three, if they are waited for at
    // once, and for the first alone if one after another.
    await vi.advanceTimersByTimeAsync(15_000);
  } finally {
    vi.useRealTimers();
  }
  await vi.waitFor(() => expect(read).not.toBeNull(), { timeout: 2000 });
  expect(read!.page.pictures).toHaveLength(3);
});
