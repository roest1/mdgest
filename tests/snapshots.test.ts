/** What the thumbnails' snapshots keep: one per page, sharp enough for the
 *  screen, and a scale-down that does not turn fine detail into speckle. */

import { afterEach, expect, test } from "vitest";
import { Snapshots } from "src/components/editor/snapshots";

const ratio = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
const setRatio = (value: number) =>
  Object.defineProperty(window, "devicePixelRatio", {
    value,
    configurable: true,
  });
afterEach(() => {
  if (ratio) Object.defineProperty(window, "devicePixelRatio", ratio);
  else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
});

/** A render `width` device px wide, of a page's proportions. */
function render(
  width: number,
  paint?: (ctx: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round((width * 792) / 612);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  paint?.(ctx);
  return canvas;
}

test("a page is kept once, and not copied again for every render", () => {
  setRatio(1);
  const shots = new Snapshots(104);
  shots.put(1, render(816));
  const kept = shots.get(1);
  expect(kept?.width).toBe(104);
  // A zoom redraws the page larger: the snapshot already is as sharp as it
  // gets, so it stays.
  shots.put(1, render(3600));
  expect(shots.get(1)).toBe(kept);
});

test("a snapshot too narrow for the screen is not used, and is replaced", () => {
  setRatio(1);
  const shots = new Snapshots(104);
  // A render smaller than a thumbnail: kept, never scaled up, but not
  // handed out -- the thumbnail draws itself rather than stretch it.
  shots.put(1, render(80));
  expect(shots.get(1)).toBeUndefined();
  shots.put(1, render(816));
  expect(shots.get(1)?.width).toBe(104);
  // The window moves to a screen of twice the density.
  setRatio(2);
  expect(shots.get(1)).toBeUndefined();
  shots.put(1, render(1632));
  expect(shots.get(1)?.width).toBe(208);
});

test("fine detail scales down to its average, not to speckle", () => {
  setRatio(1);
  const shots = new Snapshots(104);
  // One-pixel black and white columns: averaged, a flat mid grey.
  shots.put(
    1,
    render(3600, (ctx) => {
      ctx.fillStyle = "black";
      for (let x = 0; x < 3600; x += 2) ctx.fillRect(x, 0, 1, 4659);
    }),
  );
  const shot = shots.get(1)!;
  const { data } = shot
    .getContext("2d")!
    .getImageData(0, 0, shot.width, shot.height);
  let off = 0;
  for (let i = 0; i < data.length; i += 4) off += Math.abs(data[i] - 128);
  expect(off / (data.length / 4)).toBeLessThan(16);
});
