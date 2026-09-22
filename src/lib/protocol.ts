/** What crosses between the page and the engine worker.
 *
 * There is no server, so this is the only boundary the app has -- and it is
 * not one that could have been designed away. OPFS's synchronous handle is not
 * exposed on the main thread, and reading a two-hundred page document on it
 * would freeze the tab regardless. So the engine lives in a worker and this
 * file is the contract.
 *
 * Declared as a map of method -> {params, result} rather than as an interface
 * of functions, because both sides need the *types* separately: the client
 * builds a `Call` and the worker returns a `Reply`, and neither ever holds the
 * other's function. Adding a method here is a type error on the worker until
 * it is handled, which is the point.
 */

// ---- staging --------------------------------------------------------------

/** Where a staged copy of a document came from. `browser` is the workspace
 *  already in OPFS from an earlier visit, seeded into the stage on load so
 *  that resuming it, adding to it and replacing it are all the same flow. */
export type Origin = "workspace" | "loose" | "browser";

/** What a row in the staged listing is, relative to the workspace it will
 *  join. On a fresh workspace every row is `new` and the landing says nothing;
 *  on a continue it marks only what deviates. See docs/storage.md,
 *  "Refusing to lose work". */
export type Status =
  /** In the manifest, and the same bytes. */
  | "unchanged"
  /** Not in the manifest; will be added. */
  | "new"
  /** In the manifest, different bytes underneath. The edits still resolve,
   *  to different blocks -- the mark is what tells a person that. */
  | "revised"
  /** In the manifest, no file. The decisions are kept and wait for it. */
  | "missing"
  /** The same bytes already staged under another id. */
  | "duplicate"
  /** Two different files want the same id. Nothing commits until a person
   *  keeps one. */
  | "conflict";

export interface Candidate {
  sha256: string;
  /** The filename as it arrived, so a conflict can be told apart by it. */
  name: string;
  bytes: number;
  from: Origin;
}

export interface StageRow {
  docId: string;
  status: Status;
  /** Empty when missing, one normally, more than one when in conflict. */
  candidates: Candidate[];
}

export interface StagedWorkspace {
  /** The folder or archive it came from; null for the browser's own. */
  name: string | null;
  origin: "upload" | "browser";
  /** How many documents its manifest lists. */
  listed: number;
}

export interface StageView {
  workspace: StagedWorkspace | null;
  /** Why the workspace in this browser could not be opened, when it could
   *  not. `workspace` is null then, and nothing stages until it is
   *  discarded. */
  unreadable: string | null;
  rows: StageRow[];
}

export interface Engine {
  /** Hold dropped files in worker memory, classified against whatever is
   *  already staged. Nothing is written. `rejected` carries one line per
   *  thing that could not be staged -- a second workspace, an unreadable
   *  manifest -- for the drop zone to show. */
  stage: { params: { files: File[] }; result: { view: StageView; rejected: string[] } };
  /** Take one staged copy out. Refused for the browser's own documents,
   *  which the editor removes, not the landing. */
  unstage: { params: { docId: string; sha256: string }; result: StageView };
  /** Resolve a conflict: keep this copy under the id and set the others
   *  aside. Taking the kept one out later brings them back. */
  keep: { params: { docId: string; sha256: string }; result: StageView };
  /** Resolve a conflict the other way: move this copy to the id `name`
   *  makes, in the same folder, so both stage. Refused onto an id already
   *  staged or listed, and for the browser's own documents. */
  renameCandidate: {
    params: { docId: string; sha256: string; name: string };
    result: StageView;
  };
  /** Forget the staged workspace. When it is the browser's own, readable or
   *  not, this empties OPFS -- the landing confirms first. Loose files stay
   *  staged. */
  discardWorkspace: { params: void; result: StageView };
  /** The current stage. The first call seeds it from OPFS if a workspace is
   *  still there from an earlier visit. */
  stageView: { params: void; result: StageView };
  /** Write the stage to OPFS and clear it. Throws while a conflict stands. */
  commit: { params: void; result: { docs: string[] } };
}

export type Method = keyof Engine;
export type Params<M extends Method> = Engine[M]["params"];
export type Result<M extends Method> = Engine[M]["result"];

export interface Call<M extends Method = Method> {
  id: number;
  method: M;
  params: Params<M>;
}

/** An error crosses as data, because an Error does not survive structured
 *  clone with its type intact -- `postMessage(new TypeError())` arrives as a
 *  plain Error and the name is lost. Carrying it explicitly means the client
 *  can rebuild something a `catch` can still branch on. */
export interface Failure {
  name: string;
  message: string;
  stack?: string;
}

export type Reply<M extends Method = Method> =
  | { id: number; ok: true; result: Result<M> }
  | { id: number; ok: false; error: Failure };

/** Sent once, unprompted, with id 0: that the worker is ready to take calls,
 *  or why it cannot be. The client queues until one arrives rather than
 *  racing the worker's first import. */
export const READY = "__engine_ready__" as const;
export type Startup = { id: 0; ready: typeof READY } | { id: 0; ok: false; error: Failure };
