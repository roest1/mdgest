/** Figures as object URLs: what is held, and what is let go.
 *
 * A URL made here lives until it is revoked or the page closes, and the
 * blob behind it lives with it. These say every one that stops being
 * reachable is revoked -- the figures of a scanned document are the largest
 * thing the editor holds, and a leak of them is invisible. */

import { afterEach, describe, expect, test, vi } from "vitest";
import { assetUrl, releaseAssets } from "src/lib/assets";
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
  test("reads it out once, and answers from what is held after", async () => {
    const asset = vi.spyOn(engine, "asset").mockResolvedValue(bytes("one"));
    const first = await assetUrl("doc", "a.png");
    expect(await readBack(first)).toBe("one");
    expect(await assetUrl("doc", "a.png")).toBe(first);
    expect(asset).toHaveBeenCalledTimes(1);
  });

  test("lets every one of a document's go when it leaves", async () => {
    vi.spyOn(engine, "asset").mockImplementation(async (_, name) =>
      bytes(name),
    );
    const [a, b] = await Promise.all([
      assetUrl("doc", "a.png"),
      assetUrl("doc", "b.png"),
    ]);
    expect(await readBack(a)).toBe("a.png");
    releaseAssets("doc");
    expect(await readBack(a)).toBeNull();
    expect(await readBack(b)).toBeNull();
  });

  test("is null for a figure the workspace does not have, asked once", async () => {
    const asset = vi.spyOn(engine, "asset").mockResolvedValue(null);
    expect(await assetUrl("doc", "gone.png")).toBeNull();
    // Nothing writes to a document's figures while it is open, so the
    // answer stands until the document leaves.
    expect(await assetUrl("doc", "gone.png")).toBeNull();
    expect(asset).toHaveBeenCalledTimes(1);
    releaseAssets("doc");
    asset.mockResolvedValue(bytes("back"));
    expect(await readBack(await assetUrl("doc", "gone.png"))).toBe("back");
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
