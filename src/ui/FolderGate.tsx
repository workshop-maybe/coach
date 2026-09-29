// First-run gate (R20): with no remembered data folder, one screen asks for one.
// The folder lookups are props so tests need no Tauri.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Lockup } from "./Lockup";
import { describeError } from "./useFolderState";

export interface FolderGateProps {
  /** The remembered data folder, or null. Defaults to the `get_data_folder` command. */
  getFolder?: () => Promise<string | null>;
  /** Shows a picker; resolves to the chosen folder, or null on cancel. Defaults to `pick_data_folder`. */
  pickFolder?: () => Promise<string | null>;
  /** Renders the app for a folder. `changeFolder` opens the picker and swaps folders unless cancelled. */
  children: (folder: string, changeFolder: () => Promise<void>) => ReactNode;
}

const defaultGetFolder = () => invoke<string | null>("get_data_folder");
const defaultPickFolder = () => invoke<string | null>("pick_data_folder");

type GateState = { status: "checking" } | { status: "none" } | { status: "ready"; folder: string };

export function FolderGate({ getFolder = defaultGetFolder, pickFolder = defaultPickFolder, children }: FolderGateProps) {
  const [gate, setGate] = useState<GateState>({ status: "checking" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getFolder().then(
      (folder) => live && setGate(folder ? { status: "ready", folder } : { status: "none" }),
      (e) => {
        if (!live) return;
        setError(describeError(e));
        setGate({ status: "none" });
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

  return (
    <main className="gate">
      <Lockup className="lockup-wrap" />
      <h1>Andamio Desktop</h1>
      <p>Pick a folder for your credentials, agents and results. Everything is stored there as Markdown and JSON.</p>
      <button type="button" className="primary" onClick={() => void choose()}>
        Choose folder
      </button>
      {error && <p className="gate-error" role="alert">{error}</p>}
    </main>
  );
}
