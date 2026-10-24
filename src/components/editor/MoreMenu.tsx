import { Check, EllipsisVertical } from "lucide-react";
import { useRef, useState } from "react";
import { useMenuDismiss } from "src/components/shared/useMenuDismiss";
import { iconButton } from "./controls";

/** One row of a menu, or the line between two groups of them. An item
 *  with `checked` is a toggle, drawn with a check while it is on. */
export type MenuItem =
  | {
      label: string;
      onPick?: () => void;
      checked?: boolean;
      disabled?: boolean;
    }
  | "divider";

const menuItem =
  "flex w-full cursor-pointer items-center gap-3 px-3 py-1.5 text-left text-ink enabled:hover:bg-edge disabled:cursor-default disabled:text-faint";

/** The three dots at the right of a pane's bar. Every item acts and
 *  closes the menu. */
export function MoreMenu({
  items,
  disabled,
}: {
  items: MenuItem[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useMenuDismiss(open, root, setOpen);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        title="More"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`${iconButton} ${open ? "text-ink" : ""}`}
      >
        <EllipsisVertical className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-20 mt-1 w-52 rounded-lg border border-edge bg-raised py-1 text-sm shadow-xl shadow-black/40"
        >
          {items.map((item, i) =>
            item === "divider" ? (
              <div key={i} role="separator" className="my-1 h-px bg-edge" />
            ) : (
              <button
                key={item.label}
                type="button"
                role={
                  item.checked === undefined ? "menuitem" : "menuitemcheckbox"
                }
                aria-checked={item.checked}
                disabled={item.disabled}
                onClick={() => {
                  item.onPick?.();
                  setOpen(false);
                }}
                className={menuItem}
              >
                <Check
                  className={`h-4 w-4 shrink-0 ${item.checked ? "" : "invisible"}`}
                />
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
