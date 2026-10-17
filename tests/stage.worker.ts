/** `stage.ts` where it runs in the app: in a worker, over a real OPFS.
 *
 * Each message names a module -- the stage itself, or the file layer under
 * it, for emptying between tests -- an export of it, and its arguments. The
 * answer is the result, or what it threw. */

import * as opfs from "src/lib/opfs";
import * as stage from "src/lib/stage";

type Fn = (...args: unknown[]) => Promise<unknown>;
const modules = { stage, opfs } as unknown as Record<string, Record<string, Fn>>;

self.onmessage = async (
  event: MessageEvent<{ id: number; mod: string; fn: string; args: unknown[] }>,
) => {
  const { id, mod, fn, args } = event.data;
  try {
    postMessage({ id, value: await modules[mod][fn](...args) });
  } catch (cause) {
    postMessage({ id, error: cause instanceof Error ? cause.message : String(cause) });
  }
};
