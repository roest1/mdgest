import { CircleCheck, Minus } from "lucide-react";
import { Section } from "./Section";

/** Two lists side by side, on purpose: the promises mean more next to the
 *  things that are not promised. Both come from the README. */
const KEPT = [
  "Every line of text in the PDF makes it into the markdown.",
  "Every picture in the PDF makes it into the markdown.",
  "Nothing you upload leaves your machine. There is no server to send it to.",
  "Folder structure is kept.",
];

const NOT_YET = ["Math equations", "Tables", "Hyperlinks", "Rotated pages"];

export function Guarantees() {
  return (
    <Section
      id="guarantees"
      title="What you can count on"
      lede="And what you cannot, yet. Both lists are short enough to be true."
    >
      <div className="grid gap-10 sm:grid-cols-[3fr_2fr] sm:gap-8">
        <ul className="space-y-3">
          {KEPT.map((line) => (
            <li
              key={line}
              className="flex gap-3 text-sm leading-relaxed text-ink/90"
            >
              <CircleCheck
                className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400"
                aria-hidden
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-wider text-faint">
            not yet
          </h3>
          <ul className="mt-3 space-y-2">
            {NOT_YET.map((line) => (
              <li
                key={line}
                className="flex items-center gap-3 text-sm text-muted"
              >
                <Minus className="h-4 w-4 shrink-0 text-faint" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
