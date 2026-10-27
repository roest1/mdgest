/** Pictures: which drawn images are figures, and where a figure goes among
 *  the text.
 *
 * An image is a figure when it is at least 4pt each way on the page and
 * more than one pixel -- and when it is under 64 pixels on either side,
 * only when it is drawn at least 24pt each way: a bullet drawn as a small
 * bitmap, or a strip of gradient stretched into a bar, is decoration. A
 * figure goes before the text nearest it: its label to the right on the
 * same row, or its caption below. */

import { PARAGRAPH } from "../fixtures/pdf";
import type { Case } from "./case";
import { prose, TOP, X } from "./text";

export const pictures: Case[] = [
  {
    name: "pictures-caption-below",
    about:
      "A figure between two paragraphs goes before its caption, the text under it.",
    pages: [
      (pen) => {
        pen.text(X, TOP, prose(1, 0)[0]);
        pen.image(X, TOP + 20, 200, 120, [100, 60]);
        pen.text(
          X,
          TOP + 160,
          "Figure 1. Pump cross-section, from the intake side.",
        );
        pen.lines(X, TOP + 160 + PARAGRAPH, prose(3, 1), {
          leading: PARAGRAPH,
        });
      },
    ],
    blocks: [
      `p ${prose(1, 0)[0]}`,
      "image p1-i0.png",
      "p Figure 1. Pump cross-section, from the intake side.",
      ...prose(3, 1).map((l) => `p ${l}`),
    ],
    markdown: [
      prose(1, 0)[0],
      "",
      "![page 1 figure 1](doc.assets/p1-i0.png)",
      "",
      "Figure 1. Pump cross-section, from the intake side.",
      "",
      ...prose(3, 1).flatMap((l) => [l, ""]),
    ].join("\n"),
  },
  {
    name: "pictures-label-beside",
    about:
      "A small picture with its label to the right on the same row goes before the label.",
    pages: [
      (pen) => {
        pen.text(X, TOP, prose(1, 0)[0]);
        pen.image(X, TOP + 20, 30, 30, [64, 64]);
        pen.text(X + 40, TOP + 39, "Warning: hot surface.");
        pen.lines(X, TOP + 50 + PARAGRAPH, prose(3, 1), { leading: PARAGRAPH });
      },
    ],
    blocks: [
      `p ${prose(1, 0)[0]}`,
      "image p1-i0.png",
      "p Warning: hot surface.",
      ...prose(3, 1).map((l) => `p ${l}`),
    ],
  },
  {
    name: "pictures-thresholds",
    about:
      "Kept: 100×100px at 4pt, 64×64px at 10pt, 2×2px and a 1×256px strip blown up to 24pt and more each way. Left out: 100×100px at 3.5pt, 20×20px and 63×200px drawn under 24pt, a 1×256px strip drawn 12pt tall, a single pixel at any size, a hairline.",
    pages: [
      (pen) => {
        pen.image(X, TOP, 3.5, 3.5, [100, 100]); // under 4pt: out
        pen.image(X + 40, TOP, 4, 4, [100, 100]); // 4pt: in
        pen.image(X + 80, TOP, 10, 10, [20, 20]); // under 64px each way, drawn small: out
        pen.image(X + 120, TOP, 10, 10, [64, 64]); // 64px each way: in, however small
        pen.image(X + 160, TOP, 10, 30, [63, 200]); // one side under 64px, drawn under 24pt: out
        pen.image(X + 200, TOP, 20, 20, [2, 2]); // few pixels, small: out
        pen.image(X + 240, TOP, 24, 24, [2, 2]); // few pixels, 24pt each way: in
        pen.image(X + 300, TOP, 60, 60, [1, 1]); // a single pixel: out
        pen.image(X, TOP + 80, 400, 12, [1, 256]); // a gradient strip, 12pt tall: out
        pen.image(X, TOP + 120, 400, 30, [1, 256]); // the same strip, 30pt tall: in
        pen.image(X, TOP + 180, 300, 0.75, [300, 1]); // a hairline rule: out
      },
    ],
    blocks: [
      "image p1-i0.png",
      "image p1-i1.png",
      "image p1-i2.png",
      "image p1-i3.png",
    ],
  },
  {
    name: "pictures-inline-run",
    about:
      "Ten inline images in a row are ten figures. Drawing them, pdf.js merges such a run into one operator; the list read.ts asks for is unmerged, and this fails if that changes.",
    pages: [
      (pen) => {
        for (let i = 0; i < 10; i++)
          pen.inline(X + (i % 5) * 60, TOP + Math.floor(i / 5) * 60, 30, 30);
      },
    ],
    blocks: Array.from({ length: 10 }, (_, i) => `image p1-i${i}.png`),
  },
  {
    name: "pictures-mask-run",
    about:
      "Ten different masks in a row are ten figures, though pdf.js groups such a run when it draws them.",
    pages: [
      (pen) => {
        for (let i = 0; i < 10; i++)
          pen.inline(X + (i % 5) * 60, TOP + Math.floor(i / 5) * 60, 30, 30, {
            mask: true,
            shade: i,
          });
      },
    ],
    blocks: Array.from({ length: 10 }, (_, i) => `image p1-i${i}.png`),
  },
  {
    name: "pictures-mask-repeated",
    about:
      "One mask stamped ten times at one size is ten figures, though pdf.js repeats one operator when it draws them.",
    pages: [
      (pen) => {
        for (let i = 0; i < 10; i++)
          pen.inline(X + (i % 5) * 60, TOP + Math.floor(i / 5) * 60, 30, 30, {
            mask: true,
          });
      },
    ],
    blocks: Array.from({ length: 10 }, (_, i) => `image p1-i${i}.png`),
  },
  {
    name: "pictures-undecodable",
    about:
      "An image pdf.js cannot decode is still a figure: the page under it, rendered.",
    pages: [(pen) => pen.undecodable(X, TOP, 100, 100)],
    blocks: ["image p1-i0.png"],
  },
];
