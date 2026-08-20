import { Check, CornerDownRight, GitBranch, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { useStore } from "../store";
import type { DocView } from "../types";
import { Modal } from "./Modal";

/**
 * The saved states of this document's edits. The original is the page as
 * read; every version is a named snapshot with a parent; the working copy
 * continues from one of them. Going back is one click and undoable.
 */
export function VersionsPanel({ view, onClose }: { view: DocView; onClose: () => void }) {
  const saveVersion = useStore((s) => s.saveVersion);
  const checkout = useStore((s) => s.checkout);
  const deleteVersion = useStore((s) => s.deleteVersion);
  const busy = useStore((s) => s.busy);
  const [name, setName] = useState("");
  const v = view.versions ?? { base: null, dirty: false, versions: [] };
  const current = v.base;
  const hasChildren = (id: string) => v.versions.some((x) => x.parent === id);

  return (
    <Modal title={<span className="flex items-center gap-2"><GitBranch className="w-4 h-4" /> Versions</span>} onClose={onClose} width="max-w-xl">
      <p className="font-display text-xs text-muted mb-3 leading-relaxed">
        Save what you have as a named version; it becomes the successor of the one you're on. Click any version — or the original — to go back to it; that is undoable and loses nothing. Saving again from an older version starts a branch.
      </p>
      <div className="border border-edge rounded-lg max-h-[45vh] overflow-auto">
        <Row
          active={current === null}
          label="original"
          sub="the page as read, no edits"
          onClick={() => checkout(null)}
          busy={busy}
        />
        {v.versions.map((e) => (
          <Row
            key={e.id}
            depth={e.depth}
            active={current === e.id}
            label={`${e.id} · ${e.name}`}
            sub={`${e.created.slice(0, 16).replace("T", " ")} · ${e.edits.blocks} overrides · ${e.edits.order} pages reordered · ${e.edits.inserts} inserted${e.parent ? ` · from ${e.parent}` : " · from original"}`}
            onClick={() => checkout(e.id)}
            onDelete={hasChildren(e.id) ? undefined : () => deleteVersion(e.id)}
            busy={busy}
          />
        ))}
      </div>
      <form
        className="flex items-center gap-2 mt-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await saveVersion(name);
          setName("");
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`name this version (successor of ${current ?? "the original"})`}
          className="flex-1 bg-ground border border-edge-strong rounded px-2 py-1.5 text-sm text-ink outline-none focus:border-blue-500"
        />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          <Save className="w-3 h-3" /> Save version
        </button>
      </form>
      {v.dirty && <p className="text-xs text-amber-300/90 mt-2">The working copy has changes that are not in any saved version.</p>}
    </Modal>
  );
}

function Row({ depth = 0, active, label, sub, onClick, onDelete, busy }: { depth?: number; active: boolean; label: string; sub: string; onClick: () => void; onDelete?: () => void; busy: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 border-b border-edge/60 last:border-0 ${active ? "bg-blue-500/15" : "hover:bg-raised/60"}`} style={{ paddingLeft: 12 + depth * 16 }}>
      {depth > 0 && <CornerDownRight className="w-3 h-3 text-faint shrink-0" />}
      <button className="flex-1 text-left min-w-0" onClick={onClick} disabled={busy}>
        <div className={`text-xs ${active ? "text-blue-100" : "text-ink"} flex items-center gap-1`}>
          {active && <Check className="w-3 h-3" />}
          {label}
        </div>
        <div className="text-[11px] text-faint truncate">{sub}</div>
      </button>
      {onDelete && (
        <button className="p-1 text-faint hover:text-red-300" title="Delete this version" onClick={onDelete} disabled={busy}>
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
