/** A listing folded into a tree the way a file manager draws one. */

import { describe, expect, test } from "vitest";
import { buildTree, type Entry, type TreeNode } from "src/lib/tree";

const pdf = (path: string, rest: Partial<Entry> = {}): Entry => ({
  path,
  kind: "pdf",
  ...rest,
});

/** The tree as indented names, which is what a person sees of it. */
function outline(nodes: TreeNode[], depth = 0): string[] {
  return nodes.flatMap((n) =>
    n.type === "folder"
      ? [
          `${"  ".repeat(depth)}${n.name}/ ${n.files}`,
          ...outline(n.children, depth + 1),
        ]
      : [`${"  ".repeat(depth)}${n.name}`],
  );
}

describe("buildTree", () => {
  test("is empty for no entries", () => {
    expect(buildTree([])).toEqual([]);
  });

  test("puts folders first, then files, each alphabetical ignoring case", () => {
    const tree = buildTree([
      pdf("zeta"),
      pdf("Alpha"),
      pdf("beta/one"),
      pdf("alpha-dir/x"),
      pdf("Beta/two"),
    ]);
    expect(outline(tree)).toEqual([
      "alpha-dir/ 1",
      "  x",
      "beta/ 1",
      "  one",
      "Beta/ 1",
      "  two",
      "Alpha",
      "zeta",
    ]);
  });

  test("counts every file below a folder, not only its own", () => {
    const tree = buildTree([pdf("a/b/c"), pdf("a/b/d"), pdf("a/e")]);
    expect(outline(tree)).toEqual(["a/ 3", "  b/ 2", "    c", "    d", "  e"]);
  });

  test("collapses a path listed twice to one node", () => {
    const tree = buildTree([pdf("a/x"), pdf("a/x", { done: true })]);
    expect(outline(tree)).toEqual(["a/ 1", "  x"]);
    const [folder] = tree;
    expect(folder.type === "folder" && folder.children[0]).toMatchObject({
      done: undefined,
    });
  });

  test("keeps a name that is both a document and a folder", () => {
    const tree = buildTree([pdf("a"), pdf("a/b")]);
    expect(outline(tree)).toEqual(["a/ 1", "  b", "a"]);
    expect(tree.map((n) => n.path)).toEqual(["a", "a"]);
  });

  test("carries each file's kind, mark, done and removable", () => {
    const mark = { text: "new", tone: "blue" as const };
    const [node] = buildTree([
      { path: "x", kind: "md", mark, done: true, removable: true },
    ]);
    expect(node).toEqual({
      type: "file",
      name: "x",
      path: "x",
      kind: "md",
      mark,
      done: true,
      removable: true,
    });
  });

  test("ignores empty names and a path with none", () => {
    const tree = buildTree([pdf(""), pdf("/"), pdf("a//b")]);
    expect(outline(tree)).toEqual(["a/ 1", "  b"]);
  });
});
