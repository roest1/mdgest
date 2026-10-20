import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Backdrop } from "src/components/landing/Backdrop";
import { Brand } from "src/components/landing/Brand";
import { DropZone } from "src/components/landing/DropZone";
import { Faq } from "src/components/landing/Faq";
import { Footer } from "src/components/landing/Footer";
import { GitHubLink } from "src/components/landing/GitHubLink";
import { Guarantees } from "src/components/landing/Guarantees";
import { HowItWorks } from "src/components/landing/HowItWorks";
import { Staging } from "src/components/landing/Staging";
import { engine } from "src/lib/engine";
import type { StageView } from "src/lib/protocol";
import { useOverhang } from "src/hooks/useSize";
import { messageOf } from "src/lib/words";

export default function Landing() {
  // The stage lives in the worker; this is the last view of it. Every change
  // is a round trip that comes back as a whole new view, so the landing never
  // has a listing the engine would disagree with.
  const [view, setView] = useState<StageView | null>(null);
  // Why the first look failed, when it did -- most often a browser that will
  // not let the page store anything, which is worth saying before anyone
  // drops a file into it.
  const [problem, setProblem] = useState<string | null>(null);
  const navigate = useNavigate();

  // The first look seeds the stage from OPFS: a workspace left from an
  // earlier visit shows up as the one to continue, before anything is dropped.
  useEffect(() => {
    let live = true;
    engine.stageView().then(
      (v) => live && setView(v),
      (cause: unknown) => live && setProblem(messageOf(cause)),
    );
    return () => {
      live = false;
    };
  }, []);

  // Errors are not caught here on purpose — DropZone surfaces a rejection as
  // its own error state, which is where a person is already looking. What
  // could be staged is shown first; what could not is what the error says.
  const onFiles = useCallback(async (files: File[]) => {
    const { view, rejected } = await engine.stage(files);
    setView(view);
    setProblem(null);
    if (rejected.length) throw new Error(rejected.join(" "));
  }, []);

  // A workspace is listed even with no rows, so one that holds the slot is
  // never invisible: it can always be seen, and discarded.
  const staged =
    view !== null && (view.rows.length > 0 || view.workspace !== null || view.unreadable !== null);
  const showing = staged || problem !== null;

  // The listing hangs off the hero's centered block, out of flow, so it cannot
  // shove the drop zone up when it appears. Out of flow also means the
  // sections below would not know it was there and would slide up under it --
  // so however far it hangs past the hero's bottom edge is measured and paid
  // back as a spacer. Only the overhang: the hero's own empty band below the
  // drop zone absorbs the rest.
  const hero = useRef<HTMLDivElement>(null);
  const listing = useRef<HTMLElement>(null);
  const overhang = useOverhang(listing, hero, showing);

  return (
    <main className="landing-page">
      <div ref={hero} className="landing-hero">
        <Backdrop />
        <GitHubLink />

        <div className="relative z-10 w-full max-w-2xl space-y-2">
          <Brand />

          <section>
            <DropZone onFiles={onFiles} />
          </section>

          {showing && (
            <section
              ref={listing}
              className="absolute inset-x-0 top-full animate-fade-in space-y-3 pt-3"
            >
              {staged ? (
                <Staging
                  view={view}
                  onRemove={(docId, sha256) => engine.unstage(docId, sha256).then(setView)}
                  onKeep={(docId, sha256) => engine.keep(docId, sha256).then(setView)}
                  onRename={(docId, sha256, name) =>
                    engine.renameCandidate(docId, sha256, name).then(setView)
                  }
                  onDiscard={() => engine.discardWorkspace().then(setView)}
                  onCommit={async () => {
                    await engine.commit();
                    // Asked here, on the page, because `persist()` is not
                    // exposed in a worker -- and now, because Firefox asks the
                    // person, which it does only in answer to something they
                    // did. Advisory either way: exporting is the durability.
                    void navigator.storage.persist().catch(() => false);
                    navigate("/edit");
                  }}
                />
              ) : (
                <p className="text-center text-[11px] text-red-300">{problem}</p>
              )}
            </section>
          )}
        </div>
      </div>
      <div aria-hidden style={{ height: overhang }} />

      <HowItWorks />
      <Guarantees />
      <Faq />
      <Footer />
    </main>
  );
}
