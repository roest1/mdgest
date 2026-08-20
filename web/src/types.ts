export type Role = "heading" | "para" | "bullet" | "numbered" | "alpha" | "roman" | "image" | "insert";

export interface Block {
  id: string;
  kind: "text" | "image" | "insert";
  page: number;
  bbox: [number, number, number, number] | null; // pdf points, bottom-left origin
  lines: number[];
  text: string;
  role: Role;
  level: number;
  depth: number;
  bold: boolean;
  italic: boolean;
  marker: string;
  size: number;
  picture: number;
  n: number; // 1-based number on the page, in reading order
  hidden?: boolean;
  edited?: boolean;
  origin?: "page" | "person";
  joined?: string[];
  after?: string | null;
  break_before?: boolean;
  break_after?: boolean;
  font?: string;
  default_role?: Role;
  rule?: { folder: string; key: string; kind: "shape" | "hide" } | null;
}

export interface VersionEntry {
  id: string;
  name: string;
  parent: string | null;
  created: string;
  depth: number;
  edits: Record<string, number>;
}

export interface VersionsSummary {
  base: string | null;
  dirty: boolean;
  versions: VersionEntry[];
}

export interface RuleLevel {
  folder: string;
  shape: { key: string; fields: Record<string, unknown>; count: number; example: string; doc: string }[];
  hide: { key: string; example: string; doc: string }[];
}

export interface Line {
  text: string;
  bbox: [number, number, number, number];
  size: number;
  bold: boolean;
  italic: boolean;
  font: string;
}

export interface Picture {
  bbox: [number, number, number, number];
  path: string;
  px: [number, number];
}

export interface Page {
  n: number;
  width: number;
  height: number;
  lines: Line[];
  pictures: Picture[];
  blocks: Block[];
  reordered: boolean;
}

export interface MdLine {
  text: string;
  block: string | null;
  n: number | null;
  page: number;
  page_break?: boolean;
}

export interface DocSummary {
  id: string;
  name: string;
  folder: string;
  pages: number | null;
  analyzed: boolean;
  edited: boolean;
  has_markdown: boolean;
}

export interface DocView {
  doc: DocSummary;
  body_size: number;
  page_count: number;
  pages: Page[];
  markdown: string;
  md_lines: MdLine[];
  edits: { blocks: number; pages_reordered: number; inserts: number; joins: number; undo: number; redo: number };
  job?: Job | null;
  pending?: boolean;
  versions?: VersionsSummary;
  rules_applied?: number;
}

export interface Job {
  status: "queued" | "running" | "done" | "error";
  error: string | null;
}

export interface TreeNode {
  name: string;
  path: string;
  folders: TreeNode[];
  docs: DocSummary[];
  has_index: boolean;
}

export interface TreeResponse {
  tree: TreeNode;
  jobs: Record<string, Job>;
  workspace: string;
}
