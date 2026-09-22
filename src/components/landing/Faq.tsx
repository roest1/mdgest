import { RepoLink } from "./GitHubLink";
import { Section } from "./Section";

/** A link in an answer: dotted, the way a footnote's is. */
function Link({ path, children }: { path?: string; children: string }) {
  return (
    <RepoLink path={path} className="underline decoration-dotted underline-offset-2 hover:text-ink">
      {children}
    </RepoLink>
  );
}

/** Inline code, styled the way backticks render in the README this text is
 *  lifted from. */
function Code({ children }: { children: string }) {
  return (
    <code className="rounded bg-raised px-1 py-0.5 font-mono text-[0.85em] text-ink">
      {children}
    </code>
  );
}

/** The questions someone checks the claims with. Answers are lifted from
 *  docs/storage.md and the README, so they stay as honest as the docs are.
 *  Every answer is shown, none folded: seven short answers are less to read
 *  than seven clicks. */
const QA = [
  {
    q: "Where do my files go?",
    a: `Into your browser's own storage, on your machine. mdgest is a static
      page with no server behind it; the reading and the writing both happen
      in a worker in the tab. Nothing is uploaded, because there is nowhere
      to upload it to.`,
  },
  {
    q: "Does it work offline?",
    a: (
      <>
        Yes, once the page has loaded — no model is called and no file is
        fetched. For a copy that's offline from the very first load, clone{" "}
        <Link path="#getting-started">the repo</Link> and run it locally.
      </>
    ),
  },
  {
    q: "How do I save my progress?",
    a: (
      <>
        Browser storage is evictable and there is no account to restore
        from, so exporting is what saving means. An export is a workspace as
        a folder: <Code>mdgest.json</Code> with every decision,{" "}
        <Code>sources/</Code> as you gave them, <Code>markdown/</Code> as it
        came out. Hand it back later and you carry on where you left off.
      </>
    ),
  },
  {
    q: "What can I upload?",
    a: `A single PDF, a zip of PDFs, a folder of PDFs, or a folder of a previous workspace. 
        Folder-hierarchy is kept in tact.`,
  },
  {
    q: "Why not just convert the whole thing in one go?",
    a: `Because no converter gets every page right. Here
      every block is numbered on the page and in the markdown, you fix what
      needs fixing, and documents in the same folder learn from the ones you
      have already finished.`,
  },
  {
    q: "Which browsers?",
    a: `Chrome and Edge 102 or later, Firefox 114 or later, Safari 15.4 or
      later including iOS. The floor is set by the origin-private file system (OPFS),
      module workers and Web Locks, which are what let the engine stay synchronous,
      off the thread that paints, and safe with two tabs open.`,
  },
  {
    q: "Is it free?",
    a: (
      <>
        Yes. mdgest is MIT licensed and the source is on <Link>GitHub</Link>.
        There is no account, no plan, and no upload.
      </>
    ),
  },
];

export function Faq() {
  return (
    <Section id="faq" title="Frequently asked questions">
      <dl className="m-0 space-y-8">
        {QA.map(({ q, a }) => (
          <div key={q}>
            <dt className="text-sm font-semibold text-ink">{q}</dt>
            <dd className="m-0 mt-2 text-sm leading-relaxed text-muted">{a}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
