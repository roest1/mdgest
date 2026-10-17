/** `opfs.ts` where it runs in the app: in a worker, the one place a
 *  synchronous file handle exists. Each message names an export and its
 *  arguments; the answer is its result, or what it threw. */

import * as opfs from "src/lib/opfs";

type Fn = (...args: unknown[]) => Promise<unknown>;

self.onmessage = async (event: MessageEvent<{ id: number; fn: keyof typeof opfs; args: unknown[] }>) => {
  const { id, fn, args } = event.data;
  try {
    postMessage({ id, value: await (opfs[fn] as Fn)(...args) });
  } catch (cause) {
    postMessage({ id, error: cause instanceof Error ? cause.message : String(cause) });
  }
};
