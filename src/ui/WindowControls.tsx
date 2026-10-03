// The window's own keys. The window has no system title bar (tauri.conf.json), so the
// bar at the top of every screen carries close, minimize and full screen, drawn like the
// machine's keys, and is itself the drag region that moves the window. The window resizes
// from its edges, and double-clicking the bar maximizes it (R1). The full-screen key's
// label and icon follow the frame from the root provider (R2, KTD1). Minimize is off in
// full screen, as the system's own minimize is on macOS.

import { useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { INK_FINE, sketchRect } from "../cast/InkDefs";
import { useWindowFrame } from "./windowFrame";

type WindowKeyName = "close" | "minimize" | "enter-full-screen" | "exit-full-screen";

/** Icon strokes in a 28 × 24 key, centered on (14, 12). Full screen is four corners, out to enter and in to leave. */
const ICONS: Record<WindowKeyName, string> = {
  close: "M10 8L18 16M18 8L10 16",
  minimize: "M9.5 12H18.5",
  "enter-full-screen": "M9.5 10.5V7.5H12.5M15.5 7.5H18.5V10.5M18.5 13.5V16.5H15.5M12.5 16.5H9.5V13.5",
  "exit-full-screen": "M9.5 10.5H12.5V7.5M15.5 7.5V10.5H18.5M18.5 13.5H15.5V16.5M12.5 16.5V13.5H9.5",
};

function WindowKey({ name, label, disabled, onPress }: { name: WindowKeyName; label: string; disabled?: boolean; onPress(): void }) {
  return (
    <button type="button" className={`window-key window-key-${name}`} aria-label={label} disabled={disabled} onClick={onPress}>
      <svg viewBox="0 0 28 24" width="28" height="24" aria-hidden="true" focusable="false">
        <g filter={INK_FINE}>
          <rect className="window-key-fill" x="3" y="3" width="22" height="18" />
          <path className="window-key-edge" d={sketchRect(3, 3, 22, 18, 1.4, 0.4)} />
          <path className="window-key-icon" d={ICONS[name]} />
        </g>
      </svg>
    </button>
  );
}

export function WindowControls() {
  const fullscreen = useWindowFrame() === "fullscreen";
  // A press while a toggle is still in flight is ignored, so a double press cannot undo the first.
  const toggling = useRef(false);

  async function toggleFullScreen() {
    if (toggling.current) return;
    toggling.current = true;
    try {
      await getCurrentWindow().setFullscreen(!fullscreen);
    } catch {
      // A refused toggle leaves the window as it was, and the key still reads its frame.
    } finally {
      toggling.current = false;
    }
  }

  return (
    <div className="window-keys">
      <WindowKey name="close" label="Close window" onPress={() => void getCurrentWindow().close()} />
      <WindowKey name="minimize" label="Minimize window" disabled={fullscreen} onPress={() => void getCurrentWindow().minimize()} />
      <WindowKey
        name={fullscreen ? "exit-full-screen" : "enter-full-screen"}
        label={fullscreen ? "Exit full screen" : "Enter full screen"}
        onPress={() => void toggleFullScreen()}
      />
    </div>
  );
}
