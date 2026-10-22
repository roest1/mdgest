/** `opfs.ts` and `stage.ts` where they run in the app: in a worker, the
 *  one place a synchronous file handle exists. Served over the wire in
 *  `harness.ts`.
 *
 *  `harness` reaches the move under `replaceFile`, whose fallback writes
 *  the same bytes and so cannot be told from it by what lands: `moves`
 *  answers how many moves have gone through, and `refuseMoves` makes every
 *  move after it throw, or stop throwing. */

import * as opfs from "src/lib/opfs";
import * as stage from "src/lib/stage";
import { serve, type Modules } from "./harness";

let moves = 0;
let refuse = false;
const move = FileSystemFileHandle.prototype.move;
FileSystemFileHandle.prototype.move = async function (
  this: FileSystemFileHandle,
  ...args
) {
  if (refuse)
    throw new DOMException("refused by the test", "InvalidModificationError");
  await move.apply(this, args);
  moves++;
};

export interface Harness {
  moves(): Promise<number>;
  refuseMoves(on: boolean): Promise<void>;
}
const harness: Harness = {
  moves: async () => moves,
  refuseMoves: async (on) => {
    refuse = on;
  },
};

serve({ opfs, stage, harness } as unknown as Modules);
