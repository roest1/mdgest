import { Backdrop } from "src/components/landing/Backdrop";
import { GitHubLink } from "src/components/landing/GitHubLink";
import { Brand } from "src/components/landing/Brand";
import { DropZone } from "src/components/landing/DropZone";
import { Footer } from "src/components/landing/Footer";

export default function Landing() {
  return (
    <main className="landing-page">
      <div className="landing-hero">
        <Backdrop />
        <GitHubLink />
        <div className="relative z-10 w-full max-w-2xl space-y-2">
          <Brand />
          <section>
            {/* Nothing receives the files yet: the "Added." flash is the whole
                round trip until there is a stage to send them to. */}
            <DropZone onFiles={async () => {}} />
          </section>
        </div>
      </div>
      <Footer />
    </main>
  );
}
