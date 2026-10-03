import { useEffect, type RefObject } from "react";

/** Close an open menu the two ways every menu closes: any press outside
 *  `root`, or Escape. `setOpen` is the state setter, which React keeps
 *  stable, so the listeners bind once per open. */
export function useMenuDismiss(
  open: boolean,
  root: RefObject<HTMLElement | null>,
  setOpen: (open: boolean) => void,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, root, setOpen]);
}
