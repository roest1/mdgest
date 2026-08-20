import { X } from "lucide-react";

const K = ({ children }: { children: React.ReactNode }) => <span className="kbd">{children}</span>;

/** The cheat sheet — floats over the panes until closed; the ? in the toolbar brings it back. */
export function HelpBar({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute top-12 right-3 z-30 max-w-sm glass rounded-xl shadow-2xl shadow-black/50 px-3 py-2.5 text-xs text-muted animate-fade-in">
      <div className="flex items-start gap-2">
        <span className="min-w-0 leading-relaxed">
          Select a box on the page or a line in the panel to change its shape.{" "}
          <span className="text-faint">
            Keys: <K>1</K>–<K>4</K> heading · <K>p</K> paragraph · <K>-</K> bullet · <K>n</K> numbered · <K>a</K> lettered · <K>r</K> roman · <K>b</K> bold · <K>i</K> italic · <K>[</K> <K>]</K> depth · <K>h</K> delete · <K>&lt;</K> <K>&gt;</K> page break · <K>⇧click</K> or sweep/lasso to select a group, then drag it · <K>⌘Z</K> undo
          </span>
        </span>
        <button className="ghost p-0.5 shrink-0" onClick={onClose} title="Hide — the ? button brings it back">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
