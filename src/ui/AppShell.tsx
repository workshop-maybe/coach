// The app frame (KTD1). Home is the only room: a top bar with the folder and its three
// single actions (Change folder, Reload, Export), the load-error banner, the badge-warning
// notice and the notice banner, then home, a deck in progress, or one item open.

import { useMemo, useState } from "react";
import { CollectionsView } from "./CollectionsView";
import { CredentialDeck } from "./CredentialDeck";
import { exportAll, exportMessage } from "./exportAll";
import { pickExportFolder } from "./exportFolder";
import { Home } from "./Home";
import { LoadErrors, LoadWarnings } from "./LoadErrors";
import { Lockup } from "./Lockup";
import { MatrixView } from "./MatrixView";
import { NavContext, useNav } from "./nav";
import { PlayerCard } from "./PlayerCard";
import { ProfilesView } from "./ProfilesView";
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
      <div className="shell">
        <header className="topbar">
          <button type="button" className="brand" aria-label="Andamio Desktop, go home" onClick={() => navigate({ view: "home" })}>
            <Lockup />
          </button>
          <span className="folder-path" title={folder}>
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
          ) : route.view === "item" ? (
            <RoutePlaceholder route={route} />
          ) : route.view === "collections" ? (
            <CollectionsView />
          ) : route.view === "agents" ? (
            <ProfilesView />
          ) : (
            <MatrixView />
          )}
        </main>
      </div>
    </NavContext.Provider>
  );
}

/** A deck in progress. Keyed by route, so opening another deck starts it fresh. */
function DeckView({ route }: { route: DeckRoute }) {
  switch (route.deck) {
    case "credential":
      return <CredentialDeck returnTo={route.returnTo} />;
    case "agent":
      return <PlayerCard returnTo={route.returnTo} />;
    case "test":
      return <TestDeck profileSlug={route.profileSlug} credentialKey={route.credentialKey} resume={route.resume} />;
    default:
      return <RoutePlaceholder route={route} />;
  }
}

// TODO(U6-U7): the edit decks and badge (U6) and agent (U7) replace this placeholder. It exists so home's rows and doors have
// somewhere to go while those units are built.
function RoutePlaceholder({ route }: { route: DeckRoute | ItemRoute }) {
  const { navigate } = useNav();
  return (
    <section className="deck" data-testid="route-placeholder" data-route={JSON.stringify(route)} aria-label="Not built yet">
      <div className="deck-card">
        <h2>Not built yet</h2>
        <p className="muted">{route.view === "deck" ? `The ${route.deck} deck` : `This ${route.item}`} arrives in a later step</p>
        <div className="deck-actions">
          <button type="button" className="ghost" onClick={() => navigate({ view: "home" })}>
            Home
          </button>
        </div>
      </div>
    </section>
  );
}
