import { RenderingCancelledException } from "pdfjs-dist";
import { useEffect, useRef } from "react";
import type { PDFPageProxy } from "src/lib/pdf";

/** The most device pixels one canvas is given, as pdf.js's own viewer caps
 *  it. Past this a page at high zoom stops getting sharper and starts costing
 *  hundreds of megabytes, and some browsers refuse the canvas outright. */
const MAX_PIXELS = 2 ** 24;

/** A canvas that fills the slot, ready to be drawn into. */
function blank(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  return canvas;
}

/** One page drawn at `scale` CSS px per point, filling its parent -- which
 *  sizes it, and should be positioned and white.
 *
 * Only drawn while `active`, and dropped when not, so a long document holds
 * canvases for the pages near the view rather than for all of them -- and
 * pdf.js the page's operator list and decoded images, which it would
 * otherwise keep for every page ever drawn. A redraw at a new scale goes
 * into a fresh canvas that replaces the old one when it is done, so zooming
 * stretches the last picture instead of flashing white. */
export function PageCanvas({
  page,
  scale,
  active,
}: {
  page: PDFPageProxy;
  scale: number;
  active: boolean;
}) {
  const slot = useRef<HTMLDivElement>(null);
  // The scale the canvas in the slot was drawn at; 0 for an empty slot.
  const drawn = useRef(0);

  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    if (!active) {
      page.cleanup();
      el.replaceChildren();
      drawn.current = 0;
      return;
    }
    if (drawn.current === scale) return;

    const viewport = page.getViewport({ scale });
    const fit = Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height));
    const out = Math.min(window.devicePixelRatio || 1, fit);
    const canvas = blank(
      Math.floor(viewport.width * out),
      Math.floor(viewport.height * out),
    );

    const task = page.render({
      canvas,
      viewport,
      transform: out === 1 ? undefined : [out, 0, 0, out, 0, 0],
    });
    task.promise.then(
      () => {
        el.replaceChildren(canvas);
        drawn.current = scale;
      },
      (cause: unknown) => {
        // Canceled is this effect's own cleanup. Anything else is a page
        // pdf.js could not draw, which stays blank rather than failing the
        // whole document; pdf.js has already said why in the console.
        if (!(cause instanceof RenderingCancelledException))
          console.warn(cause);
      },
    );
    return () => task.cancel();
  }, [page, scale, active]);

  return <div ref={slot} className="absolute inset-0" />;
}
