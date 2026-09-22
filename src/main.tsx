import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { ErrorBoundary } from "src/components/shared/ErrorBoundary";
import { Spinner } from "src/components/shared/Spinner";
import Landing from "src/routes/Landing";
import "./index.css";

const Editor = lazy(() => import("src/routes/Editor"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <Suspense
          fallback={
            <div className="flex h-screen items-center justify-center">
              <Spinner className="h-5 w-5 text-muted" />
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Landing />} />
            {/* A splat, not `:docId`: a document's id is its path under
                sources/ — `manuals/hydraulics/valves` — and a route param
                matches no slashes. `:docId` would work for every id that
                happens to sit at the top level, which is the set anyone
                would test with. */}
            <Route path="/edit/*" element={<Editor />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
