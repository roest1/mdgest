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

  /** How wide a snapshot is in device pixels, on the screen as it is now. */
  private wanted(): number {
    const out = Math.min(window.devicePixelRatio || 1, MAX_OUT);
    return Math.max(1, Math.round(this.width * out));
  }

  /** Keep a scaled-down copy of `source`, a finished render of page `n` --
   *  unless one already kept is as sharp as a snapshot gets. A copy, not the
   *  canvas itself: the caller's goes into its own view.
   *
   * Once per page, not once per render: a sharp scale-down of a page drawn
   * large costs the main thread about as much as drawing it, and a zoom
   * redraws every page in view. A page is copied again only when its
   * snapshot is too narrow for the screen -- taken from a render smaller
   * than a thumbnail, or before the window moved to a denser screen. */
  put(n: number, source: HTMLCanvasElement): void {
    const wanted = this.wanted();
    const kept = this.shots.get(n);
    if (kept && kept.width >= wanted) return;
    // Never scaled up: a thumbnail's own render can be narrower than this.
    const w = Math.min(source.width, wanted);
    if (kept && kept.width >= w) return;
    const h = Math.max(1, Math.round((source.height * w) / source.width));
    const copy = document.createElement("canvas");
    copy.width = w;
    copy.height = h;
    const ctx = copy.getContext("2d");
    if (!ctx) return;
    // The default quality samples a page drawn several times larger than
    // this too sparsely, and small text comes out as speckle.
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, w, h);
    this.shots.delete(n);
    this.shots.set(n, copy);
    if (this.shots.size > KEEP) {
      const oldest = this.shots.keys().next().value;
      if (oldest !== undefined) this.shots.delete(oldest);
    }
  }

  /** Page `n`'s snapshot, if a render of it has been kept that is sharp
   *  enough for the screen as it is now. Asking counts as a touch, so pages
   *  in sight stay ahead of eviction. */
  get(n: number): HTMLCanvasElement | undefined {
    const shot = this.shots.get(n);
    if (shot && shot.width < this.wanted()) return undefined;
    if (shot) {
      this.shots.delete(n);
      this.shots.set(n, shot);
    }
    return shot;
  }
}
