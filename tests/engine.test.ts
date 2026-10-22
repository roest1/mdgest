/** The engine worker's wire: what it does with a call it has no method for. */

import { expect, test } from "vitest";
import type { Reply, Startup } from "src/lib/protocol";

function spawn(): Promise<Worker> {
  return new Promise((resolve, reject) => {
    const w = new Worker(
      new URL("../src/lib/engine.worker.ts", import.meta.url),
      {
        type: "module",
      },
    );
    w.onmessage = (event: MessageEvent<Startup>) => {
      if ("ready" in event.data) resolve(w);
      else reject(new Error(event.data.error.message));
    };
  });
}

function ask(w: Worker, call: unknown): Promise<Reply> {
  return new Promise((resolve) => {
    w.onmessage = (event: MessageEvent<Reply>) => resolve(event.data);
    w.postMessage(call);
  });
}

test("a method the engine does not have is refused, even one an object inherits", async () => {
  const w = await spawn();
  try {
    for (const method of [
      "nothing",
      "constructor",
      "toString",
      "hasOwnProperty",
    ]) {
      const reply = await ask(w, { id: 1, method, params: {} });
      expect(reply.ok).toBe(false);
      if (!reply.ok)
        expect(reply.error.message).toBe(`no such engine method: ${method}`);
    }
  } finally {
    w.terminate();
  }
});

test("a message that is not a call is answered, not left hanging", async () => {
  const w = await spawn();
  try {
    for (const bad of [null, "stage", 7, {}]) {
      const reply = await ask(w, bad);
      expect(reply.ok).toBe(false);
      if (!reply.ok)
        expect(reply.error.message).toBe("not an engine call: no method");
    }
  } finally {
    w.terminate();
  }
});
