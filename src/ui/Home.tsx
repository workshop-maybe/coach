// Home, the only room (KTD1). Top to bottom: what needs you, your agents (each wearing
// the badges it earned), your badges (each showing who holds it), then the two doors.
// An empty folder shows only the doors (R5-R8).

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { cellKey } from "../domain/matrix";
import { credentialKey, type AgentProfile, type Collection, type Credential } from "../domain/types";
import { Badge } from "./Badge";
import { FLAG_SHORT } from "./format";
import { useNav } from "./nav";
import { needsYou, type NeedsYouItem } from "./needsYou";
import { usePendingTests } from "./pendingTests";
import { Person } from "./Person";
import { useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";

const SHOWN = 3;

interface Shelf {
  credentials: { credential: Credential; collection: Collection; key: string }[];
  byKey: Map<string, { credential: Credential; collection: Collection }>;
  profiles: Map<string, AgentProfile>;
}

export function Home() {
  const { state, folder } = useFolder();
  const { navigate } = useNav();
  const { pending } = usePendingTests(folder);
  const matrix = useMatrix(state);
  const [all, setAll] = useState(false);

  const shelf = useMemo<Shelf | null>(() => {
    if (!matrix || !state) return null;
    const credentials = matrix.columns.flatMap(({ collection, credentials }) =>
      credentials.map((credential) => ({ credential, collection, key: credentialKey(credential) })),
    );
    return {
      credentials,
      byKey: new Map(credentials.map((c) => [c.key, c])),
      profiles: new Map(state.profiles.map((p) => [p.slug, p])),
    };
  }, [matrix, state]);

  const items = useMemo(() => (state && matrix ? needsYou(state, matrix, pending) : []), [state, matrix, pending]);

  const doors = (
    <div className="doors">
      <button type="button" className="door" onClick={() => navigate({ view: "deck", deck: "agent" })}>
        <Person />
        <span>Create an agent</span>
      </button>
      <button type="button" className="door" onClick={() => navigate({ view: "deck", deck: "credential" })}>
        <span className="door-disc" aria-hidden="true" />
        <span>Create a credential</span>
      </button>
    </div>
  );

  // One tree whatever has loaded, so the doors never remount under a click.
  const holds = (profileSlug: string, key: string) => matrix?.cells.get(cellKey(profileSlug, key))?.status === "met";
  const shown = all ? items : items.slice(0, SHOWN);
  const profiles = shelf ? (state?.profiles ?? []) : [];

  return (
    <div className="home">
      <h1 className="visually-hidden">Home</h1>

      {shelf && items.length > 0 && (
        <section className="home-section" aria-labelledby="home-needs">
          <h2 id="home-needs">What needs you</h2>
          <ol className="needs">
            {shown.map((item) => (
              <li key={`${item.kind}:${itemId(item)}`}>
                <NeedRow item={item} shelf={shelf} onOpen={() => navigate(item.route)} />
              </li>
            ))}
          </ol>
          {!all && items.length > SHOWN && (
            <button type="button" className="link more" onClick={() => setAll(true)}>
              More
            </button>
          )}
        </section>
      )}

      {shelf && profiles.length > 0 && (
        <section className="home-section" aria-labelledby="home-agents">
          <h2 id="home-agents">Agents</h2>
          <ul className="shelf">
            {profiles.map((p) => {
              const earned = shelf.credentials.filter((c) => holds(p.slug, c.key));
              return (
                <li key={p.slug}>
                  <button type="button" className="agent-card" onClick={() => navigate({ view: "item", item: "agent", profileSlug: p.slug })}>
                    <Person solid={earned.length > 0} />
                    <span className="agent-card-name">{p.name}</span>
                    <span className="agent-card-setup">{[p.harness, p.model, p.effort].filter(Boolean).join(" · ")}</span>
                    {earned.length > 0 && (
                      <span className="agent-card-badges">
                        {earned.map((c) => (
                          <Badge key={c.key} collection={c.collection} credential={c.credential} size={24} />
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {shelf && shelf.credentials.length > 0 && (
        <section className="home-section" aria-labelledby="home-badges">
          <h2 id="home-badges">Badges</h2>
          <ul className="shelf">
            {shelf.credentials.map((c) => {
              const holders = profiles.filter((p) => holds(p.slug, c.key));
              return (
                <li key={c.key}>
                  <button type="button" className="badge-card" onClick={() => navigate({ view: "item", item: "badge", credentialKey: c.key })}>
                    <Badge collection={c.collection} credential={c.credential} size={72} />
                    <span className="badge-card-name">{c.credential.name}</span>
                    <span className="holders">
                      {holders.length === 0 ? (
                        <span className="holders-none">No holders yet</span>
                      ) : (
                        holders.map((p) => (
                          <span key={p.slug} className="holder" title={p.name}>
                            <Person />
                            <span className="visually-hidden">{p.name}</span>
                          </span>
                        ))
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {doors}
    </div>
  );
}

function itemId(item: NeedsYouItem): string {
  return "credentialKey" in item ? `${item.credentialKey}|${"profileSlug" in item ? item.profileSlug : ""}` : item.profileSlug;
}

function NeedRow({ item, shelf, onOpen }: { item: NeedsYouItem; shelf: Shelf; onOpen(): void }) {
  const cred = "credentialKey" in item ? shelf.byKey.get(item.credentialKey) : undefined;
  const agent = "profileSlug" in item ? shelf.profiles.get(item.profileSlug) : undefined;
  const name = cred?.credential.name ?? "";
  const who = agent?.name ?? "";

  let title: string;
  let detail: string;
  switch (item.kind) {
    case "reply":
      title = `Paste ${who}'s reply`;
      detail = name;
      break;
    case "retest":
      title = `Re-test ${who}`;
      detail = [name, ...item.flags.map((f) => FLAG_SHORT[f])].join(" · ");
      break;
    case "half-credential":
      title = `Finish ${name}`;
      detail = item.missing === "task" ? "Add its task" : "Add a learning target";
      break;
    case "half-agent":
      title = `Test ${who}`;
      detail = "No results yet";
      break;
    case "unheld":
      title = name;
      detail = "Nobody holds it yet";
      break;
  }

  let mark: ReactNode = <Person />;
  if (cred) mark = <Badge collection={cred.collection} credential={cred.credential} size={28} />;

  return (
    <button type="button" className={`need need-${item.kind}`} onClick={onOpen}>
      {mark}
      <span className="need-title">{title}</span>
      <span className="need-detail">{detail}</span>
    </button>
  );
}
