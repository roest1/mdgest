import { ViewTransition, type ReactNode, type Ref } from "react";
import { SIDEBAR, SLIDE } from "./transitions";

/** A pane: its bar, then what it shows. Both panes draw the same bar -- a
 *  group at each side and one in the middle, on the pane's center line
 *  whatever the sides hold -- and differ in everything under it, so the
 *  body is the pane's own: its scroller, and whatever it keeps a ref to.
 *
 *  As the explorer resizes the pane, the bar's line stretches to its new
 *  width and each group slides to its new place, while the body fades. */
export function Pane({
  left,
  center,
  right,
  children,
  ref,
}: {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} className="flex h-full min-h-0 flex-col">
      <ViewTransition update={{ [SIDEBAR]: "bar", default: "none" }}>
        <div
          data-bar
          className="grid h-9 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-edge px-3 text-xs text-muted"
        >
          <ViewTransition update={SLIDE}>
            <div className="flex items-center gap-1.5 justify-self-start">
              {left}
            </div>
          </ViewTransition>
          <ViewTransition update={SLIDE}>
            <div className="flex items-center gap-2">{center}</div>
          </ViewTransition>
          <ViewTransition update={SLIDE}>
            <div className="flex items-center gap-1.5 justify-self-end">
              {right}
            </div>
          </ViewTransition>
        </div>
      </ViewTransition>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
