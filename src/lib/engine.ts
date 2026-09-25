import {
  type Call,
  type Method,
  type Params,
  type Reply,
  type Result,
  type Startup,
} from "./protocol";

interface Pending {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
}

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let sequence = 0;
const pending = new Map<number, Pending>();

/** An error rebuilt from the other side, with its name kept.
 *
 * `postMessage` flattens an Error to a plain one, so a `catch` that branched
 * on `instanceof TypeError` would stop working across the boundary. Carrying
 * the name as data and restoring it here keeps that legible; `cause` holds the
 * worker's own stack, which is where the failure actually happened. */
function rebuild(failure: {
  name: string;
  message: string;
  stack?: string;
}): Error {
  const error = new Error(failure.message, { cause: failure.stack });
  error.name = failure.name;
  return error;
}

function start(): Promise<void> {
  if (ready) return ready;
  // `type: "module"` is what lets the worker use `import`, and it is what sets
  // Firefox's floor: module workers are in Firefox 114. The rest of the floor
  // is in docs/deployment.md.
  worker = new Worker(new URL("./engine.worker.ts", import.meta.url), {
    type: "module",
  });

  ready = new Promise<void>((resolve, reject) => {
    // Everything outstanding fails with the engine, and so does every call
    // after: `ready` stays rejected, so each one says why instead of waiting.
    const fail = (error: Error) => {
      reject(error);
      for (const waiting of pending.values()) waiting.reject(error);
      pending.clear();
    };

    worker!.onmessage = (event: MessageEvent) => {
      const message = event.data as Reply | Startup;

      // Id 0 is the worker's own, and answers the start rather than a call:
      // ready, or the reason it never will be.
      if ("ready" in message) return resolve();
      if (message.id === 0) {
        if (!message.ok) fail(rebuild(message.error));
        return;
      }

      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.ok) waiting.resolve(message.result as never);
      else waiting.reject(rebuild(message.error));
    };

    // A worker whose script fails to load never sends anything, so without
    // this every call would hang instead of failing -- the worst way to be
    // broken.
    worker!.onerror = (event) => fail(new Error(`the engine failed to start: ${event.message}`));
  });

  return ready;
}

async function call<M extends Method>(
  method: M,
  params: Params<M>,
): Promise<Result<M>> {
  await start();
  const id = ++sequence;
  return new Promise<Result<M>>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: never) => void, reject });
    worker!.postMessage({ id, method, params } satisfies Call<M>);
  });
}

/** The engine's methods, one call each. What each does is documented once,
 *  on `Engine` in protocol.ts. */
export const engine = {
  stage: (files: File[]) => call("stage", { files }),
  unstage: (docId: string, sha256: string) => call("unstage", { docId, sha256 }),
  keep: (docId: string, sha256: string) => call("keep", { docId, sha256 }),
  renameCandidate: (docId: string, sha256: string, name: string) =>
    call("renameCandidate", { docId, sha256, name }),
  discardWorkspace: () => call("discardWorkspace", undefined),
  stageView: () => call("stageView", undefined),
  commit: () => call("commit", undefined),
  docs: () => call("docs", undefined),
  source: (docId: string) => call("source", { docId }),
};
