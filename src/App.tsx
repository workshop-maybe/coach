import { useMemo } from "react";
import { TauriJev } from "./jev/tauriJev";
import { TauriStorage } from "./storage/tauri";
import { AppShell } from "./ui/AppShell";
import { FolderGate } from "./ui/FolderGate";
import { JevProvider } from "./ui/jevContext";
import { FolderProvider } from "./ui/useFolderState";
import { WindowFrameProvider } from "./ui/windowFrame";
import "./App.css";

function App() {
  const storage = useMemo(() => new TauriStorage(), []);
  const jev = useMemo(() => new TauriJev(), []);
  return (
    // Above the gate, so the window's corners don't flash on the gate-to-shell swap (KTD1).
    <WindowFrameProvider>
      {/* Above the gate too, since Jev Mode outlives a folder change (KTD5). */}
      <JevProvider jev={jev}>
        <FolderGate>
          {(folder, changeFolder) => (
            // Keyed by folder so a new folder remounts the provider with fresh state.
            <FolderProvider key={folder} storage={storage} folder={folder}>
              <AppShell onChangeFolder={() => void changeFolder()} />
            </FolderProvider>
          )}
        </FolderGate>
      </JevProvider>
    </WindowFrameProvider>
  );
}

export default App;
