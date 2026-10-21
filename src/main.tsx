import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { ErrorBoundary } from "src/components/shared/ErrorBoundary";
import { NeedsDesktop } from "src/components/shared/NeedsDesktop";
import { Spinner } from "src/components/shared/Spinner";
import { Tooltips } from "src/components/shared/Tooltip";
import Landing from "src/routes/Landing";
import "./index.css";

const Editor = lazy(() => import("src/routes/Editor"));

/** Whether this is a phone, which mdgest turns away. Tablets are let in.
 *
 * Touch-only input *and* a small device, both. `hover: none` is what keeps a
 * touchscreen laptop out of it: its primary pointer is the trackpad, which
 * hovers. The size is the screen's short side rather than the window's width,
 * for two reasons. Phones and tablets are told apart by it — the largest phone
 * is about 440 CSS px across, the smallest iPad 744 — where a width query
 * catches a phone held upright but lets the same phone through on its side.
 * And the screen does not change when the window does: an iPad in Split View
 * is a narrow window on a tablet, and a live query would unmount the workspace
 * from under it the moment the divider moved.
 *
 * Read once, at load, for the same reason. Not the user agent: it says what
 * the browser claims to be, not what it is running on.
 */
const IS_PHONE =
  window.matchMedia("(pointer: coarse) and (hover: none)").matches &&
  Math.min(screen.width, screen.height) < 600;

createRoot(document.getElementById("root")!).render(
  IS_PHONE ? (
    <NeedsDesktop />
  ) : (
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
          <Tooltips />
        </ErrorBoundary>
      </BrowserRouter>
    </StrictMode>
  ),
);
