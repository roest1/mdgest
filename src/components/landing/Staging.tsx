import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Spinner } from "src/components/shared/Spinner";
import { FileTree } from "src/components/shared/FileTree";
import type { Candidate, StageRow, StageView, Status } from "src/lib/protocol";
import type { Entry, Mark } from "src/lib/tree";
import { human, messageOf, plural } from "src/lib/words";
import { basename, renamedId } from "src/lib/workspace";

/** The trailing word for each status, on a continue. Only what deviates from
 *  what the button will do is marked: `unchanged` says nothing here, and on a
 *  fresh workspace `new` says nothing either, since every row is. */
const MARKS: Record<Status, Mark | null> = {
  unchanged: null,
  new: { text: "new", tone: "blue" },
  revised: { text: "revised", tone: "amber" },
  missing: { text: "missing", tone: "orange", dim: true },
  duplicate: { text: "duplicate", tone: "stone" },
  conflict: { text: "conflict", tone: "red" },
};

/** The order the summary line counts in, worst first. */
const COUNTED: Status[] = [
  "conflict",
  "revised",
  "missing",
  "duplicate",
  "new",
];

/** A status as the summary line counts it. Most statuses are adjectives --
 *  "2 revised", "3 new" -- and only the two that are nouns take a plural. */
function counted(n: number, status: Status): string {
  return status === "conflict" || status === "duplicate" ? plural(n, status) : `${n} ${status}`;
}

/** What a copy is called in a conflict, so the two can be told apart. The
 *  filename is included for loose copies because that is what a person
 *  dragged in; the workspace's own copy has no name but its id. */
function describe(c: Candidate): string {
  const where =
    c.from === "browser"
      ? "copy in this browser"
      : c.from === "workspace"
        ? "workspace copy"
        : basename(c.name);
  return `${where} · ${human(c.bytes)}`;
}

/** Labels for one conflict's copies. Two files with the same name and size
 *  -- a PDF re-saved with one line changed -- would read identically, so the
 *  digest steps in as the one thing guaranteed to differ. */
function labels(candidates: Candidate[]): string[] {
  const plain = candidates.map(describe);
  const clash = new Set(plain).size < plain.length;
  return clash
    ? plain.map((l, i) => `${l} · ${candidates[i].sha256.slice(0, 7)}`)
    : plain;
}

function toEntry(row: StageRow, continuing: boolean): Entry {
  const mark = !continuing && row.status === "new" ? null : MARKS[row.status];
  const [only] = row.candidates;
  return {
    path: row.docId,
    kind: "pdf",
    mark: mark ?? undefined,
    // A missing row has nothing to take out, a conflict is settled by
    // keeping rather than removing, and the browser's own documents are the
    // editor's to remove.
    removable: row.candidates.length === 1 && only.from !== "browser",
  };
}

/** Moving one copy of a conflict to a name of its own, so both stage.
 *
 * The id the name makes is shown as it is typed, and checked against the
 * listing, so a taken name is said before it is asked for. The engine checks
 * again -- it also knows what `keep` set aside -- and its refusal is shown in
 * the same place. */
function Rename({
  row,
  candidate,
  taken,
  onRename,
  onDone,
}: {
  row: StageRow;
  candidate: Candidate;
  taken: Set<string>;
  onRename: (docId: string, sha256: string, name: string) => Promise<void>;
  onDone: () => void;
}) {
  const [name, setName] = useState(() => `${basename(row.docId)}-2`);
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const blank = name.trim() === "";
  const next = blank ? null : renamedId(row.docId, name);
  const problem =
    next === row.docId
      ? "That is the name it already has."
      : next !== null && taken.has(next)
        ? `${next} is already taken.`
        : null;

  const submit = async () => {
    if (blank || problem || busy) return;
    setBusy(true);
    setRefused(null);
    try {
      await onRename(row.docId, candidate.sha256, name);
      onDone();
    } catch (e) {
      setRefused(messageOf(e));
      setBusy(false);
    }
  };

  const said = problem ?? refused;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
        <input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setRefused(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") onDone();
          }}
          aria-label={`New name for ${basename(candidate.name)}`}
          aria-invalid={said !== null}
          className="min-w-0 flex-1 rounded border border-edge bg-raised/40 px-2 py-1 text-ink
            outline-none focus:border-ink/40"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={blank || problem !== null || busy}
          className="cursor-pointer rounded border border-edge bg-raised/60 px-2 py-1 text-ink
            transition-colors hover:bg-raised disabled:cursor-default disabled:opacity-50"
        >
          Rename
        </button>
        <button
          type="button"
          onClick={onDone}
          className="cursor-pointer px-1 text-faint hover:text-ink"
        >
          cancel
        </button>
      </div>
      {said ? (
        <p className="font-mono text-[11px] text-red-300">{said}</p>
      ) : (
        next && <p className="truncate font-mono text-[11px] text-faint">→ {next}</p>
      )}
    </div>
  );
}

/** The listing under the drop zone: what is staged, what committing will do
 *  to each row, and the button that does it.
 *
 * Presentation only. Every change goes back up through a callback and comes
 * back down as a new `view`; nothing here guesses at what the engine will
 * say. The local state is the two confirmations -- discarding the browser's
 * workspace, and committing over a listed source -- which are questions the
 * engine has no part in, the conflict copy being renamed, and the last thing
 * the engine refused, which is shown under the button. */
export function Staging({
  view,
  onRemove,
  onKeep,
  onRename,
  onDiscard,
  onCommit,
}: {
  view: StageView;
  onRemove: (docId: string, sha256: string) => Promise<void>;
  onKeep: (docId: string, sha256: string) => Promise<void>;
  onRename: (docId: string, sha256: string, name: string) => Promise<void>;
  onDiscard: () => Promise<void>;
  onCommit: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ docId: string; sha256: string } | null>(null);
  // The listing the replace question was asked about. Any change to it -- a
  // revised row taken out, another dropped -- withdraws the question, so what
  // is confirmed is always what is on screen.
  const [replacing, setReplacing] = useState<StageRow[] | null>(null);

  const { workspace, rows, unreadable } = view;
  const continuing = workspace !== null;
  const conflicts = rows.filter((r) => r.status === "conflict");
  const revised = rows.filter((r) => r.status === "revised");
  const asking = replacing === rows && revised.length > 0;
  const taken = useMemo(() => new Set(rows.map((r) => r.docId)), [rows]);
  const counts = COUNTED.map(
    (s) => [s, rows.filter((r) => r.status === s).length] as const,
  ).filter(([s, n]) => n > 0 && (continuing || s !== "new"));
  // Memoised so the tree below is rebuilt when the listing changes, not on
  // every re-render of the page around it.
  const entries = useMemo(() => rows.map((r) => toEntry(r, continuing)), [rows, continuing]);

  // Every action is a round trip that can be refused -- a discard another
  // tab got to first -- and a refusal left unsaid would look like a click
  // that did nothing, beside a listing that is no longer true. Answers
  // whether it went through.
  const act = async (run: () => Promise<void>): Promise<boolean> => {
    setError(null);
    try {
      await run();
      return true;
    } catch (e) {
      setError(messageOf(e));
      return false;
    }
  };

  // The button stays down through a commit that succeeds: the page is about
  // to navigate away from it.
  const commit = async () => {
    setReplacing(null);
    setCommitting(true);
    if (!(await act(onCommit))) setCommitting(false);
  };

  // A revised row writes over a source the workspace already lists, and what
  // was made from it goes with it. That is the one thing a commit does that
  // cannot be taken back by dropping again, so it is asked about once, for
  // every such row together.
  const press = () => {
    if (revised.length > 0) return setReplacing(rows);
    void commit();
  };

  // `sha256` travels with every remove so the engine takes out exactly the
  // copy the row shows and never a namesake staged since.
  const remove = (docId: string) => {
    const row = rows.find((r) => r.docId === docId);
    if (row?.candidates.length === 1) void act(() => onRemove(docId, row.candidates[0].sha256));
  };

  const discard = () => {
    // An upload is only staged, so forgetting it loses nothing. The browser's
    // own workspace, readable or not, is the one copy of whatever was not
    // exported.
    if ((unreadable || workspace?.origin === "browser") && !confirming)
      return setConfirming(true);
    setConfirming(false);
    void act(onDiscard);
  };

  return (
    <>
      {(workspace || unreadable) && (
        <div className="flex items-center gap-2 px-1 font-mono text-xs text-muted">
          {unreadable ? (
            <span className="min-w-0 flex-1 text-amber-400/90">{unreadable}</span>
          ) : (
            workspace && (
              <span className="min-w-0 flex-1 truncate">
                {workspace.origin === "browser"
                  ? "Workspace in this browser"
                  : `${workspace.name}/`}
                {/* TODO: add how many files are already converted to markdown out of this total */}
                <span className="text-faint">
                  {" "}
                  · {plural(workspace.listed, "document")}
                </span>
              </span>
            )
          )}
          {confirming ? (
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-amber-400/90">
                Discard it from this browser?
              </span>
              <button
                type="button"
                onClick={discard}
                className="cursor-pointer text-ink hover:underline"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="cursor-pointer text-faint hover:text-ink"
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={discard}
              className="shrink-0 cursor-pointer text-faint transition-colors hover:text-ink"
            >
              discard
            </button>
          )}
        </div>
      )}

      {/* A workspace that could not be read has nothing to list and nothing
          to continue: the line above, and its discard, are all there is. */}
      {!unreadable && (
        <>
          {counts.length > 0 && (
            <p className="px-1 font-mono text-[11px] text-faint">
              {counts.map(([s, n]) => counted(n, s)).join(" · ")}
            </p>
          )}

          {conflicts.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-950/10 px-3 py-2 text-xs">
              <p className="text-amber-200/90">
                Two different files for the same document. Keep one and the other is
                set aside, or rename one and both are added.
              </p>
              {conflicts.map((row) => (
                <div key={row.docId} className="space-y-1">
                  <div className="truncate font-mono text-ink/90">{row.docId}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {labels(row.candidates).map((label, i) => {
                      const c = row.candidates[i];
                      return (
                        <span key={c.sha256} className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void act(() => onKeep(row.docId, c.sha256))}
                            className="cursor-pointer rounded border border-edge bg-raised/60 px-2 py-1
                              font-mono text-[11px] text-ink transition-colors hover:bg-raised"
                          >
                            Keep {label}
                          </button>
                          {/* The browser's own copy is already written under
                              its id; only an arriving copy can take another. */}
                          {c.from !== "browser" && (
                            <button
                              type="button"
                              onClick={() => setRenaming({ docId: row.docId, sha256: c.sha256 })}
                              aria-label={`Rename ${label}`}
                              className="cursor-pointer px-1 font-mono text-[11px] text-faint
                                transition-colors hover:text-ink"
                            >
                              rename
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                  {renaming?.docId === row.docId &&
                    row.candidates.some((c) => c.sha256 === renaming.sha256) && (
                      <Rename
                        key={renaming.sha256}
                        row={row}
                        candidate={row.candidates.find((c) => c.sha256 === renaming.sha256)!}
                        taken={taken}
                        onRename={onRename}
                        onDone={() => setRenaming(null)}
                      />
                    )}
                </div>
              ))}
            </div>
          )}

          <FileTree entries={entries} onRemove={remove} />

          {asking ? (
            <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-950/10 px-3 py-2 text-xs">
              <p className="text-amber-200/90">
                This will replace{" "}
                <span className="font-mono text-ink/90">
                  {revised.map((r) => `${r.docId}.pdf`).join(", ")}
                </span>
                . Markdown made from the old {revised.length === 1 ? "file" : "files"} is made
                again from the new, and edits to {revised.length === 1 ? "it" : "them"} may no
                longer line up. Continue?
              </p>
              <div className="flex gap-3 font-mono text-[11px]">
                <button
                  type="button"
                  onClick={() => void commit()}
                  className="cursor-pointer text-ink hover:underline"
                >
                  Replace and continue
                </button>
                <button
                  type="button"
                  onClick={() => setReplacing(null)}
                  className="cursor-pointer text-faint hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={press}
              disabled={committing || conflicts.length > 0}
              className="group flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg
                bg-raised/60 px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-raised
                disabled:cursor-default disabled:opacity-50 disabled:hover:bg-raised/60"
            >
              {committing ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <>
                  {continuing ? "Continue workspace" : "Create new workspace"}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          )}

          {conflicts.length > 0 && (
            <p className="text-center text-[11px] text-faint">
              Resolve {plural(conflicts.length, "conflict")} to continue.
            </p>
          )}
        </>
      )}
      {error && <p className="text-center text-[11px] text-red-300">{error}</p>}
    </>
  );
}
