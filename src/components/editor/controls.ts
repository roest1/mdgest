/** A bar button that is only an icon. */
export const iconButton =
  "cursor-pointer rounded p-1 text-muted transition-colors enabled:hover:text-ink disabled:cursor-default disabled:opacity-40";

/** A bar button with a word on it. Lit when what it shows is on. */
export const barButton = (lit = false) =>
  `flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 transition-colors
  disabled:cursor-default disabled:opacity-40 ${
    lit
      ? "border-edge-strong bg-raised text-ink"
      : "border-edge bg-raised/40 text-muted enabled:hover:bg-raised enabled:hover:text-ink"
  }`;
