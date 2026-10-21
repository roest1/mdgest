import { Fragment } from "react";
import { Section } from "../Section";
import {
  DropIllustration,
  ExportIllustration,
  InkArrow,
  ReviewIllustration,
} from "./Illustrations";

/** Three things a person does, in order. Not the engine's three stages --
 *  those are the README's framing, and someone on this page is asking "what
 *  do I do" before "how does it work". The engine gets the lede. */
const STEPS = [
  {
    name: "Drop your PDFs",
    body: "A single file, a zip, or a whole folder. Folders stay folders.",
    art: DropIllustration,
  },
  {
    name: "Review page by page",
    body: `Every block is numbered on the page and in the markdown. Drag to
      reorder, click to edit.`,
    art: ReviewIllustration,
  },
  {
    name: "Export Markdown",
    body: `Saved to your machine: a workspace to resume from later or just the Markdown.`,
    art: ExportIllustration,
  },
] as const;

export function HowItWorks() {
  return (
    <Section
      id="how"
      title="How it works"
      lede="No account and no uploads: your PDFs stay in this browser until you export them."
    >
      {/* Equal columns for the three steps, with the arrows as auto-width
          tracks between them, so no step's drawing is sized by how long its
          caption happens to be. Below `sm` it stacks and the arrows go.

          `role="list"` because preflight strips the list style, and WebKit
          drops a styleless list's semantics with it. The arrows have to be
          `li` to be valid children of `ol`, so they are `presentation`:
          `aria-hidden` alone hides their content but still counts them, and
          the screen reader would announce five items with the steps at one,
          three and five. */}
      <ol
        role="list"
        className="flex flex-col items-center gap-10
          sm:grid sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-start sm:gap-x-2"
      >
        {STEPS.map(({ name, body, art: Art }, i) => (
          <Fragment key={name}>
            {i > 0 && (
              <li
                role="presentation"
                aria-hidden
                className="hidden pt-14 sm:block"
              >
                <InkArrow seed={i} />
              </li>
            )}
            <li className="flex w-full max-w-[240px] flex-col items-center text-center">
              <div className="relative w-full px-4">
                <span
                  className="absolute -left-1 top-0 font-serif text-4xl font-semibold
                    leading-none text-ink"
                >
                  {i + 1}
                </span>
                <Art />
              </div>
              <h3 className="mt-3 text-base font-medium text-ink">{name}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                {body}
              </p>
            </li>
          </Fragment>
        ))}
      </ol>
    </Section>
  );
}
