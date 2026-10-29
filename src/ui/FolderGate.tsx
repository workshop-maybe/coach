// The folder gate. With no data folder ever remembered, the first run plays the intro and
// then asks for a folder (KTD5 of the first-run intro plan). A remembered folder that has
// gone missing, or a lookup that fails, asks for a folder again with the error, and never
// plays the intro (KTD4, R15). The folder lookups are props so tests need no Tauri.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { InkDefs } from "../cast/InkDefs";
import { FirstRun } from "../intro/FirstRun";
import { Lockup } from "./Lockup";
import { Sheet } from "./Sheet";
import { WindowControls } from "./WindowControls";
import { useWindowFrame } from "./windowFrame";
import { describeError } from "./useFolderState";

/** What `get_data_folder` reports: the folder, a remembered one gone missing, or none ever remembered. */
export type DataFolderStatus = { status: "ready"; folder: string } | { status: "missing"; remembered: string } | { status: "none" };

export interface FolderGateProps {
  /**
   * The data folder's status. Defaults to the `get_data_folder` command. A plain string or
   * null reads as a ready folder or none, as the command answered before it told them apart.
   */
  getFolder?: () => Promise<DataFolderStatus | string | null>;
  /** Shows a picker; resolves to the chosen folder, or null on cancel. Defaults to `pick_data_folder`. */
  pickFolder?: () => Promise<string | null>;
  /** Renders the app for a folder. `changeFolder` opens the picker and swaps folders unless cancelled. */
  children: (folder: string, changeFolder: () => Promise<void>) => ReactNode;
}

const defaultGetFolder = () => invoke<DataFolderStatus>("get_data_folder");
const defaultPickFolder = () => invoke<string | null>("pick_data_folder");

function asStatus(answer: DataFolderStatus | string | null): DataFolderStatus {
  if (answer === null) return { status: "none" };
  if (typeof answer === "string") return answer ? { status: "ready", folder: answer } : { status: "none" };
  return answer;
}

/** The message for a remembered folder that can no longer be opened. */
export function folderNotFound(remembered: string): string {
  return `Folder not found: ${remembered}. Choose it again, or pick another.`;
}

type GateState =
  | { status: "checking" }
  | { status: "first-run" }
  | { status: "failed" }
  | { status: "ready"; folder: string };

export function FolderGate({ getFolder = defaultGetFolder, pickFolder = defaultPickFolder, children }: FolderGateProps) {
  const [gate, setGate] = useState<GateState>({ status: "checking" });
  const [error, setError] = useState<string | null>(null);
  // No drag region in full screen, where a double-click would maximize (R2, as in AppShell).
  const fullscreen = useWindowFrame() === "fullscreen";

  useEffect(() => {
    let live = true;
    getFolder().then(
      (answer) => {
        if (!live) return;
        const found = asStatus(answer);
        if (found.status === "ready") setGate({ status: "ready", folder: found.folder });
        else if (found.status === "none") setGate({ status: "first-run" });
        else {
          setError(folderNotFound(found.remembered));
          setGate({ status: "failed" });
        }
      },
      (e) => {
        if (!live) return;
        setError(describeError(e));
        setGate({ status: "failed" });
      },
    );
    return () => {
      live = false;
    };
    // getFolder is read once, on mount.
  }, []);

  async function choose() {
    try {
      const folder = await pickFolder();
      if (folder) {
        setError(null);
        setGate({ status: "ready", folder });
      }
    } catch (e) {
      setError(describeError(e));
    }
  }

  if (gate.status === "checking") return null;

  if (gate.status === "ready") return <>{children(gate.folder, choose)}</>;

  // `held` says the newcomer's line waits to be saved as a badge in the folder they choose.
  const ask = (held: boolean) => (
    <Sheet>
      <main className="gate">
        <Lockup className="lockup-wrap" />
        <h1 className="visually-hidden">Coach</h1>
        <p>
          {held
            ? "Pick a folder for your badge. It is saved there, with your agents and results, as Markdown and JSON."
            : "Pick a folder for your credentials, agents and results. Everything is stored there as Markdown and JSON."}
        </p>
        <button type="button" className="primary" onClick={() => void choose()}>
          Choose folder
        </button>
        {error && <p className="gate-error" role="alert">{error}</p>}
      </main>
    </Sheet>
  );

  // The same board and sheet as the app (R5): the window keys on the board, the ask on the
  // sheet. The intro plays on the board below the same bar, so the window moves and closes
  // through it.
  return (
    <div className="shell">
      <InkDefs />
      <div className="gate-bar" data-tauri-drag-region={fullscreen ? undefined : true}>
        <WindowControls />
      </div>
      {gate.status === "first-run" ? <FirstRun gate={ask} /> : ask(false)}
    </div>
  );
}
