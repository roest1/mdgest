import { useEffect, useRef } from "react";

/** Rows of a properties dialog, in groups set off by a rule. A null value
 *  is one the document does not have, shown as a dash. */
export type PropertyGroups = [string, string | null][][];

/** Document properties, for either pane: the PDF's from its three dots, the
 *  markdown's from its own. */
export function PropertiesDialog({
  groups,
  onClose,
}: {
  groups: PropertyGroups;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Whether the press that ends in a click began on the backdrop.
  const pressed = useRef(false);

  // Modal, so focus is held inside and Escape closes it; both come with
  // `showModal`, which only a mounted element can be asked for.
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      // A press on the backdrop lands on the dialog itself; one on its
      // contents lands on them. Both ends of the click, not only its
      // target: a selection dragged out of the contents and let go of over
      // the backdrop clicks the dialog too.
      onPointerDown={(e) => (pressed.current = e.target === e.currentTarget)}
      onClick={(e) =>
        pressed.current &&
        e.target === e.currentTarget &&
        dialog.current?.close()
      }
      aria-labelledby="properties-title"
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-2xl border border-edge bg-raised p-0 text-ink shadow-2xl shadow-black/60 backdrop:bg-black/60"
    >
      <div className="px-6 pb-5 pt-5">
        <h2 id="properties-title" className="mb-4 text-base font-medium">
          Document properties
        </h2>

        <div className="divide-y divide-edge-strong text-sm">
          {groups.map((rows, i) => (
            <dl
              key={i}
              className="grid grid-cols-[8.5rem_1fr] gap-x-4 gap-y-1.5 py-3 first:pt-0"
            >
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted">{label}:</dt>
                  <dd className="min-w-0 break-words">{value ?? "-"}</dd>
                </div>
              ))}
            </dl>
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            autoFocus
            onClick={() => dialog.current?.close()}
            className="cursor-pointer rounded-full bg-accent-lit/25 px-5 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent-lit/35"
          >
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
