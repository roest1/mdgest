import { api } from "../api";
import { useStore } from "../store";
import type { DocView } from "../types";

/** Thumbnails down the side, numbered, the current page lit — a long PDF's map. */
export function PageRail({ docId, view }: { docId: string; view: DocView }) {
  const currentPage = useStore((s) => s.currentPage);
  const scrollTo = useStore((s) => s.scrollTo);
  const setCurrentPage = useStore((s) => s.setCurrentPage);
  return (
    <div className="h-full overflow-y-auto bg-chrome/50 border-r border-edge py-3 px-2 flex flex-col items-center gap-3">
      {view.pages.map((p) => {
        const active = p.n === currentPage;
        return (
          <button
            key={p.n}
            onClick={() => {
              setCurrentPage(p.n);
              scrollTo(`page:${p.n}`, "both");
            }}
            className="flex flex-col items-center gap-1 group"
            title={`page ${p.n}`}
          >
            <div className={`rounded-sm overflow-hidden border-2 transition-colors ${active ? "border-blue-400 shadow-lg shadow-blue-500/20" : "border-transparent group-hover:border-edge-strong"}`} style={{ width: 92, aspectRatio: `${p.width} / ${p.height}` }}>
              <img src={api.thumbUrl(docId, p.n)} alt="" className="w-full h-full object-cover bg-white" loading="lazy" draggable={false} />
            </div>
            <span className={`text-[11px] font-mono ${active ? "text-blue-300" : "text-faint"}`}>
              {p.n}
              {p.reordered ? "·" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
