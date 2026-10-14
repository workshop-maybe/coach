// The app frame (KTD1). Home is the only room: a top bar with the folder and its single
// actions (Change folder, Reload, Export, and Jev Mode, which opens the Jev Mode deck, KTD6),
// the load-error banner, the badge-warning notice and the notice banner, then home, a deck
// in progress, or one item open.
//
// A view can claim the window as a pane (KTD3, pane.tsx). While one does, the bar keeps
// only the window keys and the brand (R8), and the shell turns into a full-height column
// whose content area gives the pane all the height below the bar and the banners (KTD4).
// The banners stay mounted and compact to a line each in CSS, so an alert is not announced
// again, and nothing above the pane scrolls, so the window keys stay in view (R10).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { InkDefs } from "../cast/InkDefs";
import { Replay } from "../intro/Replay";
import { ReplayContext } from "../intro/replayContext";
import { AgentDetail } from "./AgentDetail";
import { BadgeDetail } from "./BadgeDetail";
import { CollectionDeck } from "./CollectionDeck";
import { CompareView } from "./CompareView";
import { CostOrderDeck } from "./CostOrderDeck";
import { CredentialDeck } from "./CredentialDeck";
import { EditAgentDeck, EditCollectionDeck, EditCredentialDeck } from "./EditDecks";
import { EditHandoffDeck, HandoffsDeck } from "./HandoffDecks";
import { HandoffDetail } from "./HandoffDetail";
import { JevDeck } from "./JevDeck";
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
import { RouterDeck } from "./RouterDeck";
import { seedFailedNotice, seedFirstBadge } from "./seedFirstBadge";
import { Sheet } from "./Sheet";
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
  // The intro replay is an overlay over Home, not a route (KTD11).
  const [replaying, setReplaying] = useState(false);
  const openReplay = useCallback(() => setReplaying(true), []);
  const closeReplay = useCallback(() => setReplaying(false), []);
  const nav = useMemo(() => ({ route, navigate }), [route]);
  // Each view opens at its top. The sheet's scroller keeps its offset across views, so a page
  // opened from a scrolled one would arrive scrolled part way down (R6, R10). A layout effect,
  // so it lands before ReplyList's effect scrolls a lit row into view.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [route]);
  // The first run's held line becomes a badge once the folder has loaded, and Home opens with
  // its row lit (KTD6, KTD10). Run on the load only, not on every reload: a save that failed
  // keeps its line for the next launch, not for the next window focus.
  const loaded = state !== null;
  useEffect(() => {
    if (!state) return;
    const seeding = seedFirstBadge(storage, state);
    if (!seeding) return;
    let live = true;
    void seeding.then((seeded) => {
      if (!live) return;
      if (!seeded.ok) return setNotice(seedFailedNotice(seeded.message));
      apply(seeded.state);
      navigate({ view: "home", litCredential: seeded.key });
    });
    return () => {
      live = false;
    };
  }, [loaded]);
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
        <ReplayContext.Provider value={openReplay}>
          <div className="shell" data-pane={pane || undefined} inert={replaying}>
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
                    <button type="button" onClick={() => navigate({ view: "deck", deck: "jev" })}>
                      Jev Mode
                    </button>
                  </div>
                </>
              )}
            </header>
            {/* The paper, set into the board as a sheet with a drawn edge. Only the sheet scrolls, so
                the top strip stays on the board and Home's doors pin to the sheet's foot. */}
            <Sheet scroller={scroller}>
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
            </Sheet>
          </div>
          {replaying && <Replay onClose={closeReplay} />}
        </ReplayContext.Provider>
      </PaneContext.Provider>
    </NavContext.Provider>
  );
}

/** A deck in progress. Keyed by route, so opening another deck starts it fresh. */
function DeckView({ route }: { route: DeckRoute }) {
  switch (route.deck) {
    case "credential":
      return <CredentialDeck returnTo={route.returnTo} fromJob={route.fromJob} collectionSlug={route.collectionSlug} />;
    case "agent":
      return <PlayerCard returnTo={route.returnTo} likeSlug={route.likeSlug} firstTest={route.firstTest} />;
    case "test":
      return <TestDeck profileSlug={route.profileSlug} credentialKey={route.credentialKey} resume={route.resume} handoffId={route.handoffId} returnTo={route.returnTo} />;
    case "edit-credential":
      return <EditCredentialDeck credentialKey={route.credentialKey} part={route.part} />;
    case "edit-agent":
      return <EditAgentDeck profileSlug={route.profileSlug} part={route.part} />;
    case "edit-collection":
      return <EditCollectionDeck collectionSlug={route.collectionSlug} part={route.part} />;
    case "handoffs":
      return <HandoffsDeck credentialKey={route.credentialKey} returnTo={route.returnTo} />;
    case "edit-handoff":
      return <EditHandoffDeck credentialKey={route.credentialKey} handoff={route.handoff} returnTo={route.returnTo} />;
    case "trash":
      return <TrashDeck item={route.item} />;
    case "jev":
      return <JevDeck />;
    case "router":
      return <RouterDeck resume={route.resume} />;
    case "cost-order":
      return <CostOrderDeck returnTo={route.returnTo} />;
    case "collection":
      return <CollectionDeck />;
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
