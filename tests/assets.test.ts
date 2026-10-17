/** Figures as object URLs: what is held, and what is let go.
 *
 * A URL made here lives until it is revoked or the page closes, and the
 * blob behind it lives with it. These say every one that stops being
 * reachable is revoked -- the figures of a scanned document are the largest
 * thing the editor holds, and a leak of them is invisible. */

import { afterEach, describe, expect, test, vi } from "vitest";
import { assetUrl, releaseAssets, seedAsset } from "src/lib/assets";
import { engine } from "src/lib/engine";

const bytes = (text: string) => new TextEncoder().encode(text);

/** What a URL still answers with, or null once it is revoked. */
async function readBack(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const answer = await fetch(url);
    return answer.ok ? await answer.text() : null;
  } catch {
    return null;
  }
}

afterEach(() => {
  releaseAssets("doc");
  vi.restoreAllMocks();
});

describe("holding a figure", () => {
  test("lets the one it replaces go", async () => {
    seedAsset("doc", "a.png", bytes("one").buffer);
    const first = await assetUrl("doc", "a.png");
    expect(await readBack(first)).toBe("one");

    seedAsset("doc", "a.png", bytes("two").buffer);
    const second = await assetUrl("doc", "a.png");
    expect(second).not.toBe(first);
    expect(await readBack(second)).toBe("two");
    // The first URL is the only way to that blob, and nothing is pointed at
    // it any more.
    expect(await readBack(first)).toBeNull();
  });

  test("lets every one of a document's go when it leaves", async () => {
    seedAsset("doc", "a.png", bytes("one").buffer);
    seedAsset("doc", "b.png", bytes("two").buffer);
    const [a, b] = await Promise.all([assetUrl("doc", "a.png"), assetUrl("doc", "b.png")]);
    releaseAssets("doc");
    expect(await readBack(a)).toBeNull();
    expect(await readBack(b)).toBeNull();
  });
});

describe("a read still out when the document is let go", () => {
  test("keeps nothing, and is not answered from afterwards", async () => {
    let land: (bytes: Uint8Array<ArrayBuffer> | null) => void = () => {};
    const asset = vi
      .spyOn(engine, "asset")
      .mockImplementation(() => new Promise((resolve) => (land = resolve)));

    const reading = assetUrl("doc", "late.png");
    releaseAssets("doc");
    land(bytes("late"));
    // `releaseAssets` has already been past: a URL made now would be a blob
    // held for the life of the page with nothing to show it.
    expect(await reading).toBeNull();

    asset.mockResolvedValue(bytes("again"));
    expect(await readBack(await assetUrl("doc", "late.png"))).toBe("again");
    // Read afresh, not answered from the read that was dropped.
    expect(asset).toHaveBeenCalledTimes(2);
  });
});
