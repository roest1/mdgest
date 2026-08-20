import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// handy in the console while developing
import { useStore } from "./store";
import { useDrag } from "./lib/drag";
(window as unknown as { mdgest: unknown }).mdgest = { store: useStore, drag: useDrag };
