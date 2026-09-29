/** A document's figures as URLs an <img> can show.
 *
 * The workspace holds them as files in OPFS, which a page cannot address
 * by path, so each one is read out once and kept as an object URL for as
 * long as the page lives. A figure read here was written by `read.ts` and
 * carries a name it checked -- and is shown as an image, never run. */

import { useEffect, useState } from "react";
import { engine } from "./engine";

const urls = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

const key = (docId: string, name: string) => `${docId}\n${name}`;

function keep(docId: string, name: string, bytes: BlobPart): string {
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  urls.set(key(docId, name), url);
  return url;
}

/** Hold a figure the page has just made, before its bytes are handed to
 *  the engine: a copy, so the hand-over can empty the buffer. */
export function seedAsset(docId: string, name: string, bytes: ArrayBuffer): void {
  keep(docId, name, bytes.slice(0));
}

/** Let go of `docId`'s figures: the URLs revoked, the blobs behind them
 *  free. For when the document leaves the editor -- its tab closed, the
 *  walkthrough over -- not when one pane unmounts, since the other may
 *  still be showing them. A figure asked for again is read out again. */
export function releaseAssets(docId: string): void {
  const prefix = `${docId}\n`;
  for (const [k, url] of urls) {
    if (k.startsWith(prefix)) {
      URL.revokeObjectURL(url);
      urls.delete(k);
    }
  }
}

/** The URL of `name` under `docId`'s assets, or null when the workspace
 *  has no such file. */
export function assetUrl(docId: string, name: string): Promise<string | null> {
  if (!name) return Promise.resolve(null);
  const k = key(docId, name);
  const held = urls.get(k);
  if (held) return Promise.resolve(held);
  let p = pending.get(k);
  if (!p) {
    p = engine
      .asset(docId, name)
      .then((bytes) => (bytes ? keep(docId, name, bytes) : null))
      .finally(() => pending.delete(k));
    pending.set(k, p);
  }
  return p;
}

/** `assetUrl` for a component: null until it is known, and stays null for
 *  a figure that is not there. */
export function useAssetUrl(docId: string, name: string): string | null {
  const [url, setUrl] = useState<string | null>(() => urls.get(key(docId, name)) ?? null);
  useEffect(() => {
    let live = true;
    assetUrl(docId, name).then(
      (u) => live && setUrl(u),
      (cause: unknown) => console.warn(cause),
    );
    return () => {
      live = false;
    };
  }, [docId, name]);
  return url;
}
