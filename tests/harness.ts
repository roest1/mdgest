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

/** What `pdfOf` writes besides the pages: an info dictionary of plain
 *  strings, a flat outline whose entries each point at the top of a page,
 *  or at a left edge and a height on it in points from the bottom-left
 *  corner, and a /Rotate for every page. */
export interface PdfExtras {
  info?: Record<string, string>;
  outline?: { title: string; page: number; left?: number; top?: number }[];
  rotate?: number;
}

/** A PDF of blank pages, one per size given, in points, each with its number
 *  written on it in Helvetica -- so opening it fetches a standard font the
 *  way a real document does. Assembled by hand, offsets and all, so the
 *  tests need no PDF library and no document of anyone's. */
export function pdfOf(
  sizes: [number, number][],
  { info, outline = [], rotate }: PdfExtras = {},
): Uint8Array<ArrayBuffer> {
  const objects: string[] = [];
  /** Reserve an object's number now and write its body later, so objects
   *  can point at ones written after them. */
  const reserve = () => objects.push("") as number;
  const set = (n: number, body: string) => (objects[n - 1] = body);
  // Strings as PDF literals: the three characters that need escaping.
  const literal = (text: string) => `(${text.replace(/[\\()]/g, "\\$&")})`;

  const catalog = reserve();
  const pages = reserve();
  const font = reserve();
  const pageRefs = sizes.map(() => reserve());
  const contents = sizes.map(() => reserve());
  const outlines = outline.length ? reserve() : null;
  const entries = outline.map(() => reserve());
  const infoRef = info ? reserve() : null;

  set(
    catalog,
    `<< /Type /Catalog /Pages ${pages} 0 R${outlines ? ` /Outlines ${outlines} 0 R` : ""} >>`,
  );
  set(
    pages,
    `<< /Type /Pages /Count ${sizes.length} /Kids [${pageRefs.map((n) => `${n} 0 R`).join(" ")}] >>`,
  );
  set(font, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  sizes.forEach(([w, h], i) => {
    const text = `BT /F1 24 Tf 36 ${h - 60} Td (Page ${i + 1}) Tj ET`;
    set(
      pageRefs[i],
      `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${w} ${h}]${rotate ? ` /Rotate ${rotate}` : ""} /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contents[i]} 0 R >>`,
    );
    set(
      contents[i],
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    );
  });
  if (outlines) {
    set(
      outlines,
      `<< /Type /Outlines /First ${entries[0]} 0 R /Last ${entries.at(-1)} 0 R /Count ${entries.length} >>`,
    );
    outline.forEach(({ title, page, left, top }, i) => {
      const links = [
        i > 0 ? `/Prev ${entries[i - 1]} 0 R` : "",
        i < entries.length - 1 ? `/Next ${entries[i + 1]} 0 R` : "",
      ].join(" ");
      set(
        entries[i],
        `<< /Title ${literal(title)} /Parent ${outlines} 0 R ${links} /Dest [${pageRefs[page - 1]} 0 R /XYZ ${left ?? "null"} ${top ?? "null"} null] >>`,
      );
    });
  }
  if (infoRef) {
    set(
      infoRef,
      `<< ${Object.entries(info!)
        .map(([key, value]) => `/${key} ${literal(value)}`)
        .join(" ")} >>`,
    );
  }

  let out = "%PDF-1.7\n";
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) out += `${String(at).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${infoRef ? ` /Info ${infoRef} 0 R` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return bytes(out);
}
