import { RenderingCancelledException } from "pdfjs-dist";
import { useEffect, useRef } from "react";
import { useDevicePixelRatio } from "src/hooks/useDevicePixelRatio";
import type { PDFPageProxy } from "src/lib/pdf";
import type { Snapshots } from "./snapshots";

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
 * otherwise keep for every page ever drawn. A redraw at a new scale, or on
 * a screen of another pixel density, goes into a fresh canvas that replaces the old one when it is done, so zooming
 * stretches the last picture instead of flashing white.
 *
 * With `snapshots`, every finished render is published there, and with
 * `preview` a published one is drawn in place of rendering: right for a
 * thumbnail, whose resolution a snapshot already matches, so a page the
 * column has drawn costs the strip one `drawImage` -- and wrong for the
 * column, which needs the page at its real size. */
export function PageCanvas({
  page,
  scale,
  active,
  snapshots,
  preview = false,
}: {
  page: PDFPageProxy;
  scale: number;
  active: boolean;
  /** Where this document's finished renders are kept for the thumbnails. */
  snapshots?: Snapshots;
  /** Draw from a kept snapshot when there is one, render only otherwise. */
  preview?: boolean;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const dpr = useDevicePixelRatio();
  // The scale and device pixel ratio the canvas in the slot was drawn at;
  // null for an empty slot.
  const drawn = useRef<{ scale: number; dpr: number } | null>(null);

  useEffect(() => {
    const el = slot.current;
    if (!el) return;
    if (!active) {
      page.cleanup();
      el.replaceChildren();
      drawn.current = null;
      return;
    }
    if (drawn.current?.scale === scale && drawn.current.dpr === dpr) return;

    if (preview && snapshots) {
      const shot = snapshots.get(page.pageNumber);
      if (shot) {
        const canvas = blank(shot.width, shot.height);
        canvas.getContext("2d")?.drawImage(shot, 0, 0);
        el.replaceChildren(canvas);
        drawn.current = { scale, dpr };
        return;
      }
    }

    const viewport = page.getViewport({ scale });
    const fit = Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height));
    const out = Math.min(dpr, fit);
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
        drawn.current = { scale, dpr };
        snapshots?.put(page.pageNumber, canvas);
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
  }, [page, scale, dpr, active, snapshots, preview]);

  return <div ref={slot} className="absolute inset-0" />;
}
