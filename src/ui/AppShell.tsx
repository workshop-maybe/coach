// The app frame (KTD1). Home is the only room: a top bar with the folder and its three
// single actions (Change folder, Reload, Export), the load-error banner, the badge-warning
// notice and the notice banner, then home, a deck in progress, or one item open.
//
// A view can claim the window as a pane (KTD3, pane.tsx). While one does, the bar keeps
// only the window keys and the brand (R8), and the shell turns into a full-height column
// whose content area gives the pane all the height below the bar and the banners (KTD4).
// The banners stay mounted and compact to a line each in CSS, so an alert is not announced
// again, and nothing above the pane scrolls, so the window keys stay in view (R10).

import { useLayoutEffect, useMemo, useState } from "react";
import { InkDefs } from "../cast/InkDefs";
import { AgentDetail } from "./AgentDetail";
import { BadgeDetail } from "./BadgeDetail";
import { CompareView } from "./CompareView";
import { CredentialDeck } from "./CredentialDeck";
import { EditAgentDeck, EditCredentialDeck } from "./EditDecks";
import { EditHandoffDeck, HandoffsDeck } from "./HandoffDecks";
import { HandoffDetail } from "./HandoffDetail";
import { TrashDeck } from "./TrashDeck";
import { WindowControls } from "./WindowControls";
import { useWindowFrame } from "./windowFrame";
import { exportAll, exportMessage } from "./exportAll";
import { pickExportFolder } from "./exportFolder";
import { Home } from "./Home";
import { LoadErrors, LoadWarnings } from "./LoadErrors";
import { Lockup } from "./Lockup";
import { NavContext } from "./nav";
import { PaneContext, usePaneClaims } from "./pane";
import { PlayerCard } from "./PlayerCard";
import { ReplyView } from "./ReplyView";
import type { DeckRoute, ItemRoute, Route } from "./routes";
import { TestDeck } from "./TestDeck";
import { describeError, useFolder } from "./useFolderState";

export type { Route } from "./routes";
export { useNav } from "./nav";

export interface AppShellProps {
  onChangeFolder: () => void;
  initialRoute?: Route;
}

export function AppShell({ onChangeFolder, initialRoute = { view: "home" } }: AppShellProps) {
  const { folder, storage, state, loading, reload, apply, notice, setNotice } = useFolder();
  const [route, navigate] = useState<Route>(initialRoute);
  const [exporting, setExporting] = useState(false);
  const nav = useMemo(() => ({ route, navigate }), [route]);
  // Each view opens at its top. #root is the page scroller and keeps its offset across views,
  // so a page opened from a scrolled one would arrive with its top bar out of view (R6, R10).
  // A layout effect, so it lands before ReplyList's effect scrolls a lit row into view.
  useLayoutEffect(() => {
    const root = document.getElementById("root");
    if (root) root.scrollTop = 0;
  }, [route]);
  const { pane, claims } = usePaneClaims();
  // Tauri's drag script toggles maximize on a double press, before any handler here could
  // stop it, so in full screen the bar is no drag region at all (R2).
  const dragRegion = useWindowFrame() === "fullscreen" ? undefined : true;

  async function runExport() {
    if (!state) return;
    setExporting(true);
    try {
      const to = await pickExportFolder();
      if (!to) return;
      const result = await exportAll(storage, state);
      if (result.state !== state) apply(result.state);
      setNotice(exportMessage(result, to));
    } catch (e) {
      setNotice(`Export failed: ${describeError(e)}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <NavContext.Provider value={nav}>
      <PaneContext.Provider value={claims}>
        <div className="shell" data-pane={pane || undefined}>
          <InkDefs />
          <header className="topbar" data-tauri-drag-region={dragRegion}>
            <WindowControls />
            <button type="button" className="brand" aria-label="Andamio Desktop, go home" onClick={() => navigate({ view: "home" })}>
              <Lockup />
            </button>
            {!pane && (
              <>
                <span className="folder-path" title={folder} data-tauri-drag-region={dragRegion}>
                  {folder}
                </span>
                <div className="topbar-actions">
                  <button type="button" onClick={onChangeFolder}>
                    Change folder
                  </button>
                  <button type="button" onClick={() => void reload()} disabled={loading}>
                    Reload
                  </button>
                  <button type="button" onClick={() => void runExport()} disabled={exporting || !state || state.credentials.length === 0}>
                    Export
                  </button>
                </div>
              </>
            )}
          </header>
          {notice && (
            <div className="banner banner-notice" role="status">
              <span>{notice}</span>
              <button type="button" className="link" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          )}
          <LoadErrors errors={state?.errors ?? []} />
          <LoadWarnings warnings={state?.warnings ?? []} />
          <main className="content">
            {state === null ? (
              <p className="muted">{loading ? "Loading…" : "The folder could not be loaded."}</p>
            ) : route.view === "home" ? (
              <Home />
            ) : route.view === "deck" ? (
              <DeckView key={JSON.stringify(route)} route={route} />
            ) : (
              <ItemView key={JSON.stringify(route)} route={route} />
            )}
          </main>
        </div>
      </PaneContext.Provider>
    </NavContext.Provider>
  );
}

/** A deck in progress. Keyed by route, so opening another deck starts it fresh. */
function DeckView({ route }: { route: DeckRoute }) {
  switch (route.deck) {
    case "credential":
      return <CredentialDeck returnTo={route.returnTo} />;
    case "agent":
      return <PlayerCard returnTo={route.returnTo} likeSlug={route.likeSlug} firstTest={route.firstTest} />;
    case "test":
      return <TestDeck profileSlug={route.profileSlug} credentialKey={route.credentialKey} resume={route.resume} handoffId={route.handoffId} returnTo={route.returnTo} />;
    case "edit-credential":
      return <EditCredentialDeck credentialKey={route.credentialKey} part={route.part} />;
    case "edit-agent":
      return <EditAgentDeck profileSlug={route.profileSlug} part={route.part} />;
    case "handoffs":
      return <HandoffsDeck credentialKey={route.credentialKey} returnTo={route.returnTo} />;
    case "edit-handoff":
      return <EditHandoffDeck credentialKey={route.credentialKey} handoff={route.handoff} returnTo={route.returnTo} />;
    case "trash":
      return <TrashDeck item={route.item} />;
  }
}

/** One item open: a badge, an agent, a handoff, a take's reply or two takes compared. Keyed by route, so opening another starts fresh. */
function ItemView({ route }: { route: ItemRoute }) {
  switch (route.item) {
    case "badge":
      return <BadgeDetail credentialKey={route.credentialKey} lit={route.lit} litTake={route.litTake} picks={route.picks} focusCompare={route.focusCompare} />;
    case "agent":
      return <AgentDetail profileSlug={route.profileSlug} />;
    case "handoff":
      return (
        <HandoffDetail
          credentialKey={route.credentialKey}
          handoffId={route.handoffId}
          lit={route.lit}
          litTake={route.litTake}
          picks={route.picks}
          focusCompare={route.focusCompare}
        />
      );
    case "reply":
      return <ReplyView credentialKey={route.credentialKey} take={route.take} picks={route.picks} />;
    case "compare":
      return <CompareView credentialKey={route.credentialKey} takes={route.takes} picks={route.picks} />;
  }
}
