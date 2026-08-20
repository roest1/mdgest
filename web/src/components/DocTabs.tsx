import { FileText, X } from "lucide-react";
import { useStore } from "../store";

export function DocTabs() {
  const openDocs = useStore((s) => s.openDocs);
  const activeDoc = useStore((s) => s.activeDoc);
  const setActive = useStore((s) => s.setActive);
  const closeDoc = useStore((s) => s.closeDoc);
  const docs = useStore((s) => s.docs);
  if (!openDocs.length) return null;
  return (
    <div className="flex items-end gap-0.5 px-2 overflow-x-auto h-9 bg-chrome shrink-0">
      {openDocs.map((id) => {
        const active = id === activeDoc;
        const v = docs[id];
        return (
          <div
            key={id}
            onClick={() => setActive(id)}
            onAuxClick={(e) => e.button === 1 && closeDoc(id)}
            title={id}
            className={`group flex items-center gap-1.5 px-3 h-8 rounded-t-md text-xs cursor-pointer select-none border border-b-0 max-w-[220px] ${
              active ? "bg-raised border-edge-strong/60 text-ink" : "bg-transparent border-transparent text-muted hover:text-ink hover:bg-raised/50"
            }`}
          >
            <FileText className={`w-3 h-3 shrink-0 ${v?.doc.edited ? "text-blue-300" : ""}`} />
            <span className="truncate">{id.split("/").pop()}.pdf</span>
            <button
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-edge text-muted hover:text-ink"
              onClick={(e) => {
                e.stopPropagation();
                closeDoc(id);
              }}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
