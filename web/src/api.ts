import type { DocView, RuleLevel, TreeResponse, VersionsSummary } from "./types";

const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
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
  mkdir: (path: string) => req<{ path: string }>("/folders", json("POST", { path })),
  rmdir: (path: string) => req("/folders/" + path, { method: "DELETE" }),
  move: (src: string, dst: string) => req<{ path: string }>("/move", json("POST", { src, dst })),
  upload: (files: File[], folder: string) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    fd.append("folder", folder);
    return req<{ added: string[] }>("/upload", { method: "POST", body: fd });
  },
  doc: async (id: string): Promise<DocView> => {
    const res = await fetch(`${BASE}/docs/${id}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? res.statusText);
    const data = await res.json();
    if (res.status === 202) return { ...data, pending: true };
    return data;
  },
  deleteDoc: (id: string) => req("/docs/" + id, { method: "DELETE" }),
  reanalyze: (id: string) => req("/docs/" + id + "/reanalyze", json("POST")),
  patchBlock: (id: string, block: string, fields: Record<string, unknown>) =>
    req(`/docs/${id}/blocks/${block}`, json("PATCH", fields)),
  resetBlock: (id: string, block: string) => req(`/docs/${id}/blocks/${block}/override`, { method: "DELETE" }),
  moveBlock: (id: string, block: string, body: { to?: number; target?: string; place?: "before" | "after"; blocks?: string[] }) =>
    req<{ page: number; order: string[]; affected: string[] }>(`/docs/${id}/blocks/${block}/move`, json("POST", body)),
  joinBlock: (id: string, child: string, parent: string) =>
    req(`/docs/${id}/blocks/${child}/join`, json("POST", { parent })),
  splitBlock: (id: string, child: string) => req(`/docs/${id}/blocks/${child}/split`, json("POST")),
  setOrder: (id: string, page: number, order: string[] | null) =>
    req(`/docs/${id}/pages/${page}/order`, json("PUT", { order })),
  insert: (id: string, page: number, after: string | null, text: string) =>
    req<{ id: string }>(`/docs/${id}/inserts`, json("POST", { page, after, text })),
  updateInsert: (id: string, ins: string, text: string) => req(`/docs/${id}/inserts/${ins}`, json("PATCH", { text })),
  removeInsert: (id: string, ins: string) => req(`/docs/${id}/inserts/${ins}`, { method: "DELETE" }),
  putMarkdown: (id: string, text: string) =>
    req<{ shaped: number; hidden: number; inserted: number; updated: number; removed: number }>(`/docs/${id}/markdown`, json("PUT", { text })),
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
  markdownUrl: (id: string) => `${BASE}/docs/${id}/markdown`,
  pageUrl: (id: string, n: number) => `${BASE}/docs/${id}/page/${n}.png`,
  thumbUrl: (id: string, n: number) => `${BASE}/docs/${id}/thumb/${n}.png`,
  assetUrl: (id: string, name: string) => `${BASE}/docs/${id}/assets/${name}`,
};
