import { RefreshCw, Stamp, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { RuleLevel } from "../types";
import { Modal } from "./Modal";

/** What mdgest has learned on this document's path — root first, deepest (winning) last. */
export function RulesPanel({ docId, onClose }: { docId: string; onClose: () => void }) {
  const [stack, setStack] = useState<RuleLevel[] | null>(null);
  const applyRules = useStore((s) => s.applyRules);
  const toast = useStore((s) => s.toast);
  const load = useCallback(() => api.rules(docId).then((r) => setStack(r.stack)).catch((e) => toast((e as Error).message, "error")), [docId, toast]);
  useEffect(() => {
    load();
  }, [load]);
  const forget = async (folder: string, kind: string, key: string) => {
    await api.forgetRule(folder, kind, key);
    load();
  };
  const total = stack?.reduce((n, l) => n + l.shape.length + l.hide.length, 0) ?? 0;
  return (
    <Modal title={<span className="flex items-center gap-2"><Stamp className="w-4 h-4 text-amber-300" /> Learned rules on this path</span>} onClose={onClose} width="max-w-3xl">
      <p className="font-display text-xs text-muted mb-3 leading-relaxed">
        A rule is keyed by how a block is set on the page (size, weight, face, marker, indent) — not by its words — so it carries to the next document. A <em>hide</em> rule is keyed by the words, for running heads and footers. Deeper folders win over shallower ones. Rules shape a document when it is read; your edits always sit on top.
      </p>
      <div className="max-h-[55vh] overflow-auto space-y-3">
        {stack?.map((level) => (
          <div key={level.folder} className="border border-edge rounded-lg">
            <div className="px-3 py-1.5 text-xs font-mono text-ink/90 bg-chrome/60 rounded-t-lg flex items-center justify-between">
              <span>{level.folder || "(workspace)"}</span>
              <span className="text-faint">{level.shape.length} shape · {level.hide.length} hide</span>
            </div>
            {level.shape.length + level.hide.length === 0 && <p className="px-3 py-2 text-xs text-faint">nothing learned here yet</p>}
            {level.shape.map((r) => (
              <div key={r.key} className="px-3 py-1.5 border-t border-edge/60 flex items-start gap-2 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="text-ink">
                    → {Object.entries(r.fields).map(([k, v]) => `${k}=${String(v)}`).join(" ")}
                    <span className="text-faint"> · from {r.count} decision{r.count === 1 ? "" : "s"}</span>
                  </div>
                  <div className="text-faint font-mono truncate" title={r.key}>{r.key}</div>
                  <div className="text-faint truncate">e.g. “{r.example}” in {r.doc}</div>
                </div>
                <button className="p-1 text-faint hover:text-red-300" title="Forget this rule" onClick={() => forget(level.folder, "shape", r.key)}>
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            {level.hide.map((r) => (
              <div key={r.key} className="px-3 py-1.5 border-t border-edge/60 flex items-start gap-2 text-xs">
                <div className="flex-1 min-w-0">
                  <div className="text-ink">hide “{r.example}”</div>
                  <div className="text-faint font-mono truncate">{r.key}</div>
                </div>
                <button className="p-1 text-faint hover:text-red-300" title="Forget this rule" onClick={() => forget(level.folder, "hide", r.key)}>
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-3">
        <span className="text-xs text-faint">{total} rules apply to this document</span>
        <button className="btn" onClick={() => { applyRules(); onClose(); }} title="Re-read this document under the current rules (your edits stay on top)">
          <RefreshCw className="w-3 h-3" /> Re-read under rules
        </button>
      </div>
    </Modal>
  );
}
