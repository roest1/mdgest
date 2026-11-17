/** Which blocks a click or a lasso selects (`selection.ts`), and the store
 *  letting a selection go with the reading it was made on. */

import { afterEach, describe, expect, test } from "vitest";
import type { Placed } from "src/lib/emit";
import {
  lassoed,
  picked,
  selectedByPage,
  type Modifiers,
  type Selection,
} from "src/lib/selection";
import { useEditor } from "src/lib/store";

/** Two pages of three blocks each, the middle one of page 1 deleted. */
const order = ["p1b0", "p1b1", "p1b2", "p2b0", "p2b1", "p2b2"];
const blocks: Record<string, Placed> = Object.fromEntries(
  order.map((id, i) => [
    id,
    {
      id,
      page: Number(id[1]),
      n: (i % 3) + 1,
      from: i + 1,
      to: i + 1,
      hidden: false,
      deleted: id === "p1b1",
    },
  ]),
);

const PLAIN: Modifiers = { range: false, toggle: false };
const SHIFT: Modifiers = { range: true, toggle: false };
const CTRL: Modifiers = { range: false, toggle: true };

/** Clicks in turn, each on what the last left, as the store makes them. */
function clicks(...steps: [string, Modifiers][]): Selection | null {
  let s: Selection | null = null;
  for (const [id, mods] of steps)
    s = picked(s, "a", order, blocks, id, mods, "page");
  return s;
}

describe("a click", () => {
  test("selects the one block, and again on it lets it go", () => {
    expect(clicks(["p1b0", PLAIN])).toEqual({
      docId: "a",
      ids: ["p1b0"],
      focus: "p1b0",
      anchor: "p1b0",
      from: "page",
    });
    expect(clicks(["p1b0", PLAIN], ["p1b0", PLAIN])).toBeNull();
    expect(clicks(["p1b0", PLAIN], ["p2b0", PLAIN])?.ids).toEqual(["p2b0"]);
  });

  test("with shift, ranges from the anchor in the markdown's order, across pages and either way", () => {
    const down = clicks(["p1b2", PLAIN], ["p2b1", SHIFT]);
    expect(down?.ids).toEqual(["p1b2", "p2b0", "p2b1"]);
    expect(down).toMatchObject({ anchor: "p1b2", focus: "p2b1" });
    // From the same anchor, the other way: the range is re-drawn, not added to.
    const up = clicks(["p1b2", PLAIN], ["p2b1", SHIFT], ["p1b0", SHIFT]);
    // The deleted block between is not one to select.
    expect(up?.ids).toEqual(["p1b0", "p1b2"]);
    expect(up?.anchor).toBe("p1b2");
  });

  test("with shift and nothing selected, selects the one block", () => {
    expect(clicks(["p2b0", SHIFT])?.ids).toEqual(["p2b0"]);
  });

  test("with ctrl, toggles the one block, in the markdown's order, down to nothing", () => {
    const s = clicks(["p2b1", PLAIN], ["p1b0", CTRL], ["p2b2", CTRL]);
    expect(s?.ids).toEqual(["p1b0", "p2b1", "p2b2"]);
    expect(s?.anchor).toBe("p2b2");
    expect(
      clicks(["p2b1", PLAIN], ["p1b0", CTRL], ["p2b1", CTRL])?.ids,
    ).toEqual(["p1b0"]);
    expect(clicks(["p2b1", PLAIN], ["p2b1", CTRL])).toBeNull();
  });

  test("on a block the markdown did not write changes nothing", () => {
    const s = clicks(["p1b0", PLAIN]);
    expect(picked(s, "a", order, blocks, "p1b1", PLAIN, "page")).toBe(s);
    expect(picked(s, "a", order, blocks, "p9b9", CTRL, "page")).toBe(s);
  });

  test("in another document starts afresh, whatever keys are held", () => {
    const other: Selection = {
      docId: "b",
      ids: ["p1b0"],
      focus: "p1b0",
      anchor: "p1b0",
      from: "markdown",
    };
    expect(picked(other, "a", order, blocks, "p2b0", SHIFT, "page")).toEqual({
      docId: "a",
      ids: ["p2b0"],
      focus: "p2b0",
      anchor: "p2b0",
      from: "page",
    });
  });
});

describe("a lasso", () => {
  test("selects what it swept, in the markdown's order, from the first", () => {
    const s = lassoed("a", order, blocks, ["p2b0", "p1b2"], null, "page");
    expect(s).toMatchObject({
      ids: ["p1b2", "p2b0"],
      focus: "p1b2",
      anchor: "p1b2",
    });
  });

  test("replaces the selection, or adds to the one it began with", () => {
    const base = clicks(["p2b2", PLAIN]);
    expect(lassoed("a", order, blocks, ["p1b0"], null, "page")?.ids).toEqual([
      "p1b0",
    ]);
    expect(lassoed("a", order, blocks, ["p1b0"], base, "page")?.ids).toEqual([
      "p1b0",
      "p2b2",
    ]);
  });

  test("sweeping nothing, or only what is not written, leaves what it began with", () => {
    const base = clicks(["p2b2", PLAIN]);
    expect(lassoed("a", order, blocks, [], base, "page")).toBe(base);
    expect(lassoed("a", order, blocks, ["p1b1"], null, "page")).toBeNull();
  });
});

test("the selection is cut into its pages", () => {
  const s = clicks(["p1b0", PLAIN], ["p2b1", SHIFT]);
  const by = selectedByPage(s, "a", blocks);
  expect([...by.keys()]).toEqual([1, 2]);
  expect([...by.get(1)!]).toEqual(["p1b0", "p1b2"]);
  expect([...by.get(2)!]).toEqual(["p2b0", "p2b1"]);
  expect(selectedByPage(s, "b", blocks).size).toBe(0);
});

describe("the store", () => {
  afterEach(() => {
    useEditor.setState({ readings: {}, selection: null });
  });

  const ready = {
    status: "ready" as const,
    analysis: { pages: [] } as never,
    markdown: { text: "", lines: [], blocks, order },
  };

  test("picks through the reading's order, and lets go when the reading is set anew or forgotten", () => {
    const { setReading, pick } = useEditor.getState();
    setReading("a", ready);
    pick("a", "p1b0", PLAIN, "page");
    pick("a", "p2b0", SHIFT, "markdown");
    expect(useEditor.getState().selection).toMatchObject({
      ids: ["p1b0", "p1b2", "p2b0"],
      from: "markdown",
    });
    // Another document's reading leaves it be.
    setReading("b", ready);
    expect(useEditor.getState().selection?.docId).toBe("a");
    setReading("a", { ...ready });
    expect(useEditor.getState().selection).toBeNull();
    pick("a", "p1b0", PLAIN, "page");
    setReading("a", undefined);
    expect(useEditor.getState().selection).toBeNull();
  });

  test("picks nothing in a document still being read", () => {
    const { setReading, pick } = useEditor.getState();
    setReading("a", { status: "reading", page: 0, pages: 2 });
    pick("a", "p1b0", PLAIN, "page");
    expect(useEditor.getState().selection).toBeNull();
  });
});
