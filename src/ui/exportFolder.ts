// The export folder is picked through the Rust dialog, which approves it as the
// export root (KTD1). Returns the chosen path, or null when the user cancels.

import { invoke } from "@tauri-apps/api/core";

export function pickExportFolder(): Promise<string | null> {
  return invoke<string | null>("pick_export_folder");
}
