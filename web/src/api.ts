import type { CompletionCheck, DocView, ExportEntry, Job, RuleLevel, TreeResponse, VersionsSummary } from "./types";

// In the browser the API is same-origin under /api. In the desktop app the
// engine sits on its own ephemeral port behind a per-launch token, and
// main.tsx points us at it before anything renders.
let BASE = "/api";
let TOKEN: string | null = null;

export function configureApi(base: string, token?: string | null) {
  BASE = base;
  TOKEN = token || null;
}

/** A full request URL. The token rides as ?t= so plain <img src> works too. */
function url(path: string): string {
  const u = `${BASE}${path}`;
  if (!TOKEN) return u;
  return u + (u.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(TOKEN);
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url(path), init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = j.detail ?? JSON.stringify(j);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("json") ? res.json() : res.text()) as Promise<T>;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  tree: () => req<TreeResponse>("/tree"),
  // /tree walks the workspace once per document; /jobs is a dict copy
  jobs: () => req<Record<string, Job>>("/jobs"),
  mkdir: (path: string) => req<{ path: string }>("/folders", json("POST", { path })),
  rmdir: (path: string) => req("/folders/" + path, { method: "DELETE" }),
  move: (src: string, dst: string) => req<{ path: string }>("/move", json("POST", { src, dst })),
  upload: (files: File[], folder: string) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    fd.append("folder", folder);
    return req<{ added: string[] }>("/upload", { method: "POST", body: fd });
  },
  // the desktop drop: absolute paths (a pdf, a zip, or a whole directory tree)
  addPaths: (paths: string[], folder: string) =>
    req<{ added: string[]; errors: string[] }>("/add-paths", json("POST", { paths, folder })),
  doc: async (id: string): Promise<DocView> => {
    const res = await fetch(url(`/docs/${id}`));
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText);
    const data = await res.json();
    if (res.status === 202) return { ...data, pending: true };
    return data;
  },
  deleteDoc: (id: string) => req("/docs/" + id, { method: "DELETE" }),
  reanalyze: (id: string) => req("/docs/" + id + "/reanalyze", json("POST")),
  patchBlock: (id: string, block: string, fields: Record<string, unknown>) =>
    req(`/docs/${id}/blocks/${block}`, json("PATCH", fields)),
  // a group rides on the first block's route, the way a group move does
  patchBlocks: (id: string, blocks: string[], fields: Record<string, unknown>) =>
    req(`/docs/${id}/blocks/${blocks[0]}`, json("PATCH", { ...fields, blocks })),
  resetBlock: (id: string, block: string) => req(`/docs/${id}/blocks/${block}/override`, { method: "DELETE" }),
  moveBlock: (id: string, block: string, body: { to?: number; target?: string; place?: "before" | "after"; blocks?: string[] }) =>
    req<{ page: number; order: string[]; affected: string[] }>(`/docs/${id}/blocks/${block}/move`, json("POST", body)),
  joinBlock: (id: string, child: string, parent: string) =>
    req(`/docs/${id}/blocks/${child}/join`, json("POST", { parent })),
  splitBlock: (id: string, child: string) => req(`/docs/${id}/blocks/${child}/split`, json("POST")),
  // `at` = the line positions the cut falls before, in the block's own lines
  cutBlock: (id: string, block: string, at: number[]) =>
    req<{ block: string; at: number[] }>(`/docs/${id}/blocks/${block}/cut`, json("POST", { at })),
  setOrder: (id: string, page: number, order: string[] | null) =>
    req(`/docs/${id}/pages/${page}/order`, json("PUT", { order })),
  reorder: (id: string, blocks: string[], preview = false) =>
    req<{ page: number; order: string[]; affected: string[]; to: number | null }>(`/docs/${id}/reorder`, json("POST", { blocks, preview })),
  insert: (id: string, page: number, after: string | null, text: string) =>
    req<{ id: string }>(`/docs/${id}/inserts`, json("POST", { page, after, text })),
  updateInsert: (id: string, ins: string, text: string) => req(`/docs/${id}/inserts/${ins}`, json("PATCH", { text })),
  removeInsert: (id: string, ins: string) => req(`/docs/${id}/inserts/${ins}`, { method: "DELETE" }),
  putMarkdown: (id: string, text: string) =>
    req<{ shaped: number; regrouped: number; hidden: number; inserted: number; updated: number; removed: number }>(
      `/docs/${id}/markdown`,
      json("PUT", { text }),
    ),
  checks: (id: string) => req<{ checks: CompletionCheck[] }>(`/docs/${id}/checks`),
  setComplete: (id: string, complete: boolean, folder?: string | null) =>
    req<{ doc: string; complete: boolean; checks: CompletionCheck[]; learned: unknown[]; folder?: string }>(
      `/docs/${id}/complete`,
      json("POST", { complete, folder }),
    ),
  exportable: (folder = "") => req<{ documents: ExportEntry[] }>("/export?folder=" + encodeURIComponent(folder)),
  exportTo: (docs: string[], dest: string, asZip: boolean) =>
    req<{ documents: number; files: number; dest: string }>("/export", json("POST", { docs, dest, zip: asZip })),
  undo: (id: string) => req<{ undone: boolean }>(`/docs/${id}/undo`, json("POST")),
  redo: (id: string) => req<{ redone: boolean }>(`/docs/${id}/redo`, json("POST")),
  resetEdits: (id: string) => req(`/docs/${id}/reset`, json("POST")),
  rules: (path: string) => req<{ stack: RuleLevel[] }>(path ? "/rules/" + path : "/rules"),
  forgetRule: (folder: string, kind: string, key: string) => req("/rules-forget", json("POST", { folder, kind, key })),
  applyRules: (id: string) => req<{ rules_applied: number }>(`/docs/${id}/apply-rules`, json("POST")),
  versions: (id: string) => req<VersionsSummary>(`/docs/${id}/versions`),
  saveVersion: (id: string, name: string) => req<VersionsSummary & { saved: string }>(`/docs/${id}/versions`, json("POST", { name })),
  checkout: (id: string, version: string | null) => req<VersionsSummary>(`/docs/${id}/checkout`, json("POST", { version })),
  deleteVersion: (id: string, v: string) => req<VersionsSummary>(`/docs/${id}/versions/${v}`, { method: "DELETE" }),
  buildIndex: (folder: string) => req<{ markdown: string }>("/index", json("POST", { folder })),
  index: (folder: string) => req<string>("/index/" + folder),
  markdownUrl: (id: string) => url(`/docs/${id}/markdown`),
  pageUrl: (id: string, n: number) => url(`/docs/${id}/page/${n}.png`),
  thumbUrl: (id: string, n: number) => url(`/docs/${id}/thumb/${n}.png`),
  assetUrl: (id: string, name: string) => url(`/docs/${id}/assets/${name}`),
};
