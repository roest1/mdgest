/** Write every reader case out as a PDF, to look at or to open in mdgest:
 *  `tests/out/<group>/<case>.pdf`. Drop the folder on the landing page and
 *  each case is a document, in a folder named for what it covers. */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { cases } from "../cases";
import { buildPdf } from "./pdf";

const out = new URL("../out/", import.meta.url);
rmSync(out, { recursive: true, force: true });
let n = 0;
for (const [group, list] of Object.entries(cases)) {
  mkdirSync(new URL(`${group}/`, out), { recursive: true });
  for (const c of list) {
    writeFileSync(
      new URL(`${group}/${c.name}.pdf`, out),
      await buildPdf(c.pages),
    );
    n += 1;
  }
}
console.log(`Wrote ${n} fixtures to tests/out/.`);
