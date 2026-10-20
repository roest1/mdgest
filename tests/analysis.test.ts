/** The gate on a stored analysis: what `parseAnalysis` refuses, and the
 *  name it refuses under -- which is what tells the page to read the
 *  document again rather than show a person a file they cannot fix
 *  (`convert.ts`). */

import { describe, expect, test } from "vitest";
import {
  ANALYSIS_FORMAT,
  parseAnalysis,
  READER,
  UNUSABLE_ANALYSIS,
  type Analysis,
} from "src/lib/analysis";

const page = { n: 1, width: 612, height: 792, lines: [], pictures: [], blocks: [] };
const stored = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ format: ANALYSIS_FORMAT, reader: READER, bodySize: 10, pages: [page], ...over });

describe("parseAnalysis", () => {
  test("reads back what structure wrote", () => {
    const a: Analysis = parseAnalysis(stored());
    expect(a.format).toBe(ANALYSIS_FORMAT);
    expect(a.reader).toBe(READER);
    expect(a.bodySize).toBe(10);
    expect(a.pages).toHaveLength(1);
  });

  test("an analysis from before the fields carried a reader or a body size is the first reader's", () => {
    const a = parseAnalysis(stored({ reader: undefined, bodySize: undefined }));
    expect(a.reader).toBe(1);
    expect(a.bodySize).toBe(0);
  });

  const refusals: [string, string][] = [
    ["is not valid JSON", "{ not json"],
    ["is not a JSON object", "[]"],
    ["is in a format this version does not read", stored({ format: ANALYSIS_FORMAT + 1 })],
    ["has no pages", stored({ pages: undefined })],
    ["has a page that is not one", stored({ pages: [{ n: 1 }] })],
    ["has a page that is null", stored({ pages: [null] })],
  ];

  for (const [what, text] of refusals) {
    test(`refuses one that ${what}, as something to read again`, () => {
      expect(() => parseAnalysis(text)).toThrow(/^its analysis\.json .*\.$/);
      // The name, not the message: `convert.ts` branches on it to tell a
      // file this build cannot use from a failure of the engine itself.
      let name = "";
      try {
        parseAnalysis(text);
      } catch (cause) {
        name = (cause as Error).name;
      }
      expect(name).toBe(UNUSABLE_ANALYSIS);
    });
  }
});
