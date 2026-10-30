/** A document's figures as URLs an <img> can show.
 *
 * The workspace holds them as files in OPFS, which a page cannot address
 * by path, so each one is read out once and kept as an object URL until its
 * document leaves the editor -- as is the fact of a figure that is not
 * there, since nothing writes to a document's assets while it is open. A
 * figure read here was written by `read.ts` and carries a name it checked
 * -- and is shown as an image, never run. */

import { useEffect, useState } from "react";
import { engine } from "./engine";

/** By figure: its URL, or null for one the workspace does not have. */
const urls = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();
/** How many times each document has been let go. A read that lands after
 *  its document left the editor belongs to nothing, so what it carries is
 *  dropped rather than held: `releaseAssets` has already been past, and
 *  whatever it put in `urls` would be a blob nothing can show again. */
const era = new Map<string, number>();

const key = (docId: string, name: string) => `${docId}\n${name}`;

function keep(
  docId: string,
  name: string,
  bytes: BlobPart | null,
): string | null {
  const url =
    bytes && URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  const k = key(docId, name);
  // Whatever stood at this key is let go first. Two URLs on one figure is
  // a blob held for the life of the page with nothing left to show it.
  const had = urls.get(k);
  if (had) URL.revokeObjectURL(had);
  urls.set(k, url);
  return url;
}

/** Let go of `docId`'s figures: the URLs revoked, the blobs behind them
 *  free. For when the document leaves the editor -- its tab closed -- not
 *  when one pane unmounts, since the other may still be showing them. A
 *  figure asked for again is read out again. */
export function releaseAssets(docId: string): void {
  era.set(docId, (era.get(docId) ?? 0) + 1);
  const prefix = `${docId}\n`;
  for (const [k, url] of urls) {
    if (k.startsWith(prefix)) {
      if (url) URL.revokeObjectURL(url);
      urls.delete(k);
    }
  }
  // Reads still out are let go too. Each one lands in a past era and keeps
  // nothing; dropping them here means a document opened again reads afresh
  // rather than waiting on a read it will not keep.
  for (const k of [...pending.keys()])
    if (k.startsWith(prefix)) pending.delete(k);
}

/** Let go of every document's figures: for when the editor itself goes.
 *  Kept here, where what is held is known, rather than derived from what
 *  else the editor remembers of each document. */
export function releaseAllAssets(): void {
  const docs = new Set<string>();
  for (const k of [...urls.keys(), ...pending.keys()])
    docs.add(k.slice(0, k.indexOf("\n")));
  for (const docId of docs) releaseAssets(docId);
}

/** The URL of `name` under `docId`'s assets, or null when the workspace
 *  has no such file. */
export function assetUrl(docId: string, name: string): Promise<string | null> {
  if (!name) return Promise.resolve(null);
  const k = key(docId, name);
  if (urls.has(k)) return Promise.resolve(urls.get(k)!);
  let p = pending.get(k);
  if (!p) {
    const started = era.get(docId) ?? 0;
    const mine: Promise<string | null> = engine
      .asset(docId, name)
      .then((bytes) =>
        (era.get(docId) ?? 0) === started ? keep(docId, name, bytes) : null,
      )
      // Only if this read is still the one outstanding: `releaseAssets` may
      // have dropped it and a later read taken its place.
      .finally(() => {
        if (pending.get(k) === mine) pending.delete(k);
      });
    p = mine;
    pending.set(k, p);
  }
  return p;
}

/** `assetUrl` for a component: undefined while it is being read, then the
 *  URL, or null for a figure that is not there. What is answered is for the
 *  figure asked about now: asked about another, it is undefined again until
 *  that one is read, never the last one's URL. One already held is answered
 *  on the first render, with no render after. */
export function useAssetUrl(
  docId: string,
  name: string,
): string | null | undefined {
  const k = key(docId, name);
  const [got, setGot] = useState<{ k: string; url: string | null } | null>(
    null,
  );
  useEffect(() => {
    if (urls.has(k)) return;
    let live = true;
    assetUrl(docId, name).then(
      (url) => live && setGot({ k, url }),
      (cause: unknown) => {
        console.warn(cause);
        if (live) setGot({ k, url: null });
      },
    );
    return () => {
      live = false;
    };
  }, [docId, name, k]);
  return got?.k === k ? got.url : urls.has(k) ? urls.get(k) : undefined;
}
