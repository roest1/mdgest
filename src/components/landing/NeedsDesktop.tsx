import { Brand } from "./Brand";

/** What a phone gets instead of the app. Rendered in place of the routes, not
 *  over them, so nothing behind it starts a worker or reads a PDF  */
export function NeedsDesktop() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 p-4 text-center">
      <Brand />
      <p className="max-w-xs text-sm text-muted">
        mdgest needs a desktop browser or a tablet. A phone does not have the
        memory to read a PDF here, or the room to show it beside its markdown.
      </p>
    </div>
  );
}
