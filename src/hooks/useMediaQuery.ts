import { useCallback, useMemo, useSyncExternalStore } from "react";

/** Subscribe to a CSS media query from JS.
 *
 * `useSyncExternalStore`, not useState/useEffect: an effect-based hook renders
 * once with its initial guess and corrects itself after, so a query that drives
 * *layout* flashes the wrong branch on first paint. This reads `matches` during
 * render instead.
 *
 * One MediaQueryList per `query`, not per render: `getSnapshot` runs on every
 * render and again whenever React checks for tearing, and it and `subscribe`
 * have to read the same object rather than two that happen to agree.
 *
 * The null branch is what keeps `window` untouched where there is no DOM, so
 * the server snapshot below is reachable rather than decorative — under a
 * DOM-less test runner "no viewport at all" answers `false` instead of
 * throwing.
 */
export function useMediaQuery(query: string): boolean {
  const mql = useMemo(
    () => (typeof window === "undefined" ? null : window.matchMedia(query)),
    [query],
  );

  const subscribe = useCallback(
    (onChange: () => void) => {
      mql?.addEventListener("change", onChange);
      return () => mql?.removeEventListener("change", onChange);
    },
    [mql],
  );

  return useSyncExternalStore(
    subscribe,
    () => mql?.matches ?? false,
    () => false,
  );
}
