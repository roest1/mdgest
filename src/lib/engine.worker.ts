/** The engine, on the other side of the boundary.
 *
 * Everything that touches storage runs here: OPFS's synchronous handle is not
 * available on the main thread, and the reading and structuring work that will
 * land next has no business on the thread that paints.
 *
 * The dispatch table is exhaustive over `Engine` by construction -- a method
 * added to the protocol without a handler here fails to typecheck.
 */

import * as opfs from "./opfs";
import * as stage from "./stage";
import { messageOf } from "./words";
import {
  READY,
  type Call,
  type Failure,
  type Method,
  type Params,
  type Reply,
  type Result,
  type Startup,
} from "./protocol";

/** The worker global, declared narrowly. `DedicatedWorkerGlobalScope` lives in
 *  the `WebWorker` lib, which cannot be added alongside `DOM` for the whole
 *  program -- and two members is all this file uses. */
declare const self: {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

type Handlers = { [M in Method]: (params: Params<M>) => Promise<Result<M>> };

const handlers: Handlers = {
  stage: ({ files }) => stage.stage(files),
  unstage: ({ docId, sha256 }) => stage.unstage(docId, sha256),
  keep: ({ docId, sha256 }) => stage.keep(docId, sha256),
  renameCandidate: ({ docId, sha256, name }) => stage.renameCandidate(docId, sha256, name),
  discardWorkspace: () => stage.discardWorkspace(),
  stageView: () => stage.stageView(),
  commit: () => stage.commit(),
  docs: () => stage.docs(),
  source: ({ docId }) => stage.source(docId),
};

/** Which buffers of a method's result are handed over rather than cloned.
 *  Part of the method's contract, next to its handler: `source` gives up a
 *  document's bytes, since the worker has no further use for them and a
 *  clone would hold a large PDF twice. */
const transfers: { [M in Method]?: (result: Result<M>) => Transferable[] } = {
  source: (bytes) => [bytes.buffer],
};

function failure(cause: unknown): Failure {
  if (cause instanceof Error) {
    return { name: cause.name, message: cause.message, stack: cause.stack };
  }
  return { name: "Error", message: String(cause) };
}

self.onmessage = async (event: MessageEvent) => {
  const call = event.data as Call;
  try {
    const handle = handlers[call.method];
    if (!handle) throw new Error(`no such engine method: ${call.method}`);
    const result = await handle(call.params as never);
    // The casts in the file. Each handler and transfer entry is checked
    // against its own `Result<M>` above, but looking one up by a runtime
    // `call.method` erases which M this is, and no assertion can put it back.
    const transfer = (transfers[call.method] as ((r: unknown) => Transferable[]) | undefined)?.(
      result,
    );
    self.postMessage({ id: call.id, ok: true, result } as Reply, transfer ?? []);
  } catch (cause) {
    self.postMessage({ id: call.id, ok: false, error: failure(cause) } satisfies Reply);
  }
};

// The workspace exists before the first call, so an empty origin lists as
// empty rather than as a directory that is not there. Where it cannot be made,
// nothing else here can work either, and the page is told why in place of
// READY -- every call it makes then fails with this, instead of waiting.
opfs
  .ensureWorkspace()
  .then(() => self.postMessage({ id: 0, ready: READY } satisfies Startup))
  .catch((cause: unknown) =>
    self.postMessage({
      id: 0,
      ok: false,
      error: failure(
        new Error(
          "This browser is not letting mdgest store files, so nothing can be added. A private " +
            "window, blocked site data, or a page not served over HTTPS will do that " +
            `(${messageOf(cause)}).`,
        ),
      ),
    } satisfies Startup),
  );
