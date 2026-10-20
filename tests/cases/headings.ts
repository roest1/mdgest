/** Headings: what makes a line one, and what level it gets.
 *
 * A heading is a line set at 1.1 × the body size or larger, or bold at body
 * size without closing punctuation -- unless over 35% of the document is
 * bold, when bold is the body face and says nothing. Levels come from size
 * alone, document-wide: larger is higher, sizes within 8% are one level,
 * and nothing goes deeper than h4. */

import type { Case } from "./case";
import { Flow, joined, prose, X } from "./text";

export const headings: Case[] = [
  {
    name: "headings-four-levels",
    about: "Four heading sizes over 10pt body are h1 to h4, in size order.",
    pages: [
      (pen) =>
        new Flow(pen)
          .heading("Pump Maintenance Manual", 24)
          .para(prose(3, 0))
          .heading("Inspection Schedule", 18)
          .para(prose(3, 3))
          .heading("Yearly Inspection", 14)
          .para(prose(3, 6))
          .heading("Bearing Checks", 12)
          .para(prose(3, 1)),
    ],
    blocks: [
      "h1 Pump Maintenance Manual",
      `p ${joined(prose(3, 0))}`,
      "h2 Inspection Schedule",
      `p ${joined(prose(3, 3))}`,
      "h3 Yearly Inspection",
      `p ${joined(prose(3, 6))}`,
      "h4 Bearing Checks",
      `p ${joined(prose(3, 1))}`,
    ],
    markdown: [
      "# Pump Maintenance Manual",
      "",
      joined(prose(3, 0)),
      "",
      "## Inspection Schedule",
      "",
      joined(prose(3, 3)),
      "",
      "### Yearly Inspection",
      "",
      joined(prose(3, 6)),
      "",
      "#### Bearing Checks",
      "",
      joined(prose(3, 1)),
      "",
    ].join("\n"),
  },
  {
    name: "headings-levels-out-of-order",
    about: "Levels follow size, not the order headings appear in: a small heading first is still the smallest.",
    pages: [
      (pen) =>
        new Flow(pen)
          .heading("Bearing Checks", 12)
          .para(prose(3, 0))
          .heading("Pump Maintenance Manual", 24)
          .para(prose(3, 3))
          .heading("Inspection Schedule", 18)
          .para(prose(3, 6)),
    ],
    blocks: [
      "h3 Bearing Checks",
      `p ${joined(prose(3, 0))}`,
      "h1 Pump Maintenance Manual",
      `p ${joined(prose(3, 3))}`,
      "h2 Inspection Schedule",
      `p ${joined(prose(3, 6))}`,
    ],
  },
  {
    name: "headings-deeper-than-four",
    about: "A fifth heading size is folded into h4: nothing goes deeper by default.",
    pages: [
      (pen) =>
        new Flow(pen)
          .heading("Pump Maintenance Manual", 28, "regular")
          .para(prose(2, 0), { size: 9 })
          .heading("Inspection Schedule", 22)
          .para(prose(2, 2), { size: 9 })
          .heading("Yearly Inspection", 17)
          .para(prose(2, 4), { size: 9 })
          .heading("Bearing Checks", 13)
          .para(prose(2, 6), { size: 9 })
          .heading("Grease Type", 10.5)
          .para(prose(2, 1), { size: 9 }),
    ],
    blocks: [
      "h1 Pump Maintenance Manual",
      `p ${joined(prose(2, 0))}`,
      "h2 Inspection Schedule",
      `p ${joined(prose(2, 2))}`,
      "h3 Yearly Inspection",
      `p ${joined(prose(2, 4))}`,
      "h4 Bearing Checks",
      `p ${joined(prose(2, 6))}`,
      "h4 Grease Type",
      `p ${joined(prose(2, 1))}`,
    ],
  },
  {
    name: "headings-within-eight-percent",
    about: "Heading sizes within 8% of a larger one share its level (24 and 22.5); further apart, they do not (24 and 21.5).",
    pages: [
      (pen) =>
        new Flow(pen)
          .heading("Pump Maintenance Manual", 24)
          .para(prose(3, 0))
          .heading("Inspection Schedule", 22.5)
          .para(prose(3, 3))
          .heading("Yearly Inspection", 21.5)
          .para(prose(3, 6)),
    ],
    blocks: [
      "h1 Pump Maintenance Manual",
      `p ${joined(prose(3, 0))}`,
      "h1 Inspection Schedule",
      `p ${joined(prose(3, 3))}`,
      "h2 Yearly Inspection",
      `p ${joined(prose(3, 6))}`,
    ],
  },
  {
    name: "headings-size-threshold",
    about: "Over 10pt body, 11.1pt is a heading and 10.9pt is not.",
    pages: [
      (pen) =>
        new Flow(pen)
          .heading("Just Large Enough", 11.1)
          .para(prose(3, 0))
          .heading("Not Quite Large Enough", 10.9)
          .para(prose(3, 3)),
    ],
    blocks: [
      "h1 Just Large Enough",
      `p ${joined(prose(3, 0))}`,
      "p Not Quite Large Enough",
      `p ${joined(prose(3, 3))}`,
    ],
  },
  {
    name: "headings-exactly-one-point-one",
    about: "A line at exactly 1.1 × the body size (11pt over 10pt) is a heading: the rule is '1.1 × or larger'.",
    pages: [(pen) => new Flow(pen).heading("Exactly Large Enough", 11).para(prose(3, 0))],
    blocks: ["h1 Exactly Large Enough", `p ${joined(prose(3, 0))}`],
  },
  {
    name: "headings-bold-at-body-size",
    about:
      "A bold line at body size is a heading unless it ends in . , or ; -- a colon or no punctuation keeps it one. Smaller than body, bold is not enough.",
    pages: [
      (pen) =>
        new Flow(pen)
          .line("Inspection Schedule", { face: "bold" })
          .para(prose(3, 0))
          .line("Before you begin:", { face: "bold" })
          .para(prose(3, 3))
          .line("Never run a pump dry.", { face: "bold" })
          .para(prose(3, 6))
          .line("Check the seals, then the gaskets,", { face: "bold" })
          .para(prose(3, 1))
          .line("Valves; fittings; hoses;", { face: "bold" })
          .para(prose(3, 4))
          .line("Small Print Below", { face: "bold", size: 9 })
          .para(prose(3, 7)),
    ],
    blocks: [
      "h1 Inspection Schedule",
      `p ${joined(prose(3, 0))}`,
      "h1 Before you begin:",
      `p ${joined(prose(3, 3))}`,
      "p Never run a pump dry.",
      `p ${joined(prose(3, 6))}`,
      "p Check the seals, then the gaskets,",
      `p ${joined(prose(3, 1))}`,
      "p Valves; fittings; hoses;",
      `p ${joined(prose(3, 4))}`,
      "p Small Print Below",
      `p ${joined(prose(3, 7))}`,
    ],
  },
  {
    name: "headings-bold-as-body-face",
    about: "Just over 35% bold (146 of 406 characters), bold is the body face: a bold line at body size is a paragraph.",
    pages: [
      (pen) =>
        new Flow(pen)
          .line("Inspection Schedule", { face: "bold" })
          .para(prose(2, 0), { face: "bold" })
          .para(prose(4, 2)),
    ],
    blocks: ["p Inspection Schedule", `p ${joined(prose(2, 0))}`, `p ${joined(prose(4, 2))}`],
  },
  {
    name: "headings-bold-just-under-saturation",
    about: "Just under 35% bold (80 of 238 characters), bold still means something: the bold line is a heading.",
    pages: [
      (pen) =>
        new Flow(pen)
          .line("Inspection Schedule", { face: "bold" })
          .para(prose(1, 0), { face: "bold" })
          .para([...prose(2, 2), "Log every repair the same day."]),
    ],
    blocks: [
      "h1 Inspection Schedule",
      `p ${joined(prose(1, 0))}`,
      `p ${joined([...prose(2, 2), "Log every repair the same day."])}`,
    ],
  },
  {
    name: "headings-length-limit",
    about: "A large line of 90 characters is a heading; at 91 it is prose however it is set.",
    pages: [
      (pen) =>
        new Flow(pen)
          .heading(`Inspection Schedule For Every Pump In The Facility And Each Spare Kept On The Shelf ${"x".repeat(6)}`, 11.5)
          .para(prose(3, 0))
          .heading(`Inspection Schedule For Every Pump In The Facility And Each Spare Kept On The Shelf ${"x".repeat(7)}`, 11.5)
          .para(prose(3, 3)),
    ],
    blocks: [
      `h1 Inspection Schedule For Every Pump In The Facility And Each Spare Kept On The Shelf ${"x".repeat(6)}`,
      `p ${joined(prose(3, 0))}`,
      `p Inspection Schedule For Every Pump In The Facility And Each Spare Kept On The Shelf ${"x".repeat(7)}`,
      `p ${joined(prose(3, 3))}`,
    ],
  },
  {
    name: "headings-wrapped",
    about: "A heading set on two lines is one heading.",
    pages: [
      (pen) => {
        pen.lines(X, 100, ["Pump Maintenance Manual for", "Facility Engineering Staff"], { size: 20, leading: 24 });
        pen.lines(X, 160, prose(3, 0));
      },
    ],
    blocks: ["h1 Pump Maintenance Manual for Facility Engineering Staff", `p ${joined(prose(3, 0))}`],
  },
];
