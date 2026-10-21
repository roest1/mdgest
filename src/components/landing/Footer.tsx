import { GitHubMark, RepoLink } from "./GitHubLink";

export function Footer() {
  return (
    <footer className="border-t border-edge">
      <div
        className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8 text-xs
          text-faint sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-2">
          <img src="/mark.svg" alt="" width={20} height={20} className="rounded-[5px]" />
          <span className="font-serif text-sm font-semibold tracking-tight text-muted">
            mdgest
          </span>
          <span>· MIT License</span>
        </div>
        <p>No account. Your PDFs stay on your machine.</p>
        <RepoLink className="flex items-center gap-1.5 text-muted transition-colors hover:text-ink">
          <GitHubMark className="h-3.5 w-3.5" />
          roest1/mdgest
        </RepoLink>
      </div>
    </footer>
  );
}
