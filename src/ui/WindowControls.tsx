// The window's own keys. The window has no system title bar (tauri.conf.json), so the
// bar at the top of every screen carries close and minimize, drawn like the machine's
// keys, and is itself the drag region that moves the window. The size is fixed, so
// there is no maximize.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { INK_FINE, sketchRect } from "../cast/InkDefs";

type WindowKeyName = "close" | "minimize";

/** Icon strokes in a 28 × 24 key, centered on (14, 12). */
const ICONS: Record<WindowKeyName, string> = {
  close: "M10 8L18 16M18 8L10 16",
  minimize: "M9.5 12H18.5",
};

function WindowKey({ name, label, onPress }: { name: WindowKeyName; label: string; onPress(): void }) {
  return (
    <button type="button" className={`window-key window-key-${name}`} aria-label={label} onClick={onPress}>
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
  return (
    <div className="window-keys">
      <WindowKey name="close" label="Close window" onPress={() => void getCurrentWindow().close()} />
      <WindowKey name="minimize" label="Minimize window" onPress={() => void getCurrentWindow().minimize()} />
    </div>
  );
}
