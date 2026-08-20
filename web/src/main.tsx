import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { configureApi } from "./api";
import { engineInfo, isDesktop } from "./lib/desktop";

const root = createRoot(document.getElementById("root")!);

async function start() {
  if (isDesktop) {
    // The engine is our sidecar on an ephemeral port; nothing can render
    // until the supervisor hands over where it is and the launch token.
    root.render(<Splash text="starting the engine…" />);
    try {
      const info = await engineInfo();
      configureApi(`${info.base}/api`, info.token);
    } catch (e) {
      root.render(<Splash text="the engine did not start" detail={String(e)} />);
      return;
    }
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

function Splash({ text, detail }: { text: string; detail?: string }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="glass rounded-2xl p-8 max-w-lg text-center">
        <p className="font-display text-lg text-ink">{text}</p>
        {detail && (
          <pre className="mt-3 text-left text-xs font-mono text-red-300/90 whitespace-pre-wrap">{detail}</pre>
        )}
      </div>
    </div>
  );
}

start();

// handy in the console while developing
import { useStore } from "./store";
import { useDrag } from "./lib/drag";
(window as unknown as { mdgest: unknown }).mdgest = { store: useStore, drag: useDrag };
