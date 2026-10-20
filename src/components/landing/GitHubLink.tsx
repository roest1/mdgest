import type { ReactNode } from "react";

const REPO = "https://github.com/roest1/mdgest";

/** GitHub's mark, inlined: lucide dropped its brand icons, and a
 *  link to a repository is the one place the real mark belongs. */
export function GitHubMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** A link out to the repository, or somewhere in it. Opens in a new tab:
 *  a person mid-drop should not lose the page. */
export function RepoLink({
  path = "",
  className,
  children,
}: {
  /** What follows the repository's URL: `#getting-started`, a file. */
  path?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a href={`${REPO}${path}`} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}

/** The open-source convention: top right, out of the way, always there. */
export function GitHubLink() {
  return (
    <RepoLink
      className="absolute right-4 top-4 z-20 flex items-center gap-1.5 rounded-md
        px-2 py-1 text-xs text-muted transition-colors hover:bg-raised/60 hover:text-ink"
    >
      <GitHubMark />
      GitHub
    </RepoLink>
  );
}
