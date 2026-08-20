import { create } from "zustand";
import { api } from "./api";
import type { Block, DocView, Job, TreeNode } from "./types";

export type Overlays = { text: boolean; images: boolean; numbers: boolean; lines: boolean };

interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
}

interface State {
  // workspace
  tree: TreeNode | null;
  jobs: Record<string, Job>;
  workspace: string;
  selectedFolder: string;
  loadTree: () => Promise<void>;
  setSelectedFolder: (p: string) => void;

  // documents
  openDocs: string[];
  activeDoc: string | null;
  docs: Record<string, DocView>;
  openDoc: (id: string) => Promise<void>;
  closeDoc: (id: string) => void;
  setActive: (id: string) => void;
  refreshDoc: (id: string, withLines?: boolean) => Promise<void>;

  // view state
  selection: string | null; // the anchor
  selected: string[]; // the range (anchor + shift-click extent), in page order
  hover: string | null;
  currentPage: number;
  overlays: Overlays;
  mdMode: "rendered" | "source";
  followScroll: boolean;
  zoom: number;
  select: (id: string | null) => void;
  selectRange: (id: string) => void; // shift-click: everything between the anchor and id
  setSelected: (ids: string[]) => void; // marquee / drag-capture: an explicit set, in page order
  setHover: (id: string | null) => void;
  setCurrentPage: (n: number) => void;
  toggleOverlay: (k: keyof Overlays) => void;
  setMdMode: (m: "rendered" | "source") => void;
  setZoom: (z: number) => void;
  setFollowScroll: (v: boolean) => void;
  scrollRequest: { target: string; side: "pdf" | "md" | "both"; nonce: number } | null;
  scrollTo: (blockId: string, side?: "pdf" | "md" | "both") => void;

  // learning: which folder on the document's path records decisions (null = off)
  learnScope: string | null;
  setLearnScope: (f: string | null) => void;

  // versions
  saveVersion: (name: string) => Promise<void>;
  checkout: (version: string | null) => Promise<void>;
  deleteVersion: (v: string) => Promise<void>;
  applyRules: () => Promise<void>;

  // edits
  busy: boolean;
  patchBlock: (block: string, fields: Partial<Block> & { hidden?: boolean }) => Promise<void>;
  patchBlocks: (blocks: string[], fields: Partial<Block> & { hidden?: boolean }) => Promise<void>;
  resetBlock: (block: string) => Promise<void>;
  moveBlock: (block: string | string[], body: { to?: number; target?: string; place?: "before" | "after" }) => Promise<void>;
  joinBlock: (child: string, parent: string) => Promise<void>;
  splitBlock: (child: string) => Promise<void>;
  resetOrder: (page: number) => Promise<void>;
  insertText: (page: number, after: string | null, text: string) => Promise<void>;
  applyMarkdown: (text: string) => Promise<void>;
  updateInsert: (ins: string, text: string) => Promise<void>;
  removeInsert: (ins: string) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  resetEdits: () => Promise<void>;

  // toasts
  toasts: Toast[];
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;

export const useStore = create<State>((set, get) => ({
  tree: null,
  jobs: {},
  workspace: "",
  selectedFolder: "",
  loadTree: async () => {
    try {
      const r = await api.tree();
      set({ tree: r.tree, jobs: r.jobs, workspace: r.workspace });
    } catch (e) {
      get().toast(`cannot reach the engine: ${(e as Error).message}`, "error");
    }
  },
  setSelectedFolder: (p) => set({ selectedFolder: p }),

  openDocs: [],
  activeDoc: null,
  docs: {},
  openDoc: async (id) => {
    const { openDocs } = get();
    set({
      openDocs: openDocs.includes(id) ? openDocs : [...openDocs, id],
      activeDoc: id,
      selection: null,
      selected: [],
      learnScope: id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "",
    });
    await get().refreshDoc(id, true);
  },
  closeDoc: (id) => {
    const { openDocs, activeDoc, docs } = get();
    const next = openDocs.filter((d) => d !== id);
    const rest = { ...docs };
    delete rest[id];
    set({
      openDocs: next,
      docs: rest,
      activeDoc: activeDoc === id ? (next[next.length - 1] ?? null) : activeDoc,
      selection: null,
      selected: [],
    });
  },
  setActive: (id) => set({ activeDoc: id, selection: null, selected: [], learnScope: id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "" }),
  refreshDoc: async (id, withLines = false) => {
    try {
      const prev = get().docs[id];
      const v = await api.doc(id);
      if (v.pending) {
        set((s) => ({ docs: { ...s.docs, [id]: { ...(prev ?? v), ...v } } }));
        // poll until analyzed
        setTimeout(() => {
          if (get().openDocs.includes(id)) get().refreshDoc(id, true);
        }, 800);
        return;
      }
      if (!withLines && prev && !prev.pending) {
        v.pages.forEach((p, i) => {
          if (!p.lines.length && prev.pages[i]) p.lines = prev.pages[i].lines;
        });
      }
      set((s) => ({ docs: { ...s.docs, [id]: v } }));
    } catch (e) {
      get().toast(`load failed: ${(e as Error).message}`, "error");
    }
  },

  selection: null,
  selected: [],
  hover: null,
  currentPage: 1,
  overlays: { text: true, images: true, numbers: true, lines: false },
  mdMode: "rendered",
  followScroll: true,
  zoom: 1,
  select: (id) => set({ selection: id, selected: id ? [id] : [] }),
  setSelected: (ids) => set({ selected: ids, selection: ids[0] ?? null }),
  selectRange: (id) => {
    const { activeDoc, docs, selection } = get();
    const view = activeDoc ? docs[activeDoc] : undefined;
    const a = findBlock(view, selection);
    const b = findBlock(view, id);
    if (!a || !b || a.pageIndex !== b.pageIndex) {
      set({ selection: id, selected: [id] });
      return;
    }
    const ids = view!.pages[a.pageIndex].blocks.map((x) => x.id);
    const i = ids.indexOf(a.block.id);
    const j = ids.indexOf(b.block.id);
    const [lo, hi] = i < j ? [i, j] : [j, i];
    set({ selected: ids.slice(lo, hi + 1) });
  },
  setHover: (id) => set({ hover: id }),
  setCurrentPage: (n) => set({ currentPage: n }),
  toggleOverlay: (k) => set((s) => ({ overlays: { ...s.overlays, [k]: !s.overlays[k] } })),
  setMdMode: (m) => set({ mdMode: m }),
  setZoom: (z) => set({ zoom: Math.min(3, Math.max(0.4, z)) }),
  setFollowScroll: (v) => set({ followScroll: v }),
  scrollRequest: null,
  scrollTo: (target, side = "both") => set({ scrollRequest: { target, side, nonce: Date.now() } }),

  learnScope: null,
  setLearnScope: (f) => set({ learnScope: f }),

  saveVersion: async (name) =>
    mutate(get, set, async (id) => {
      const r = await api.saveVersion(id, name);
      get().toast(`saved ${r.saved} “${name || r.saved}”`, "success");
    }),
  checkout: async (version) =>
    mutate(get, set, async (id) => {
      await api.checkout(id, version);
      get().toast(`now on ${version ?? "the original"} — undo goes back`, "info");
    }),
  deleteVersion: async (v) => mutate(get, set, (id) => api.deleteVersion(id, v)),
  applyRules: async () =>
    mutate(get, set, async (id) => {
      const r = await api.applyRules(id);
      get().toast(`re-read under the rules — ${r.rules_applied} blocks shaped by a rule`, "info");
      await get().refreshDoc(id, true);
    }),

  busy: false,
  patchBlock: async (block, fields) =>
    mutate(get, set, (id) => api.patchBlock(id, block, withLearn(get(), fields))),
  patchBlocks: async (blocks, fields) =>
    mutate(get, set, async (id) => {
      for (const b of blocks) await api.patchBlock(id, b, withLearn(get(), fields));
    }),
  resetBlock: async (block) => mutate(get, set, (id) => api.resetBlock(id, block)),
  moveBlock: async (block, body) =>
    mutate(get, set, async (id) => {
      const group = Array.isArray(block) ? block : [block];
      const r = await api.moveBlock(id, group[0], { ...body, blocks: group });
      const what = group.length > 1 ? `${group.length} blocks` : "moved";
      if (r.affected.length > 1) get().toast(`${what} — ${r.affected.length} renumbered on page ${r.page}`, "info");
      set({ selection: group[0], selected: group });
    }),
  joinBlock: async (child, parent) => mutate(get, set, (id) => api.joinBlock(id, child, parent)),
  splitBlock: async (child) => mutate(get, set, (id) => api.splitBlock(id, child)),
  resetOrder: async (page) => mutate(get, set, (id) => api.setOrder(id, page, null)),
  insertText: async (page, after, text) => mutate(get, set, (id) => api.insert(id, page, after, text)),
  applyMarkdown: async (text) =>
    mutate(get, set, async (id) => {
      const r = await api.putMarkdown(id, text);
      const parts = [
        r.shaped && `${r.shaped} reshaped`,
        r.hidden && `${r.hidden} deleted`,
        r.inserted && `${r.inserted} inserted`,
        r.updated && `${r.updated} updated`,
        r.removed && `${r.removed} removed`,
      ].filter(Boolean);
      get().toast(parts.length ? `applied — ${parts.join(", ")}` : "no changes", parts.length ? "success" : "info");
    }),
  updateInsert: async (ins, text) => mutate(get, set, (id) => api.updateInsert(id, ins, text)),
  removeInsert: async (ins) => mutate(get, set, (id) => api.removeInsert(id, ins)),
  undo: async () =>
    mutate(get, set, async (id) => {
      const r = await api.undo(id);
      if (!r.undone) get().toast("nothing to undo", "info");
    }),
  redo: async () =>
    mutate(get, set, async (id) => {
      const r = await api.redo(id);
      if (!r.redone) get().toast("nothing to redo", "info");
    }),
  resetEdits: async () => mutate(get, set, (id) => api.resetEdits(id)),

  toasts: [],
  toast: (text, kind = "info") => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 6000 : 2500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

function withLearn(s: State, fields: Record<string, unknown>): Record<string, unknown> {
  return s.learnScope === null ? fields : { ...fields, learn: s.learnScope };
}

async function mutate(
  get: () => State,
  set: (p: Partial<State>) => void,
  fn: (docId: string) => Promise<unknown>,
): Promise<void> {
  const id = get().activeDoc;
  if (!id) return;
  set({ busy: true });
  try {
    await fn(id);
    await get().refreshDoc(id, false);
    get().loadTree();
  } catch (e) {
    get().toast((e as Error).message, "error");
  } finally {
    set({ busy: false });
  }
}

/** Look up a block in the active document by id. */
export function findBlock(view: DocView | undefined, id: string | null): { block: Block; pageIndex: number } | null {
  if (!view || !id) return null;
  for (let i = 0; i < view.pages.length; i++) {
    const b = view.pages[i].blocks.find((x) => x.id === id);
    if (b) return { block: b, pageIndex: i };
  }
  return null;
}
