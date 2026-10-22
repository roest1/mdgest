/** Running a module where the app runs it -- in a worker, over a real OPFS
 *  -- and calling into it from a test.
 *
 *  One wire for every such test: a message names a module, an export of it
 *  and its arguments; the answer is the result, or what it threw, as a
 *  message. `serve` is the worker's half and `Client` the test's. */

import { strToU8, zipSync } from "fflate";
import { messageOf } from "src/lib/words";

type Fn = (...args: unknown[]) => Promise<unknown>;
export type Modules = Record<string, Record<string, Fn>>;

interface Call {
  id: number;
  mod: string;
  fn: string;
  args: unknown[];
}
interface Answer {
  id: number;
  value?: unknown;
  error?: string;
}

/** The worker side: answer each call with `modules[mod][fn](...args)`. */
export function serve(modules: Modules): void {
  self.onmessage = async (event: MessageEvent<Call>) => {
    const { id, mod, fn, args } = event.data;
    try {
      postMessage({ id, value: await modules[mod][fn](...args) } as Answer);
    } catch (cause) {
      postMessage({ id, error: messageOf(cause) } as Answer);
    }
  };
}

/** A module's exports, each as a call across the wire. */
export type Bound<Api> = <K extends keyof Api>(
  fn: K,
  ...args: Api[K] extends (...args: infer P) => unknown ? P : never
) => Promise<Api[K] extends (...args: never[]) => infer R ? Awaited<R> : never>;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

/** The test side: a worker and the calls outstanding on it. `restart`
 *  replaces the worker with a fresh one, for a module that keeps state in
 *  its own scope and has to start from nothing. */
export class Client {
  private readonly url: URL;
  private worker: Worker;
  private next = 0;
  private readonly pending = new Map<number, Pending>();

  constructor(url: URL) {
    this.url = url;
    this.worker = this.spawn();
  }

  private spawn(): Worker {
    const worker = new Worker(this.url, { type: "module" });
    worker.onmessage = (event: MessageEvent<Answer>) => {
      const { id, value, error } = event.data;
      const call = this.pending.get(id);
      this.pending.delete(id);
      if (error === undefined) call?.resolve(value);
      else call?.reject(new Error(error));
    };
    return worker;
  }

  restart(): void {
    this.worker.terminate();
    this.pending.clear();
    this.worker = this.spawn();
  }

  call(mod: string, fn: string, args: unknown[]): Promise<unknown> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, mod, fn, args } satisfies Call);
    });
  }

  bind<Api>(mod: string): Bound<Api> {
    return (fn, ...args) =>
      this.call(mod, fn as string, args) as ReturnType<Bound<Api>>;
  }
}

const enc = new TextEncoder();
export const bytes = (text: string): Uint8Array<ArrayBuffer> =>
  enc.encode(text);

/** A zip of `files`, each entry's bytes the text it maps to. */
export const zipOf = (files: Record<string, string>): Uint8Array<ArrayBuffer> =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, text]) => [path, strToU8(text)]),
    ),
  ) as Uint8Array<ArrayBuffer>;
