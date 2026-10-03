import { useLayoutEffect, useState, type RefObject } from "react";

/** How far `inner` hangs below the bottom edge of `outer`, in px; 0 when it
 * does not, or when either is unmounted.
 *
 * For an element taken out of flow: the part of it that still sits inside
 * its container costs nothing, and only the overhang needs paying back to
 * whatever comes after. Both boxes are observed, because the overhang moves
 * when either resizes -- the inner as content changes, the outer with the
 * viewport.
 *
 * A layout effect rather than an effect so a spacer sized from this value is
 * right on the same frame the element appears, instead of one paint later.
 * `present` is the caller's word for whether `inner` is mounted at all: a ref
 * changing hands does not re-run an effect on its own. */
export function useOverhang(
  inner: RefObject<HTMLElement | null>,
  outer: RefObject<HTMLElement | null>,
  present: boolean,
): number {
  const [overhang, setOverhang] = useState(0);
  useLayoutEffect(() => {
    const a = inner.current;
    const b = outer.current;
    if (!a || !b) return;
    // No synchronous measure: an observer delivers one notification for each
    // target as soon as it is observed, which is the initial read.
    const ro = new ResizeObserver(() =>
      setOverhang(Math.max(0, a.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom)),
    );
    ro.observe(a);
    ro.observe(b);
    // `inner` also moves when the box it hangs from grows with neither of the
    // two resizing -- a drop zone whose message wraps pushes the listing down
    // inside a hero of fixed height -- so that box is watched as well.
    if (a.offsetParent) ro.observe(a.offsetParent);
    return () => ro.disconnect();
  }, [inner, outer, present]);
  // Derived at render rather than reset in the effect: when the inner element
  // is gone the answer is 0 by definition, and no measurement is needed.
  return present ? overhang : 0;
}
