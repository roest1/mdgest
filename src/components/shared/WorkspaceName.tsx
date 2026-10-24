import { useRef, useState } from "react";
import { messageOf } from "src/lib/words";

/** The workspace's name, and the place to change it: a click makes it a
 *  field, Enter or clicking away keeps what was typed, Escape gives it up.
 *  A workspace made of loose PDFs has no name until someone gives it one,
 *  and says so. The editor's header and the landing's listing both show
 *  it, since it is also what an export is named after.
 *
 * `className` sizes and aligns it for where it sits, field and label
 * alike. */
export function WorkspaceName({
  name,
  onRename,
  className = "",
}: {
  name: string | null;
  onRename: (name: string) => Promise<void>;
  className?: string;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Escape blurs the field too, and the blur is where a name is kept; this
  // is how the blur tells the two apart.
  const dropped = useRef(false);

  const finish = () => {
    const next = typed?.trim();
    setTyped(null);
    if (dropped.current || !next || next === name) return;
    onRename(next).catch((cause: unknown) => setProblem(messageOf(cause)));
  };

  if (typed !== null) {
    return (
      <input
        autoFocus
        value={typed}
        aria-label="Workspace name"
        onChange={(e) => setTyped(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== "Escape") return;
          dropped.current = e.key === "Escape";
          e.currentTarget.blur();
        }}
        className={`rounded border border-edge bg-ground px-2 py-0.5 text-ink outline-none focus:border-muted ${className}`}
      />
    );
  }
  return (
    <button
      type="button"
      title={problem ?? "Rename workspace"}
      onClick={() => {
        dropped.current = false;
        setProblem(null);
        setTyped(name ?? "");
      }}
      className={`cursor-text truncate rounded px-2 py-0.5 transition-colors hover:bg-edge/60 ${
        problem
          ? "text-red-300"
          : name
            ? "text-muted hover:text-ink"
            : "text-faint italic"
      } ${className}`}
    >
      {problem ?? name ?? "untitled workspace"}
    </button>
  );
}
