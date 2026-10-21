import { GitHubLink } from "src/components/landing/GitHubLink";
import { Brand } from "src/components/landing/Brand";
import { Footer } from "src/components/landing/Footer";

export default function Landing() {
  return (
    <main className="landing-page">
      <div className="landing-hero">
        <GitHubLink />
        <div className="relative z-10 w-full max-w-2xl space-y-2">
          <Brand />
        </div>
      </div>
      <Footer />
    </main>
  );
}
