import { create } from "zustand";
import { api } from "./api";
import { numbering } from "./lib/order";
import type { Block, CompletionCheck, DocView, Job, TreeNode } from "./types";

/** Just the modifier keys — a React event, a native one, or a remembered copy. */
export type Mods = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean };

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
  loadJobs: () => Promise<void>;
  setSelectedFolder: (p: string) => void;

  // desktop: a native OS drag is over the window; drops arrive as paths
  nativeDragOver: boolean;
  setNativeDragOver: (v: boolean) => void;
  addPaths: (paths: string[]) => Promise<void>;

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
  selected: string[]; // the group the next operation acts on, in page order
  hover: string | null;
  currentPage: number;
  overlays: Overlays;
  mdMode: "rendered" | "source";
  followScroll: boolean;
  zoom: number;
  select: (id: string | null) => void;
  selectRange: (id: string) => void; // shift-click: everything between the anchor and id
  toggleSelected: (id: string) => void; // ctrl/cmd-click: add or drop one, neighbor or not
  selectFrom: (mods: Mods, id: string, scroll?: "pdf" | "md") => void; // the click, whatever was held
  setSelected: (ids: string[]) => void; // marquee / drag-capture: an explicit set, in page order
  setHover: (id: string | null) => void;
  setCurrentPage: (n: number) => void;
  toggleOverlay: (k: keyof Overlays) => void;
  setMdMode: (m: "rendered" | "source") => void;
  setZoom: (z: number) => void;
  setFollowScroll: (v: boolean) => void;
  scrollRequest: { target: string; side: "pdf" | "md" | "both"; nonce: number } | null;
  scrollTo: (blockId: string, side?: "pdf" | "md" | "both") => void;

  // done: the act that promotes this document's edits to folder rules
  setComplete: (complete: boolean, folder?: string | null) => Promise<CompletionCheck[]>;

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
  reorderSelection: () => Promise<void>;
  // what the badges would read if the selection were sorted — the engine's
  // own answer, asked for and not committed, so hovering the button shows the
  // permutation rather than describing it
  orderPreview: { numbers: Map<string, number>; affected: Set<string> } | null;
  previewReorder: () => Promise<void>;
  clearPreview: () => void;
  joinBlock: (child: string, parent: string) => Promise<void>;
  splitBlock: (child: string) => Promise<void>;
  cutBlock: (block: string, at: number[]) => Promise<void>;
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
let previewToken = 0;

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
  // What the explorer polls while a batch analyzes. Nothing in a document's
  // tree entry -- pages, analyzed, edited, has_markdown, parts, complete --
  // changes until its analysis finishes, so the walk is worth paying for on
  // that transition and at no other time. Failure stays quiet: a toast a
  // second is not a report, and the next thing the user does says it properly.
  loadJobs: async () => {
    try {
      const jobs = await api.jobs();
      const prev = get().jobs;
      const settled = (j?: Job) => j?.status === "done" || j?.status === "error";
      const finished = Object.keys(jobs).some((id) => settled(jobs[id]) && !settled(prev[id]));
      set({ jobs });
      if (finished) await get().loadTree();
    } catch {
      /* left to loadTree and to whatever the user does next */
    }
  },
  setSelectedFolder: (p) => set({ selectedFolder: p }),

  nativeDragOver: false,
  setNativeDragOver: (v) => set({ nativeDragOver: v }),
  addPaths: async (paths) => {
    if (!paths.length) return;
    const { selectedFolder, toast, loadTree, openDoc } = get();
    try {
      const r = await api.addPaths(paths, selectedFolder);
      for (const e of r.errors) toast(e, "error");
      if (r.added.length || !r.errors.length) {
        toast(`${r.added.length} document${r.added.length === 1 ? "" : "s"} added`, r.added.length ? "success" : "info");
      }
      await loadTree();
      if (r.added.length === 1) openDoc(r.added[0]);
    } catch (e) {
      toast(`add failed: ${(e as Error).message}`, "error");
    }
  },

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
  setActive: (id) => set({ activeDoc: id, selection: null, selected: [] }),
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
  // The gesture, once. It was written out in four places -- both panes, the
  // gutter handles, the source view -- so adding ctrl-click meant finding all
  // four, and finding three of them is a bug nobody notices until they click.
  selectFrom: (mods, id, scroll) => {
    const s = get();
    if (mods.shiftKey) return s.selectRange(id);
    if (mods.metaKey || mods.ctrlKey) return s.toggleSelected(id);
    s.select(id);
    if (scroll) s.scrollTo(id, scroll);
  },
  toggleSelected: (id) => {
    const { activeDoc, docs, selected, selection } = get();
    const view = activeDoc ? docs[activeDoc] : undefined;
    const here = findBlock(view, id);
    const anchor = findBlock(view, selected[0] ?? null);
    // Every operation on a group -- move above all -- is a page's operation.
    // Reaching onto another page starts a new selection rather than building
    // one the engine will refuse.
    if (!here || (anchor && anchor.pageIndex !== here.pageIndex)) {
      set({ selection: id, selected: [id] });
      return;
    }
    const had = selected.includes(id);
    const keep = new Set(selected);
    if (had) keep.delete(id);
    else keep.add(id);
    const ids = view!.pages[here.pageIndex].blocks.filter((b) => keep.has(b.id)).map((b) => b.id);
    set({ selected: ids, selection: had ? (selection === id ? (ids[ids.length - 1] ?? null) : selection) : id });
  },
  setHover: (id) => set({ hover: id }),
  setCurrentPage: (n) => set({ currentPage: n }),
  toggleOverlay: (k) => set((s) => ({ overlays: { ...s.overlays, [k]: !s.overlays[k] } })),
  setMdMode: (m) => set({ mdMode: m }),
  setZoom: (z) => set({ zoom: Math.min(3, Math.max(0.4, z)) }),
  setFollowScroll: (v) => set({ followScroll: v }),
  scrollRequest: null,
  scrollTo: (target, side = "both") => set({ scrollRequest: { target, side, nonce: Date.now() } }),

  setComplete: async (complete, folder) => {
    const id = get().activeDoc;
    if (!id) return [];
    set({ busy: true });
    try {
      const r = await api.setComplete(id, complete, folder);
      await get().refreshDoc(id, false);
      get().loadTree();
      if (!complete) {
        get().toast("no longer marked done", "info");
      } else {
        const learned = r.learned.length;
        get().toast(
          learned ? `done — ${learned} rule(s) into ${r.folder || "the workspace"}` : "done",
          "success",
        );
      }
      return r.checks;
    } catch (e) {
      get().toast((e as Error).message, "error");
      return [];
    } finally {
      set({ busy: false });
    }
  },

  saveVersion: async (name) =>
    mutate(get, set, async (id) => {
      const r = await api.saveVersion(id, name);
      get().toast(`saved ${r.saved} “${name || r.saved}”`, "success");
    }),
  checkout: async (version) =>
    mutate(get, set, async (id) => {
      await api.checkout(id, version);
      get().toast(`now on ${version ?? "the original"} — one undo returns what you had`, "info");
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
    mutate(get, set, (id) => api.patchBlock(id, block, fields)),
  patchBlocks: async (blocks, fields) =>
    mutate(get, set, (id) => api.patchBlocks(id, blocks, fields)),
  resetBlock: async (block) => mutate(get, set, (id) => api.resetBlock(id, block)),
  moveBlock: async (block, body) =>
    mutate(get, set, async (id) => {
      const group = Array.isArray(block) ? block : [block];
      const r = await api.moveBlock(id, group[0], { ...body, blocks: group });
      const what = group.length > 1 ? `${group.length} blocks` : "moved";
      if (r.affected.length > 1) get().toast(`${what} — ${r.affected.length} renumbered on page ${r.page}`, "info");
      set({ selection: group[0], selected: group });
    }),
  reorderSelection: async () =>
    mutate(get, set, async (id) => {
      const group = get().selected;
      const r = await api.reorder(id, group);
      set({ orderPreview: null });
      get().toast(
        r.affected.length
          ? `${group.length} blocks from #${r.to} — ${r.affected.length} renumbered on page ${r.page}`
          : "already in order, and already neighbors",
        r.affected.length ? "success" : "info",
      );
    }),
  orderPreview: null,
  previewReorder: async () => {
    const { activeDoc, docs, selected } = get();
    const found = findBlock(activeDoc ? docs[activeDoc] : undefined, selected[0] ?? null);
    if (!activeDoc || !found || selected.length < 2) return;
    const token = ++previewToken;
    let order: string[];
    try {
      order = (await api.reorder(activeDoc, selected, true)).order;
    } catch {
      return; // a preview that cannot be had says nothing; the press will report why
    }
    if (token !== previewToken) return; // a later hover already won
    const page = docs[activeDoc].pages[found.pageIndex];
    const hidden = new Set(page.blocks.filter((b) => b.hidden).map((b) => b.id));
    const was = numbering(page.blocks.map((b) => b.id), hidden);
    const numbers = numbering(order, hidden);
    set({ orderPreview: { numbers, affected: new Set(order.filter((i) => numbers.get(i) !== was.get(i))) } });
  },
  clearPreview: () => {
    previewToken++; // a preview still in flight is no longer wanted
    if (get().orderPreview) set({ orderPreview: null });
  },
  joinBlock: async (child, parent) => mutate(get, set, (id) => api.joinBlock(id, child, parent)),
  splitBlock: async (child) => mutate(get, set, (id) => api.splitBlock(id, child)),
  cutBlock: async (block, at) => mutate(get, set, (id) => api.cutBlock(id, block, at)),
  resetOrder: async (page) => mutate(get, set, (id) => api.setOrder(id, page, null)),
  insertText: async (page, after, text) => mutate(get, set, (id) => api.insert(id, page, after, text)),
  applyMarkdown: async (text) =>
    mutate(get, set, async (id) => {
      const r = await api.putMarkdown(id, text);
      const parts = [
        r.shaped && `${r.shaped} reshaped`,
        r.regrouped && `${r.regrouped} regrouped`,
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
