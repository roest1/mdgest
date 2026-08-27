import { Check, FileArchive, FolderOpen, Loader2, Package } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { isDesktop, pickExportTarget } from "../lib/desktop";
import { useStore } from "../store";
import type { ExportEntry } from "../types";
import { Modal } from "./Modal";

/**
 * Getting the markdown out of the workspace.
 *
 * On the desktop the workspace lives under the app's data directory, which is
 * a path nobody is going to find, so this is not a convenience over a folder
 * people can already reach — it is the only way out. The engine writes to the
 * chosen path directly rather than handing the webview a download, which the
 * webview has no way to accept and which would put a whole corpus through its
 * memory on the way.
 *
 * Selection is per document, never per file: a split document has several and
 * picking three of its four parts is not a thing anyone means.
 */
export function ExportPanel({ folder, onClose }: { folder: string; onClose: () => void }) {
  const toast = useStore((s) => s.toast);
  const [entries, setEntries] = useState<ExportEntry[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [asZip, setAsZip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dest, setDest] = useState("");

  useEffect(() => {
    let live = true;
    api
      .exportable(folder)
      .then((r) => {
        if (!live) return;
        setEntries(r.documents);
        // done means reviewed, so it is what an export means by default
        setPicked(new Set(r.documents.filter((d) => d.complete).map((d) => d.doc)));
      })
      .catch((e) => live && toast((e as Error).message, "error"));
    return () => {
      live = false;
    };
  }, [folder, toast]);

  const files = useMemo(
    () => (entries ?? []).filter((e) => picked.has(e.doc)).reduce((n, e) => n + e.files.length, 0),
    [entries, picked],
  );
  const allPicked = !!entries?.length && picked.size === entries.length;

  const toggle = (doc: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(doc)) next.add(doc);
      return next;
    });

  const run = async () => {
    let target = dest.trim();
    if (isDesktop) {
      const chosen = await pickExportTarget(asZip, folder ? folder.split("/").pop()! : "mdgest-markdown");
      if (!chosen) return;
      target = chosen;
    }
    if (!target) {
      toast("choose where to export to", "error");
      return;
    }
    setBusy(true);
    try {
      const r = await api.exportTo([...picked], target, asZip);
      toast(`exported ${r.documents} document(s), ${r.files} file(s) to ${r.dest}`, "success");
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <Package className="w-4 h-4 text-blue-300" /> Export markdown{folder ? ` — ${folder}` : ""}
        </span>
      }
      onClose={onClose}
      width="max-w-2xl"
    >
      <div className="flex items-center justify-between mb-2">
        <p className="font-display text-xs text-muted leading-relaxed">
          Documents marked done are picked for you. The folders come along, so the links between the files still resolve.
        </p>
        <button
          className="btn btn-sm shrink-0 ml-3"
          disabled={!entries?.length}
          onClick={() => setPicked(allPicked ? new Set() : new Set((entries ?? []).map((e) => e.doc)))}
        >
          {allPicked ? "deselect all" : "select all"}
        </button>
      </div>

      <div className="border border-edge rounded-lg max-h-[45vh] overflow-auto mb-3">
        {entries === null && (
          <p className="px-3 py-3 text-xs text-faint flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> reading the workspace
          </p>
        )}
        {entries?.length === 0 && <p className="px-3 py-3 text-xs text-faint">no markdown here yet</p>}
        {entries?.map((e) => (
          <button
            key={e.doc}
            className="w-full text-left px-3 py-1.5 border-b border-edge/60 last:border-b-0 flex items-start gap-2 text-xs hover:bg-raised/60"
            onClick={() => toggle(e.doc)}
          >
            <span
              className={`w-3.5 h-3.5 mt-0.5 rounded border shrink-0 flex items-center justify-center ${
                picked.has(e.doc) ? "bg-blue-500/80 border-blue-400" : "border-edge"
              }`}
            >
              {picked.has(e.doc) && <Check className="w-2.5 h-2.5 text-white" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-ink">{e.doc}</span>
              {e.files.length > 1 && <span className="text-faint"> · {e.files.length} parts</span>}
              <span className="text-faint"> · {e.words} words</span>
            </span>
            {e.complete && (
              <span className="text-[11px] text-emerald-300 font-mono shrink-0" title="marked done">
                done
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 mb-3">
        <button className={`btn btn-sm ${asZip ? "" : "btn-active"}`} onClick={() => setAsZip(false)}>
          <FolderOpen className="w-3 h-3" /> a folder of .md
        </button>
        <button className={`btn btn-sm ${asZip ? "btn-active" : ""}`} onClick={() => setAsZip(true)}>
          <FileArchive className="w-3 h-3" /> a .zip
        </button>
      </div>

      {!isDesktop && (
        <input
          className="w-full bg-ground border border-edge rounded px-2 py-1 text-xs text-ink outline-none focus:border-blue-500 mb-3 font-mono"
          placeholder={asZip ? "/path/to/markdown.zip" : "/path/to/a/directory"}
          value={dest}
          onChange={(ev) => setDest(ev.target.value)}
        />
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-faint">
          {picked.size} document{picked.size === 1 ? "" : "s"} · {files} file{files === 1 ? "" : "s"}
        </span>
        <button className="btn btn-primary" disabled={busy || !picked.size} onClick={run}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Package className="w-3 h-3" />} export
        </button>
      </div>
    </Modal>
  );
}
