// Jev Mode for the UI (KTD5). The provider sits above FolderGate, since Jev Mode outlives
// a folder change, reads status once on mount and again on demand, and adopts the status
// each change returns. Components read `useJev()` and never call Tauri for Jev.
//
// Jev Mode reads as off with no provider, while the first status read is in flight, after
// a status read fails, and whenever it is not both on and holding a key. Outside a provider
// every action rejects as "off", so nothing is ever sent from a tree without one.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { JevAnswers, JevRequest } from "../domain/jevRequest";
import { JEV_OFF, JevError, isUsable, toJevError, type Jev, type JevStatus } from "../jev/jev";

/** "loading" until the first status read settles, then "ready", or "failed" if the last read failed. */
export type JevPhase = "loading" | "ready" | "failed";

export interface JevContextValue {
  /** True only when status has loaded, Jev Mode is on and a key is held. Gate every Jev affordance on this. */
  usable: boolean;
  /** The last status read or returned by a change. Off while loading and after a failed read. */
  status: JevStatus;
  phase: JevPhase;
  /** Re-reads status. Keeps the last status until the read lands. Never throws; a failed read reads as off. */
  refresh(): Promise<void>;
  /** Stores the key and turns Jev Mode on. Resolves to the new status, which the provider adopts. */
  setKey(key: string): Promise<JevStatus>;
  /** Deletes the key and turns Jev Mode off. */
  clearKey(): Promise<JevStatus>;
  /** Turns Jev Mode on or off. Off keeps the key. */
  setOn(on: boolean): Promise<JevStatus>;
  /** Sends one request. Rejects with a JevError; status is left as it was. */
  ask(request: JevRequest): Promise<JevAnswers>;
}

function refuse<T>(): Promise<T> {
  return Promise.reject(new JevError("off"));
}

/** Outside a provider: a settled off, as on a first run, that sends nothing. */
const NO_PROVIDER: JevContextValue = {
  usable: false,
  status: JEV_OFF,
  phase: "ready",
  refresh: async () => {},
  setKey: refuse,
  clearKey: refuse,
  setOn: refuse,
  ask: refuse,
};

const JevContext = createContext<JevContextValue>(NO_PROVIDER);

/** Jev Mode as the nearest provider sees it. Off, and sending nothing, outside one. */
export function useJev(): JevContextValue {
  return useContext(JevContext);
}

export interface JevProviderProps {
  jev: Jev;
  children?: ReactNode;
}

export function JevProvider({ jev, children }: JevProviderProps) {
  const [view, setView] = useState<{ status: JevStatus; phase: JevPhase }>({ status: JEV_OFF, phase: "loading" });
  // A read lands only if no read or change started after it and no change landed since,
  // so a slow read never overwrites the status a change returned. A change lands only if
  // it is the latest change sent.
  const reads = useRef(0);
  const changes = useRef(0);

  const refresh = useCallback(async () => {
    const read = ++reads.current;
    const sent = changes.current;
    const current = () => read === reads.current && sent === changes.current;
    try {
      const status = await jev.status();
      if (current()) setView({ status, phase: "ready" });
    } catch {
      // A status that can't be read reads as off (KTD5).
      if (current()) setView({ status: JEV_OFF, phase: "failed" });
    }
  }, [jev]);

  useEffect(() => {
    void refresh();
    return () => {
      // Drop anything still in flight.
      reads.current++;
      changes.current++;
    };
  }, [refresh]);

  const change = useCallback(
    async (send: () => Promise<JevStatus>) => {
      const sent = ++changes.current;
      try {
        const status = await send();
        if (sent === changes.current) {
          reads.current++;
          setView({ status, phase: "ready" });
        }
        return status;
      } catch (e) {
        // The native side changes nothing on most failures, but a read settles any that
        // got partway, and ends a first load this change made stale.
        if (sent === changes.current) void refresh();
        throw toJevError(e);
      }
    },
    [refresh],
  );

  const setKey = useCallback((key: string) => change(() => jev.setKey(key)), [change, jev]);
  const clearKey = useCallback(() => change(() => jev.clearKey()), [change, jev]);
  const setOn = useCallback((on: boolean) => change(() => jev.setOn(on)), [change, jev]);
  const ask = useCallback(
    (request: JevRequest) =>
      jev.ask(request).catch((e: unknown) => {
        throw toJevError(e);
      }),
    [jev],
  );

  const value = useMemo<JevContextValue>(
    () => ({
      usable: view.phase === "ready" && isUsable(view.status),
      status: view.status,
      phase: view.phase,
      refresh,
      setKey,
      clearKey,
      setOn,
      ask,
    }),
    [view, refresh, setKey, clearKey, setOn, ask],
  );

  return <JevContext.Provider value={value}>{children}</JevContext.Provider>;
}
