import { AlertTriangle, Check, Loader2, Stamp, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { CompletionCheck, DocView } from "../types";
import { Modal } from "./Modal";

/**
 * Saying a document is done — the one act that turns its edits into rules for
 * the folder, so `rules.json` holds decisions from finished documents and
 * nothing else.
 *
 * The checks report and never refuse. A document that lost three words on page
 * 9 still holds an hour of shape decisions, and blocking would strand those
 * along with the mistake.
 */
export function DonePanel({ view, onClose }: { view: DocView; onClose: () => void }) {
  const docId = view.doc.id;
  const complete = view.doc.complete;
  const busy = useStore((s) => s.busy);
  const setComplete = useStore((s) => s.setComplete);
  const [checks, setChecks] = useState<CompletionCheck[] | null>(null);
  const [folder, setFolder] = useState(() => (docId.includes("/") ? docId.slice(0, docId.lastIndexOf("/")) : ""));

  useEffect(() => {
    let live = true;
    api
      .checks(docId)
      .then((r) => live && setChecks(r.checks))
      .catch(() => live && setChecks([]));
    return () => {
      live = false;
    };
  }, [docId]);

  const folders = ancestorsOf(docId);
  const warnings = (checks ?? []).filter((c) => c.level !== "ok").length;

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-300" /> {complete ? "This document is done" : "Mark this document done"}
        </span>
      }
      onClose={onClose}
      width="max-w-xl"
    >
      <p className="font-display text-xs text-muted mb-3 leading-relaxed">
        Marking a document done records what you decided about it as rules for a folder, so the next document set the same
        way starts ahead. Nothing is learned before this — a level tried and abandoned on page 2 should not shape files
        nobody has opened.
      </p>

      <div className="border border-edge rounded-lg mb-3">
        <div className="px-3 py-1.5 text-xs font-mono text-ink/90 bg-chrome/60 rounded-t-lg flex items-center justify-between">
          <span>checks</span>
          <span className="text-faint">{checks === null ? "running" : warnings ? `${warnings} to look at` : "all clear"}</span>
        </div>
        {checks === null && (
          <p className="px-3 py-2 text-xs text-faint flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> scoring the markdown against the pages it came from
          </p>
        )}
        {checks?.map((c) => (
          <div key={c.name} className="px-3 py-1.5 border-t border-edge/60 flex items-start gap-2 text-xs">
            {c.level === "ok" ? (
              <Check className="w-3 h-3 mt-0.5 text-emerald-300 shrink-0" />
            ) : (
              <AlertTriangle className="w-3 h-3 mt-0.5 text-amber-300 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-ink">{c.name}</div>
              <div className="text-faint">{c.message}</div>
            </div>
          </div>
        ))}
        {checks?.length === 0 && <p className="px-3 py-2 text-xs text-faint">nothing to check yet</p>}
      </div>

      {!complete && (
        <label className="flex items-center gap-1.5 text-xs text-muted mb-4" title="Deeper folders win over shallower ones.">
          <Stamp className="w-3.5 h-3.5" />
          learn into
          <select
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="bg-ground border border-edge rounded px-1 py-0.5 text-xs text-ink outline-none focus:border-blue-500 max-w-[220px]"
          >
            {folders.map((f) => (
              <option key={f} value={f}>
                {f || "(workspace)"}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-faint">
          {view.edits.blocks} block decision{view.edits.blocks === 1 ? "" : "s"} on this document
        </span>
        {complete ? (
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              await setComplete(false);
              onClose();
            }}
            title="The rules it already taught stay; forgetting one is in the rules panel"
          >
            <Undo2 className="w-3 h-3" /> not done after all
          </button>
        ) : (
          <button
            className="btn btn-active"
            disabled={busy}
            onClick={async () => {
              await setComplete(true, folder);
              onClose();
            }}
          >
            <Check className="w-3 h-3" /> {warnings ? "mark done anyway" : "mark done"}
          </button>
        )}
      </div>
    </Modal>
  );
}

function ancestorsOf(docId: string): string[] {
  const parts = docId.split("/").slice(0, -1);
  const out = [""];
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}
