/** Words to set, and where. Every line here has a capital and a descender,
 *  so every line's ink box is the same height and the gaps between them
 *  are what a case says they are. */

import { PARAGRAPH, type Face, type Pen, type Style } from "../fixtures/pdf";

/** The left margin. */
export const X = 72;
/** The first baseline on a page. */
export const TOP = 96;

const LINES = [
  "Pumps are inspected yearly by the facility engineering group.",
  "Spare gaskets are kept in the supply room beside the loading dock.",
  "Any reading outside the posted range is reported the same day.",
  "Grease the pump bearings quarterly with the approved lithium type.",
  "Replace any coupling that shows play greater than a quarter turn.",
  "Keep the strainer baskets clear; a clogged basket starves the pump.",
  "Log every repair, giving the date, the part, and the technician.",
  "Pressure gauges are calibrated against the shop reference gauge.",
];

/** `n` lines of prose, each a sentence, about sixty characters long. */
export function prose(n: number, from = 0): string[] {
  return Array.from({ length: n }, (_, i) => LINES[(from + i) % LINES.length]);
}

/** The same lines as one paragraph's text, the way a block joins them. */
export function joined(lines: string[]): string {
  return lines.join(" ");
}

/** A column written top to bottom with clear space between blocks: for
 *  cases about what a block is, not where one ends. */
export class Flow {
  private pen: Pen;
  x: number;
  /** The next baseline. */
  y: number;

  constructor(pen: Pen, x = X, y = TOP) {
    this.pen = pen;
    this.x = x;
    this.y = y;
  }

  heading(text: string, size: number, face: Face = "regular"): this {
    this.y += size * 0.5;
    this.pen.text(this.x, this.y, text, { size, face });
    this.y += size + 14;
    return this;
  }

  para(lines: string[], style: Style = {}): this {
    this.y = this.pen.lines(this.x, this.y, lines, style) + PARAGRAPH;
    return this;
  }

  /** One line, at `x` from the margin, with a paragraph's space after it. */
  line(text: string, style: Style & { indent?: number } = {}): this {
    this.pen.text(this.x + (style.indent ?? 0), this.y, text, style);
    this.y += PARAGRAPH;
    return this;
  }
}
