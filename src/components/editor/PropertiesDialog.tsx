import { useEffect, useRef } from "react";
import type { Properties } from "src/lib/pdf";
import { human } from "src/lib/words";

const when = (d: Date | null) =>
  d ? d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" }) : null;

/** Points to inches, which is what a page size is read in where the
 *  documents this is for are printed. */
function pageSize({ width, height }: Properties["pageSize"]): string {
  const inches = (pt: number) => (pt / 72).toFixed(2);
  const shape = width > height ? "landscape" : "portrait";
  return `${inches(width)} × ${inches(height)} in (${shape})`;
}

/** The document's own description of itself, as pdf.js reads it. Every value
 *  but the file name, size and page count is whatever the file claims, and is
 *  rendered as text. */
export function PropertiesDialog({
  properties,
  onClose,
}: {
  properties: Properties;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  // Modal, so focus is held inside and Escape closes it; both come with
  // `showModal`, which only a mounted element can be asked for.
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const p = properties;
  const groups: [string, string | null][][] = [
    [
      ["File name", p.fileName],
      ["File size", human(p.bytes)],
    ],
    [
      ["Title", p.title],
      ["Author", p.author],
      ["Subject", p.subject],
      ["Keywords", p.keywords],
      ["Created", when(p.created)],
      ["Modified", when(p.modified)],
      ["Application", p.application],
    ],
    [
      ["PDF producer", p.producer],
      ["PDF version", p.version],
      ["Page count", String(p.pages)],
      ["Page size", pageSize(p.pageSize)],
    ],
    [["Fast web view", p.fastWebView ? "Yes" : "No"]],
  ];

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      // A press on the backdrop lands on the dialog itself; one on its
      // contents lands on them.
      onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
      aria-labelledby="properties-title"
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-2xl border border-edge bg-raised p-0 text-ink shadow-2xl shadow-black/60 backdrop:bg-black/60"
    >
      <div className="px-6 pb-5 pt-5">
        <h2 id="properties-title" className="mb-4 text-base font-medium">
          Document properties
        </h2>

        <div className="divide-y divide-edge-strong text-sm">
          {groups.map((rows, i) => (
            <dl key={i} className="grid grid-cols-[8.5rem_1fr] gap-x-4 gap-y-1.5 py-3 first:pt-0">
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
