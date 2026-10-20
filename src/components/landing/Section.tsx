import type { ReactNode } from "react";

/** The shared frame below the fold: one measure, one rhythm, a heading
 *  that reads as a label rather than a shout. */
export function Section({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mx-auto w-full max-w-3xl px-4 py-16 sm:py-20">
      <h2 className="text-center font-serif text-2xl font-semibold tracking-tight text-ink">
        {title}
      </h2>
      {lede && <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted">{lede}</p>}
      <div className="mt-8">{children}</div>
    </section>
  );
}
