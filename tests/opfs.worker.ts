/** `opfs.ts` where it runs in the app: in a worker, the one place a
 *  synchronous file handle exists. Each message names an export and its
 *  arguments; the answer is its result, or what it threw.
 *
 *  Two more names reach the move under `replaceFile`, whose fallback writes
 *  the same bytes and so cannot be told from it by what lands: `moves`
 *  answers how many moves have gone through, and `refuseMoves` makes every
 *  move after it throw, or stop throwing. */

import * as opfs from "src/lib/opfs";

type Fn = (...args: unknown[]) => Promise<unknown>;

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

const harness: Record<string, Fn> = {
  moves: async () => moves,
  refuseMoves: async (on) => {
    refuse = on as boolean;
  },
};

self.onmessage = async (
  event: MessageEvent<{ id: number; fn: string; args: unknown[] }>,
) => {
  const { id, fn, args } = event.data;
  try {
    const call = harness[fn] ?? (opfs[fn as keyof typeof opfs] as Fn);
    postMessage({ id, value: await call(...args) });
  } catch (cause) {
    postMessage({
      id,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
};
