// The app frame: side navigation, the current folder with Change and Reload, the
// load-error banner and the notice banner.

import { createContext, useContext, useMemo, useState } from "react";
import { CollectionsView } from "./CollectionsView";
import { LoadErrors } from "./LoadErrors";
import { MatrixView } from "./MatrixView";
import { ProfilesView } from "./ProfilesView";
import { useFolder } from "./useFolderState";

export type Route =
  | { view: "collections"; collectionSlug?: string; credentialKey?: string }
  | { view: "agents"; profileSlug?: string }
  | { view: "matrix"; cellKey?: string };

export interface NavContextValue {
  route: Route;
  navigate(route: Route): void;
}

const NavContext = createContext<NavContextValue | null>(null);

export function useNav(): NavContextValue {
  const value = useContext(NavContext);
  if (!value) throw new Error("useNav must be used inside an AppShell");
  return value;
}

const NAV_ITEMS: { view: Route["view"]; label: string }[] = [
  { view: "collections", label: "Collections" },
  { view: "agents", label: "Agents" },
  { view: "matrix", label: "Matrix" },
];

export interface AppShellProps {
  onChangeFolder: () => void;
  initialRoute?: Route;
}

export function AppShell({ onChangeFolder, initialRoute = { view: "collections" } }: AppShellProps) {
  const { folder, state, loading, reload, notice, setNotice } = useFolder();
  const [route, navigate] = useState<Route>(initialRoute);
  const nav = useMemo(() => ({ route, navigate }), [route]);

  return (
    <NavContext.Provider value={nav}>
      <div className="shell">
        <aside className="sidebar">
          <p className="brand">Andamio Desktop</p>
          <nav aria-label="Main">
            <ul>
              {NAV_ITEMS.map((item) => (
                <li key={item.view}>
                  <button
                    type="button"
                    className="nav-item"
                    aria-current={route.view === item.view ? "page" : undefined}
                    onClick={() => navigate({ view: item.view })}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <div className="main">
          <header className="topbar">
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
          <main className="content">
            {state === null ? (
              <p className="muted">{loading ? "Loading…" : "The folder could not be loaded."}</p>
            ) : route.view === "collections" ? (
              <CollectionsView />
            ) : route.view === "agents" ? (
              <ProfilesView />
            ) : (
              <MatrixView />
            )}
          </main>
        </div>
      </div>
    </NavContext.Provider>
  );
}
