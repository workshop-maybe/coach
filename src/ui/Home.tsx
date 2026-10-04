// Home, the only room (KTD1). Top to bottom: what needs you, your agents (machines, each
// lighting the keys it earned), your badges (cartridges, each showing who holds it), then
// the two doors with dashed outlines of what they make (R9, R12). When all three sections
// show, a wide window puts what needs you beside your agents so home fits one screen; the
// pairing is a class on one wrapper, so a need coming or going never remounts a shelf or a
// door (App.css). An empty folder leads with "Try a first test", which runs one preset on
// an agent made on the spot. An agent holding a handoff shows it plugged in wherever it
// stands (R15). The cast is hidden from assistive tech, so names and what each agent earned
// stay in text.

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { cellKey } from "../domain/matrix";
import { credentialKey, type AgentProfile, type Collection, type Credential, type FolderState } from "../domain/types";
import { Cartridge } from "../cast/Cartridge";
import { Machine } from "../cast/Machine";
import { Outline } from "../cast/Outline";
import { machineKeys, type MachineKey } from "../cast/mappings";
import { FLAG_SHORT, plugMark } from "./format";
import { useNav } from "./nav";
import { needsYou, type NeedsYouItem } from "./needsYou";
import { livePlugs, plugFor, usePendingTests, type PendingTest } from "./pendingTests";
import { useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";

const SHOWN = 3;

interface Shelf {
  credentials: { credential: Credential; collection: Collection; key: string }[];
  byKey: Map<string, { credential: Credential; collection: Collection }>;
  profiles: Map<string, AgentProfile>;
  /** Each agent's lit keys, oldest first. */
  keys: Map<string, MachineKey[]>;
  /** Each plugged agent's handoff, as its machine draws it. */
  plugs: Map<string, { label?: string }>;
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
      keys: new Map(state.profiles.map((p) => [p.slug, machineKeys(matrix, p.slug)])),
      plugs: plugsOf(state, pending),
    };
  }, [matrix, state, pending]);

  // Empty is read from the folder, not the matrix, so a full folder never flashes the empty
  // layout while its matrix builds; until then the full layout shows only its doors.
  const empty = !!state && state.credentials.length === 0 && state.profiles.length === 0;

  const items = useMemo(() => (state && matrix ? needsYou(state, matrix, pending) : []), [state, matrix, pending]);

  const doors = (
    <div className="doors">
      <button type="button" className="door" onClick={() => navigate({ view: "deck", deck: "agent" })}>
        <Outline kind="machine" width={empty ? 220 : 72} />
        <span>Create an agent</span>
      </button>
      <button type="button" className="door" onClick={() => navigate({ view: "deck", deck: "credential" })}>
        <Outline kind="cartridge" width={empty ? 110 : 36} />
        <span>Create a credential</span>
      </button>
    </div>
  );

  // One tree whatever has loaded, so the doors never remount under a click.
  const holds = (profileSlug: string, key: string) => matrix?.cells.get(cellKey(profileSlug, key))?.status === "met";
  const shown = all ? items : items.slice(0, SHOWN);
  const profiles = shelf ? (state?.profiles ?? []) : [];
  const showNeeds = !!shelf && items.length > 0;
  const showAgents = !!shelf && profiles.length > 0;
  const showBadges = !!shelf && shelf.credentials.length > 0;
  const paired = showNeeds && showAgents && showBadges;

  return (
    <div className={empty ? "home home-empty" : "home"}>
      <h1 className="visually-hidden">Home</h1>

      {shelf && (showNeeds || showAgents || showBadges) && (
        <div className={paired ? "home-shelves home-shelves-paired" : "home-shelves"}>
          {showNeeds && (
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

          {showAgents && (
            <section className="home-section" aria-labelledby="home-agents">
              <h2 id="home-agents">Agents</h2>
              <ul className="shelf">
                {profiles.map((p) => {
                  const earned = shelf.credentials.filter((c) => holds(p.slug, c.key));
                  return (
                    <li key={p.slug}>
                      <button type="button" className="agent-card" onClick={() => navigate({ view: "item", item: "agent", profileSlug: p.slug })}>
                        <Machine mini setup={p} keys={shelf.keys.get(p.slug)} plugged={shelf.plugs.get(p.slug)} width={128} />
                        <span className="agent-card-name">{p.name}</span>
                        <span className="agent-card-setup">{[p.harness, p.model, p.effort].filter(Boolean).join(" · ")}</span>
                        {earned.length > 0 && (
                          <span className="visually-hidden" role="list" aria-label="Earned">
                            {earned.map((c) => (
                              <span key={c.key} role="listitem">
                                {c.credential.name}
                              </span>
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

          {showBadges && (
            <section className="home-section" aria-labelledby="home-badges">
              <h2 id="home-badges">Badges</h2>
              <ul className="shelf">
                {shelf.credentials.map((c) => {
                  const holders = profiles.filter((p) => holds(p.slug, c.key));
                  return (
                    <li key={c.key}>
                      <button type="button" className={`badge-card${holders.length === 0 ? " badge-card-unheld" : ""}`} onClick={() => navigate({ view: "item", item: "badge", credentialKey: c.key })}>
                        <Cartridge collection={c.collection} credential={c.credential} width={64} />
                        <span className="badge-card-name">{c.credential.name}</span>
                        <span className="holders">
                          {holders.length === 0 ? (
                            <span className="holders-none">No holders yet</span>
                          ) : (
                            holders.map((p) => (
                              <span key={p.slug} className="holder" title={p.name}>
                                <Machine mini setup={p} keys={shelf.keys.get(p.slug)} plugged={shelf.plugs.get(p.slug)} width={36} />
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
        </div>
      )}

      {empty && (
        <div className="first-test">
          <button type="button" className="primary" onClick={() => navigate({ view: "deck", deck: "agent", firstTest: true })}>
            Try a first test
          </button>
        </div>
      )}

      {doors}
    </div>
  );
}

/** Each agent's plug, labeled with its handoff's key: "S" or the badge handoff's letter. */
function plugsOf(state: FolderState, pending: PendingTest[]): Shelf["plugs"] {
  const live = livePlugs(pending, state);
  const plugs: Shelf["plugs"] = new Map();
  for (const p of state.profiles) {
    const mark = plugMark(state, plugFor(live, p.slug));
    if (mark) plugs.set(p.slug, mark);
  }
  return plugs;
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
      title = `Pull ${who}'s handoff`;
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

  // An agent's row shows its machine, waiting on a reply with its cursor and its handoff
  // plugged in; a credential's shows its cartridge.
  let mark: ReactNode = null;
  if (agent) mark = <Machine mini setup={agent} keys={shelf.keys.get(agent.slug)} screen={{ kind: item.kind === "reply" ? "waiting" : "idle" }} plugged={shelf.plugs.get(agent.slug)} width={60} />;
  else if (cred) mark = <Cartridge collection={cred.collection} credential={cred.credential} width={28} />;

  return (
    <button type="button" className={`need need-${item.kind}`} onClick={onOpen}>
      {mark}
      <span className="need-title">{title}</span>
      <span className="need-detail">{detail}</span>
    </button>
  );
}
