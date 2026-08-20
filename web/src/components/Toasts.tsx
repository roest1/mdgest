import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useStore } from "../store";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`glass rounded-lg px-3 py-2 text-xs flex items-start gap-2 shadow-lg animate-toast-in transition-transform ${
            t.kind === "error" ? "border-red-700/60 text-red-200" : t.kind === "success" ? "border-emerald-700/60 text-emerald-200" : "text-ink"
          }`}
        >
          {t.kind === "error" ? <AlertCircle className="w-4 h-4 shrink-0" /> : t.kind === "success" ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <Info className="w-4 h-4 shrink-0" />}
          <span className="flex-1">{t.text}</span>
          <button onClick={() => dismiss(t.id)} className="text-muted hover:text-ink">
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
