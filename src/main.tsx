import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { NeedsDesktop } from "src/components/landing/NeedsDesktop";

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
      <App />
    </StrictMode>
  ),
);
