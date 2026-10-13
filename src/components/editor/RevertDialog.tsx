import { useEffect, useRef } from "react";
import { READER } from "src/lib/analysis";

/** Asks before a revert to original, which nothing takes back: undo lives
 *  in the edits it removes. Keep has the focus, so an Enter pressed out of
 *  habit keeps the work. */
export function RevertDialog({
  docId,
  read,
  onRevert,
  onClose,
}: {
  docId: string;
  /** The reader version the document's current reading was made by. */
  read: number;
  onRevert: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  // Modal, as the properties are: focus held inside, Escape closes it.
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
      aria-labelledby="revert-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-edge bg-raised p-0 text-ink shadow-2xl shadow-black/60 backdrop:bg-black/60"
    >
      <div className="px-6 pb-5 pt-5">
        <h2 id="revert-title" className="mb-3 text-base font-medium">
          Revert to original?
        </h2>
        <p className="text-sm text-muted">
          Every edit to <span className="break-all text-ink">{docId}</span> is
          dropped, its undo history with them, and the PDF is read again from
          the start. This cannot be undone. An export made beforehand is the
          only copy of the edits.
        </p>
        <p className="mt-3 text-sm text-muted">
          {read === READER
            ? `It was read by reader version ${read}, which is still the current version, so the new reading will match the one it has now.`
            : `It was read by reader version ${read}. The current reader is version ${READER}, so the new reading may divide the document into blocks differently.`}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              onRevert();
              dialog.current?.close();
            }}
            className="cursor-pointer rounded-full px-4 py-2 text-sm text-red-300 transition-colors hover:bg-red-500/15"
          >
            Revert
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => dialog.current?.close()}
            className="cursor-pointer rounded-full bg-accent-lit/25 px-5 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent-lit/35"
          >
            Keep
          </button>
        </div>
      </div>
    </dialog>
  );
}
