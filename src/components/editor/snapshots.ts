/** How many snapshots to hold. At two device pixels per CSS px a snapshot is
 *  a couple hundred kilobytes, so a hundred is some tens of megabytes -- a
 *  bounded price for a strip that redraws for free. */
const KEEP = 100;

/** How many device pixels per CSS px a snapshot keeps. Denser screens gain
 *  nothing a thumbnail can show. */
const MAX_OUT = 2;

export class Snapshots {
  /** By 1-based page number, oldest touch first -- the eviction order. */
  private shots = new Map<number, HTMLCanvasElement>();
  /** How wide a snapshot is, in CSS px: the thumbnails'. */
  private width: number;

  constructor(width: number) {
    this.width = width;
  }

  /** Keep a scaled-down copy of `source`, a finished render of page `n`.
   *  A copy, not the canvas itself: the caller's goes into its own view. */
  put(n: number, source: HTMLCanvasElement): void {
    const out = Math.min(window.devicePixelRatio || 1, MAX_OUT);
    // Never scaled up: a thumbnail's own render can be narrower than this.
    const w = Math.min(source.width, Math.max(1, Math.round(this.width * out)));
    const h = Math.max(1, Math.round((source.height * w) / source.width));
    const copy = document.createElement("canvas");
    copy.width = w;
    copy.height = h;
    const ctx = copy.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(source, 0, 0, w, h);
    this.shots.delete(n);
    this.shots.set(n, copy);
    if (this.shots.size > KEEP) {
      const oldest = this.shots.keys().next().value;
      if (oldest !== undefined) this.shots.delete(oldest);
    }
  }

  /** Page `n`'s snapshot, if a render of it has been kept. Asking counts as
   *  a touch, so pages in sight stay ahead of eviction. */
  get(n: number): HTMLCanvasElement | undefined {
    const shot = this.shots.get(n);
    if (shot) {
      this.shots.delete(n);
      this.shots.set(n, shot);
    }
    return shot;
  }
}
