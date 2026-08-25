import {
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { DocSummary, TreeNode } from "../types";
import { DropZone } from "./DropZone";
import { Modal } from "./Modal";

const DRAG_DOC = "application/x-mdgest-doc";
const DRAG_FOLDER = "application/x-mdgest-folder";

export function Explorer() {
  const tree = useStore((s) => s.tree);
  const jobs = useStore((s) => s.jobs);
  const loadTree = useStore((s) => s.loadTree);
  const selectedFolder = useStore((s) => s.selectedFolder);
  const setSelectedFolder = useStore((s) => s.setSelectedFolder);
  const openDoc = useStore((s) => s.openDoc);
  const activeDoc = useStore((s) => s.activeDoc);
  const toast = useStore((s) => s.toast);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [newFolderIn, setNewFolderIn] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [rename, setRename] = useState<{ path: string; kind: "doc" | "folder"; name: string } | null>(null);
  const [indexPreview, setIndexPreview] = useState<{ folder: string; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ text: string; run: () => Promise<void> } | null>(null);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // poll while anything is analysing
  const pending = useMemo(() => Object.values(jobs).some((j) => j.status === "queued" || j.status === "running"), [jobs]);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(loadTree, 1000);
    return () => clearInterval(t);
  }, [pending, loadTree]);

  const upload = useCallback(
    async (files: File[], folder: string) => {
      try {
        const r = await api.upload(files, folder);
        toast(`${r.added.length} document${r.added.length === 1 ? "" : "s"} added`, "success");
        await loadTree();
        setExpanded((s) => new Set([...s, folder, ...ancestors(folder)]));
        if (r.added.length === 1) openDoc(r.added[0]);
      } catch (e) {
        toast(`upload failed: ${(e as Error).message}`, "error");
      }
    },
    [toast, loadTree, openDoc],
  );

  const toggle = (p: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const createFolder = async () => {
    if (!newFolderName.trim() || newFolderIn === null) return;
    const path = [newFolderIn, newFolderName.trim()].filter(Boolean).join("/");
    try {
      await api.mkdir(path);
      await loadTree();
      setExpanded((s) => new Set([...s, newFolderIn]));
      setSelectedFolder(path);
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setNewFolderIn(null);
    setNewFolderName("");
  };

  const doRename = async () => {
    if (!rename) return;
    const parent = rename.path.includes("/") ? rename.path.slice(0, rename.path.lastIndexOf("/")) : "";
    const dst = [parent, rename.name.trim()].filter(Boolean).join("/");
    try {
      await api.move(rename.path, dst);
      await loadTree();
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setRename(null);
  };

  const moveInto = async (src: string, kind: "doc" | "folder", folder: string) => {
    const name = src.split("/").pop()!;
    const dst = [folder, name].filter(Boolean).join("/");
    if (dst === src || (kind === "folder" && folder.startsWith(src))) return;
    try {
      await api.move(src, dst);
      await loadTree();
      const st = useStore.getState();
      if (kind === "doc" && st.openDocs.includes(src)) {
        st.closeDoc(src);
        st.openDoc(dst);
      }
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const buildIndex = async (folder: string) => {
    try {
      const r = await api.buildIndex(folder);
      setIndexPreview({ folder, text: r.markdown });
      await loadTree();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const renderFolder = (node: TreeNode, depth: number) => {
    const isRoot = node.path === "";
    const open = expanded.has(node.path);
    const selected = selectedFolder === node.path;
    return (
      <div key={node.path || "/"}>
        <Row
          depth={depth}
          selected={selected}
          onClick={() => {
            setSelectedFolder(node.path);
            if (!isRoot) toggle(node.path);
          }}
          draggable={!isRoot}
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_FOLDER, node.path);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const d = e.dataTransfer.getData(DRAG_DOC);
            const f = e.dataTransfer.getData(DRAG_FOLDER);
            if (d) return moveInto(d, "doc", node.path);
            if (f) return moveInto(f, "folder", node.path);
            if (e.dataTransfer.files.length) {
              upload(Array.from(e.dataTransfer.files), node.path);
            }
          }}
          icon={
            isRoot ? (
              <Database className="w-3.5 h-3.5 text-brand-green" />
            ) : open ? (
              <FolderOpen className="w-3.5 h-3.5 text-amber-300/90" />
            ) : (
              <Folder className="w-3.5 h-3.5 text-amber-300/70" />
            )
          }
          chevron={
            isRoot ? null : open ? <ChevronDown className="w-3 h-3 text-faint" /> : <ChevronRight className="w-3 h-3 text-faint" />
          }
          label={isRoot ? "workspace" : node.name}
          badge={node.has_index ? <span title="has INDEX.md" className="text-[10px] px-1 rounded bg-emerald-900/50 text-emerald-300 border border-emerald-800/50">idx</span> : null}
          menu={[
            { label: "New folder", icon: <FolderPlus className="w-3 h-3" />, run: () => setNewFolderIn(node.path) },
            { label: node.has_index ? "Rebuild index" : "Build index", icon: <Database className="w-3 h-3" />, run: () => buildIndex(node.path) },
            ...(isRoot
              ? []
              : [
                  { label: "Rename", icon: <Pencil className="w-3 h-3" />, run: () => setRename({ path: node.path, kind: "folder" as const, name: node.name }) },
                  {
                    label: "Delete folder",
                    icon: <Trash2 className="w-3 h-3" />,
                    danger: true,
                    run: () =>
                      setConfirm({
                        text: `Delete folder "${node.path}" and every document and markdown in it?`,
                        run: async () => {
                          await api.rmdir(node.path);
                          await loadTree();
                        },
                      }),
                  },
                ]),
          ]}
        />
        {(open || isRoot) && (
          <div>
            {node.folders.map((f) => renderFolder(f, depth + 1))}
            {node.docs.map((d) => renderDoc(d, depth + 1))}
            {isRoot && node.folders.length === 0 && node.docs.length === 0 && (
              <p className="text-xs text-faint px-3 py-2" style={{ paddingLeft: 12 + (depth + 1) * 12 }}>
                empty — drop a PDF below
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderDoc = (d: DocSummary, depth: number) => {
    const job = jobs[d.id];
    const working = job && (job.status === "queued" || job.status === "running");
    const failed = job?.status === "error";
    return (
      <Row
        key={d.id}
        depth={depth}
        selected={activeDoc === d.id}
        onClick={() => openDoc(d.id)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_DOC, d.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        icon={
          working ? (
            <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
          ) : (
            <FileText className={`w-3.5 h-3.5 ${failed ? "text-red-400" : d.edited ? "text-blue-300" : "text-muted"}`} />
          )
        }
        label={d.name + ".pdf"}
        badge={
          <span className="text-[11px] text-faint font-mono">
            {failed ? "error" : working ? job.status : d.pages != null ? `${d.pages}p` : ""}
            {d.edited ? " ·" : ""}
          </span>
        }
        menu={[
          { label: "Re-analyze", icon: <RefreshCw className="w-3 h-3" />, run: async () => { await api.reanalyze(d.id); loadTree(); } },
          { label: "Rename", icon: <Pencil className="w-3 h-3" />, run: () => setRename({ path: d.id, kind: "doc", name: d.name }) },
          {
            label: "Delete",
            icon: <Trash2 className="w-3 h-3" />,
            danger: true,
            run: () =>
              setConfirm({
                text: `Delete "${d.id}.pdf", its markdown and its edits?`,
                run: async () => {
                  await api.deleteDoc(d.id);
                  useStore.getState().closeDoc(d.id);
                  await loadTree();
                },
              }),
          },
        ]}
      />
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-edge/60">
        <span className="text-xs uppercase tracking-wider text-faint font-medium">Explorer</span>
        <div className="flex items-center gap-1">
          <button className="p-1 rounded hover:bg-raised text-muted" title="New folder in selected" onClick={() => setNewFolderIn(selectedFolder)}>
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button className="p-1 rounded hover:bg-raised text-muted" title="Refresh" onClick={() => loadTree()}>
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1 text-xs">{tree ? renderFolder(tree, 0) : <p className="px-3 py-2 text-faint">connecting…</p>}</div>
      <div className="p-2 border-t border-edge/60">
        <DropZone compact folder={selectedFolder} onFiles={(files) => upload(files, selectedFolder)} />
      </div>

      {newFolderIn !== null && (
        <Modal title={`New folder in ${newFolderIn || "/"}`} onClose={() => setNewFolderIn(null)} width="max-w-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createFolder();
            }}
            className="flex gap-2"
          >
            <input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g. results-review or body-regions"
              className="flex-1 bg-ground border border-edge-strong rounded px-2 py-1.5 text-sm text-ink outline-none focus:border-blue-500"
            />
            <button className="btn btn-primary" type="submit">
              Create
            </button>
          </form>
          <p className="text-xs text-faint mt-2">Nest as deep as you need — manuals / hydraulics / pumps…</p>
        </Modal>
      )}
      {rename && (
        <Modal title={`Rename ${rename.kind}`} onClose={() => setRename(null)} width="max-w-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              doRename();
            }}
            className="flex gap-2"
          >
            <input autoFocus value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} className="flex-1 bg-ground border border-edge-strong rounded px-2 py-1.5 text-sm text-ink outline-none focus:border-blue-500" />
            <button className="btn btn-primary" type="submit">
              Rename
            </button>
          </form>
        </Modal>
      )}
      {confirm && (
        <Modal title="Are you sure?" onClose={() => setConfirm(null)} width="max-w-sm">
          <p className="text-sm text-ink/90">{confirm.text}</p>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                try {
                  await confirm.run();
                } catch (e) {
                  toast((e as Error).message, "error");
                }
                setConfirm(null);
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
      {indexPreview && (
        <Modal title={`INDEX.md — ${indexPreview.folder || "workspace"}`} onClose={() => setIndexPreview(null)} width="max-w-3xl">
          <p className="text-xs text-faint mb-2">
            Written to <span className="font-mono">markdown/{indexPreview.folder ? indexPreview.folder + "/" : ""}INDEX.md</span>. A downstream agent reads this first to decide where to look.
          </p>
          <pre className="text-[11px] font-mono text-ink/90 bg-ground/60 border border-edge rounded-lg p-3 max-h-[60vh] overflow-auto whitespace-pre-wrap">{indexPreview.text}</pre>
        </Modal>
      )}
    </div>
  );
}

function ancestors(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const out: string[] = [""];
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

function Row({
  depth,
  selected,
  onClick,
  icon,
  chevron,
  label,
  badge,
  menu,
  draggable,
  onDragStart,
  onDrop,
}: {
  depth: number;
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  chevron?: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
  menu: { label: string; icon: React.ReactNode; run: () => void; danger?: boolean }[];
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`group relative flex items-center gap-1 pr-1 py-[3px] cursor-pointer select-none rounded-sm mx-1 ${
        selected ? "bg-blue-600/20 text-blue-100" : over ? "bg-emerald-900/30" : "hover:bg-raised text-ink/90"
      }`}
      style={{ paddingLeft: 6 + depth * 12 }}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={
        onDrop
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              setOver(true);
            }
          : undefined
      }
      onDragLeave={onDrop ? () => setOver(false) : undefined}
      onDrop={
        onDrop
          ? (e) => {
              setOver(false);
              onDrop(e);
            }
          : undefined
      }
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <span className="w-3 flex items-center justify-center shrink-0">{chevron}</span>
      <span className="shrink-0">{icon}</span>
      <span className="truncate flex-1">{label}</span>
      {badge}
      <button
        className={`p-0.5 rounded text-faint hover:text-ink hover:bg-edge ${menuOpen ? "" : "opacity-0 group-hover:opacity-100"}`}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} onContextMenu={(e) => { e.preventDefault(); setMenuOpen(false); }} />
          <div className="absolute right-1 top-full z-40 mt-0.5 glass rounded-lg shadow-xl py-1 min-w-[150px] animate-fade-in" onClick={(e) => e.stopPropagation()}>
            {menu.map((m) => (
              <button
                key={m.label}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-raised ${m.danger ? "text-red-300" : "text-ink"}`}
                onClick={() => {
                  setMenuOpen(false);
                  m.run();
                }}
              >
                {m.icon}
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
