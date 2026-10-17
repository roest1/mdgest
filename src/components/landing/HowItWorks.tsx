import { Fragment } from "react";
import { Section } from "./Section";
import {
  DropVignette,
  ExportVignette,
  InkArrow,
  ReviewVignette,
} from "./Vignettes";

/** Three things a person does, in order. Not the engine's three stages --
 *  those are the README's framing, and someone on this page is asking "what
 *  do I do" before "how does it work". The engine gets the lede. */
const STEPS = [
  {
    name: "Drop your PDFs",
    body: "A single file, a zip, or a whole folder. Folders stay folders.",
    art: DropVignette,
  },
  {
    name: "Review page by page",
    body: `Every block is numbered on the page and in the markdown. Drag to
      reorder, click to edit.`,
    art: ReviewVignette,
  },
  {
    name: "Export Markdown",
    body: `A folder you keep: the markdown, and all embedded PNGs.`,
    art: ExportVignette,
  },
] as const;

export function HowItWorks() {
  return (
    <Section
      id="how"
      title="How it works"
      lede="Deterministic, no model, no network. Three steps, with you in the middle."
    >
      {/* Equal columns for the three steps, with the arrows as auto-width
          tracks between them, so no step's drawing is sized by how long its
          caption happens to be. Below `sm` it stacks and the arrows go. */}
      <ol
        className="flex flex-col items-center gap-10
          sm:grid sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-start sm:gap-x-2"
      >
        {STEPS.map(({ name, body, art: Art }, i) => (
          <Fragment key={name}>
            {i > 0 && (
              <li aria-hidden className="hidden pt-14 sm:block">
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
