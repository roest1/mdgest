/** What `readPage` asks of pdf.js, over a stand-in page: the timing a real
 *  document cannot be made to show on demand.
 *
 * pdf.js registers a font only once the browser has loaded it, which can
 * be after the operator list that sent it has come back. The drawn cases
 * cannot catch a reader that asks too soon: their standard faces are never
 * embedded, so there is nothing to wait for. */

import { expect, test } from "vitest";
import type { PDFPageProxy } from "src/lib/pdf";
import { readPage } from "src/lib/read";

const H = 792;

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
  const viewport = {
    width: 612,
    height: H,
    transform: [1, 0, 0, -1, 0, H],
    convertToViewportPoint: (x: number, y: number) => [x, H - y],
  };
  return {
    pageNumber: 1,
    commonObjs,
    objs: commonObjs,
    getViewport: () => viewport,
    getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
    getAnnotations: async () => [],
    cleanup: () => true,
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
  } as unknown as PDFPageProxy;
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
