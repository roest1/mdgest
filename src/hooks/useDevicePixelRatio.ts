import { useSyncExternalStore } from "react";

/** Device pixels per CSS px, kept current: it changes with the browser's
 *  zoom and when the window is moved to a screen of another density, and a
 *  canvas drawn for the old one is blurry or wastefully large on the new.
 *
 * There is no event for the ratio itself. A query for the ratio as it is
 * stops matching when it changes, and is then asked again for the new one. */
export function useDevicePixelRatio(): number {
  return useSyncExternalStore(
    subscribe,
    () => window.devicePixelRatio || 1,
    () => 1,
  );
}

function subscribe(onChange: () => void): () => void {
  let mql: MediaQueryList;
  const listen = () => {
    mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mql.addEventListener("change", changed, { once: true });
  };
  const changed = () => {
    listen();
    onChange();
  };
  listen();
  return () => mql.removeEventListener("change", changed);
}
