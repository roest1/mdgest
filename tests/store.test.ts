/** The editor's state, where a document id is a key.
 *
 * An id is a file name, so `sources/__proto__.pdf` and `sources/toString.pdf`
 * are documents a person can import -- `isDocId` lets them through, and the
 * manifest is made without a prototype so they key it like any other. These
 * say the store does the same. */

import { beforeEach, describe, expect, test } from "vitest";
import { useEditor, type Reading } from "src/lib/store";

const reading = (pages: number): Reading => ({ status: "reading", page: 1, pages });

beforeEach(() => {
  const { setReading, setDraft, setDone } = useEditor.getState();
  for (const id of Object.keys(useEditor.getState().readings)) setReading(id, undefined);
  for (const id of Object.keys(useEditor.getState().drafts)) setDraft(id, null);
  for (const id of Object.keys(useEditor.getState().done)) setDone(id, false);
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
    expect(Object.keys(useEditor.getState().readings).sort()).toEqual(["__proto__", "other"]);

    setReading("__proto__", undefined);
    expect(useEditor.getState().readings["__proto__"]).toBeUndefined();
    expect(Object.keys(useEditor.getState().readings)).toEqual(["other"]);
  });

  test("is a draft, a done mark and a reread like any other", () => {
    const { setDraft, setDone, reread } = useEditor.getState();
    setDraft("__proto__", { text: "x", base: { text: "", lines: [], order: [], blocks: {} } });
    expect(Object.keys(useEditor.getState().drafts)).toEqual(["__proto__"]);
    expect("__proto__" in useEditor.getState().drafts).toBe(true);

    setDone("__proto__", true);
    expect(Object.keys(useEditor.getState().done)).toEqual(["__proto__"]);
    expect(useEditor.getState().done["__proto__"]).toBe(true);

    reread("__proto__");
    reread("__proto__");
    expect(useEditor.getState().rereads["__proto__"]).toBe(2);
  });
});

describe("a document nobody has read", () => {
  test("finds nothing, whatever it is called", () => {
    const { readings, drafts, done, rereads } = useEditor.getState();
    // Not Object.prototype's: an empty record answers for every name.
    for (const name of ["constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(readings[name]).toBeUndefined();
      expect(drafts[name]).toBeUndefined();
      expect(done[name]).toBeUndefined();
      expect(rereads[name]).toBeUndefined();
      expect(name in readings).toBe(false);
    }
  });
});
