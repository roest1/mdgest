#!/usr/bin/env node
/**
 * Read a PDF with pdf.js and write what `mdgest.pdfjs.read` expects.
 *
 * This is the browser build's reader, run from the shell so the conformance
 * test has something to check pdfium against without a browser. The fields
 * are exactly what the reader consumes and nothing more, so the committed
 * dumps stay small and a diff on one is readable.
 *
 *   node scripts/dump_pdfjs.mjs <pdf> <out.json>
 *
 * Needs `pdfjs-dist` resolvable — `bun add -d pdfjs-dist` under web/.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// pdfjs-dist is a dependency of the web app, so resolve from web/ rather than
// from this script — there is no node_modules at the repo root and there
// should not be one just to run this.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(ROOT, "web", "package.json"));
const DIST = dirname(require.resolve("pdfjs-dist/package.json"));
const pdfjs = await import(join(DIST, "legacy/build/pdf.mjs"));

const [, , src, out] = process.argv;
if (!src || !out) {
  console.error("usage: dump_pdfjs.mjs <pdf> <out.json>");
  process.exit(2);
}

// Round to 3dp: below that is float noise that would churn the committed
// dumps without changing a single decision downstream.
const r3 = (v) => Math.round(v * 1000) / 1000;

const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(src)),
  // Without these the base-14 faces load no metrics and every ascent is a
  // guess; the fixtures are base-14 only, so this is not optional.
  standardFontDataUrl: join(DIST, "standard_fonts/"),
  fontExtraProperties: true,
  useSystemFonts: false,
}).promise;

/**
 * What the font's own tables say about weight and slant.
 *
 * pdf.js decides `font.bold` / `font.italic` with a regex over the font name
 * (`pdf.worker.mjs`: `this.bold = /bold/i.test(fontName)`) and never reads
 * /Flags ForceBold or /ItalicAngle, though it parses both. A subset face named
 * `ABCDEF+f-1-0` is therefore never bold to pdf.js no matter how bold it is.
 *
 * But pdf.js does hand over the font it built, and for an embedded face that
 * carries the original OS/2 and head tables. Those say it properly:
 *   fsSelection  bit 0 italic, bit 5 bold, bit 6 regular
 *   macStyle     bit 0 bold,   bit 1 italic
 *   usWeightClass 100..900
 * so read them and let the reader decide. Reported raw rather than as a
 * verdict: the decision belongs next to the rest of the engine's decisions,
 * and a raw number is debuggable when a document argues with it.
 *
 * Two things this cannot reach. A font pdf.js converts from CFF/Type1 gets a
 * *synthesized* OS/2 whose usWeightClass is the hardcoded 500, so 500 means
 * "no opinion" rather than medium. And a font that is neither embedded nor
 * one of the standard 14 gets no data at all — see `doc-c.pdf`, where the
 * weight lives only in the /FontDescriptor and nothing here can see it.
 */
function faceTables(font) {
  const blank = { weight: null, macStyle: null, fsSelection: null, italicAngle: null };
  if (!font.data) return blank;
  const bytes = font.data instanceof Uint8Array ? font.data : Uint8Array.from(Object.values(font.data));
  if (bytes.length < 12) return blank;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = { ...blank };
  try {
    const count = dv.getUint16(4);
    for (let i = 0; i < count; i++) {
      const entry = 12 + i * 16;
      if (entry + 16 > bytes.length) break;
      const tag = String.fromCharCode(dv.getUint8(entry), dv.getUint8(entry + 1), dv.getUint8(entry + 2), dv.getUint8(entry + 3));
      const at = dv.getUint32(entry + 8);
      const len = dv.getUint32(entry + 12);
      if (at + len > bytes.length) continue;
      if (tag === "OS/2" && len >= 64) {
        out.weight = dv.getUint16(at + 4);
        out.fsSelection = dv.getUint16(at + 62);
      } else if (tag === "head" && len >= 46) {
        out.macStyle = dv.getUint16(at + 44);
      } else if (tag === "post" && len >= 8) {
        out.italicAngle = dv.getInt32(at + 4) / 65536;
      }
    }
  } catch {
    return blank; // a malformed table is not worth failing a document over
  }
  return out;
}

const pages = [];
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: 1 });
  // Fonts reach commonObjs while the operator list is built, not while the
  // text content is; ask for it first or every font comes back unresolved.
  await page.getOperatorList();
  const content = await page.getTextContent();
  const items = [];
  for (const item of content.items) {
    if (item.type) continue; // marked-content boundaries carry no text
    let font = null;
    try {
      const f = page.commonObjs.get(item.fontName);
      // `f.bold` / `f.italic` are deliberately not passed on: they are a regex
      // over the name and nothing else, which the reader can do itself and
      // then explain. faceTables() is the part pdf.js does not offer.
      font = {
        name: f.name,
        ascent: f.ascent ?? null,
        descent: f.descent ?? null,
        ...faceTables(f),
      };
    } catch {
      font = null; // a font that never resolved; the reader falls back
    }
    items.push({
      str: item.str,
      transform: item.transform.map(r3),
      width: r3(item.width),
      height: r3(item.height),
      hasEOL: !!item.hasEOL,
      font,
    });
  }
  pages.push({ n, width: r3(viewport.width), height: r3(viewport.height), items });
}

writeFileSync(out, JSON.stringify({ source: basename(src), pages }, null, 1) + "\n");
console.error(`${basename(src)}: ${pages.length} pages, ${pages.reduce((a, p) => a + p.items.length, 0)} items -> ${out}`);
