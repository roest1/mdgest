/** The editor's state, where a document id is a key.
 *
 * An id is a file name, so `sources/__proto__.pdf` and `sources/toString.pdf`
 * are documents a person can import -- `isDocId` lets them through, and the
 * manifest is made without a prototype so they key it like any other. These
 * say the store does the same. */

import { beforeEach, describe, expect, test } from "vitest";
import { useEditor, type Reading } from "src/lib/store";

const reading = (pages: number): Reading => ({
  status: "reading",
  page: 1,
  pages,
});

beforeEach(() => {
  const { setReading } = useEditor.getState();
  for (const id of Object.keys(useEditor.getState().readings))
    setReading(id, undefined);
});

describe("a document named __proto__", () => {
  test("is a reading like any other", () => {
    const { setReading } = useEditor.getState();
    setReading("__proto__", reading(3));
    expect(Object.keys(useEditor.getState().readings)).toEqual(["__proto__"]);
    expect(useEditor.getState().readings["__proto__"]).toEqual(reading(3));

    // And is still there after the next document is read: a prototype is
    // not carried over by the copy each update makes.
    setReading("other", reading(1));
    expect(useEditor.getState().readings["__proto__"]).toEqual(reading(3));
    expect(Object.keys(useEditor.getState().readings).sort()).toEqual([
      "__proto__",
      "other",
    ]);

    setReading("__proto__", undefined);
    expect(useEditor.getState().readings["__proto__"]).toBeUndefined();
    expect(Object.keys(useEditor.getState().readings)).toEqual(["other"]);
  });

  test("toString and constructor are not readings until read", () => {
    const { readings } = useEditor.getState();
    expect(readings["toString"]).toBeUndefined();
    expect(readings["constructor"]).toBeUndefined();
    expect("constructor" in readings).toBe(false);
  });
});
