/** Pages of the markdown parsed off the page's thread: each message a few
 *  pages' text, each answer their trees, in order (`parse.ts`). Holds
 *  nothing between messages, so any worker of the pool can take any batch.
 *
 * Built for a worker: `decode-named-character-reference`, which the parser
 * decodes `&copy;` and its like with, has a DOM build that makes an element
 * to decode them with, and a worker has no `document`. `vite.config.ts`
 * resolves it to the build that carries the table instead, here. */

import { toHast } from "./hast";
import type { ParseAnswer, ParseAsk } from "./parse";

/** The worker global, declared narrowly, as `engine.worker.ts` does. */
declare const self: {
  onmessage: ((event: MessageEvent<ParseAsk>) => void) | null;
  postMessage(message: ParseAnswer): void;
};

self.onmessage = ({ data: { id, texts } }) => {
  let answer: ParseAnswer;
  try {
    answer = { id, ok: true, trees: texts.map(toHast) };
  } catch (error) {
    answer = {
      id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  self.postMessage(answer);
};
