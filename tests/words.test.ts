/** Words for a person: the helpers every sentence in the app reaches for. */

import { describe, expect, test } from "vitest";
import { few, plural } from "src/lib/words";

describe("few", () => {
  test("names a few and counts the rest", () => {
    expect(few([])).toBe("");
    expect(few(["a"])).toBe("a");
    expect(few(["a", "b", "c"])).toBe("a, b, c");
    expect(few(["a", "b", "c", "d"])).toBe("a, b, c and 1 more");
    expect(few(["a", "b", "c", "d", "e"], 2)).toBe("a, b and 3 more");
  });
});

describe("plural", () => {
  test("takes an s past one", () => {
    expect(plural(1, "file")).toBe("1 file");
    expect(plural(2, "file")).toBe("2 files");
  });
});
