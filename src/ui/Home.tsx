// Home, the only room (KTD1). Top to bottom: what needs you, your agents (machines, each
// lighting the keys it earned, cheapest first once the user set a cost order), your badges
// (cartridges, each showing who holds it), then the three doors with dashed outlines: an
// agent, a credential, and a job to find an agent for (R9, R12, router R1). When all three sections
// show, a wide window puts what needs you beside your agents so home fits one screen; the
// pairing is a class on one wrapper, so a need coming or going never remounts a shelf or a
// door (App.css). With no agents, "Try a first test" leads: in an empty folder it runs one
// preset on an agent made on the spot, and beside a badge with a task it runs that badge
// (KTD10). The badge the first run just saved lights its row in What needs you. An agent
// holding a handoff shows it plugged in wherever it stands (R15). A badge with a go-to names it under its holders, flagged when it needs a
// look (R7, R9). The cast is hidden from assistive tech, so names and what each agent earned
// stay in text. With two or more collections, or a lone built-in copy, the badges show as one
// group per collection under its name, in the same order as the flat list (collections plan
// R1, KTD5). A collection just added lights its group, re-read from the folder every render.

import { Fragment, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { goToOf, goToStanding } from "../domain/goTo";
import { cellKey } from "../domain/matrix";
import { byCost } from "../domain/recommend";
import { credentialKey, type AgentProfile, type Collection, type Credential, type FolderState } from "../domain/types";
import { Cartridge } from "../cast/Cartridge";
import { Machine } from "../cast/Machine";
import { Outline } from "../cast/Outline";
import { machineKeys, type MachineKey } from "../cast/mappings";
import { useReplay } from "../intro/replayContext";
import { FLAG_SHORT, goToLine, handoffText, plugMark } from "./format";
import { useNav } from "./nav";
import { needsYou, type NeedsYouItem } from "./needsYou";
import { livePlugs, plugFor, usePendingTests, type PendingTest } from "./pendingTests";
import { useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";

const SHOWN = 3;

interface ShelfCredential {
  credential: Credential;
  collection: Collection;
  key: string;
}

interface Shelf {
  /** The folder the shelf was read from. */
  state: FolderState;
  credentials: ShelfCredential[];
  /** The badges per collection, in the folder's collection order: `credentials` is these flattened. */
  groups: { collection: Collection; credentials: ShelfCredential[] }[];
  byKey: Map<string, { credential: Credential; collection: Collection }>;
  profiles: Map<string, AgentProfile>;
  /** Each agent's lit keys, oldest first. */
  keys: Map<string, MachineKey[]>;
  /** Each plugged agent's handoff, as its machine draws it. */
  plugs: Map<string, { label?: string }>;
}

export function Home() {
  const { state, folder } = useFolder();
  const { navigate, route } = useNav();
  const { pending } = usePendingTests(folder);
  const matrix = useMatrix(state);
  const [all, setAll] = useState(false);
  const replay = useReplay();

  const shelf = useMemo<Shelf | null>(() => {
    if (!matrix || !state) return null;
    const groups = matrix.columns.map(({ collection, credentials }) => ({
      collection,
      credentials: credentials.map((credential) => ({ credential, collection, key: credentialKey(credential) })),
    }));
    const credentials = groups.flatMap((g) => g.credentials);
    return {
      state,
      credentials,
      groups,
      byKey: new Map(credentials.map((c) => [c.key, c])),
      profiles: new Map(state.profiles.map((p) => [p.slug, p])),
      keys: new Map(state.profiles.map((p) => [p.slug, machineKeys(matrix, p.slug)])),
      plugs: plugsOf(state, pending),
    };
  }, [matrix, state, pending]);

  // Empty is read from the folder, not the matrix, so a full folder never flashes the empty
  // layout while its matrix builds; until then the full layout shows only its doors.
  const empty = !!state && state.credentials.length === 0 && state.profiles.length === 0;

  const computed = useMemo(() => (state && matrix ? needsYou(state, matrix, pending) : []), [state, matrix, pending]);
  // The badge the first run just saved lights its half-made row, which leads the list (KTD10).
  // Re-found in the folder every render, so a badge gone since lights nothing.
  const litKey = route.view === "home" ? route.litCredential : undefined;
  const { litItem, items } = useMemo(() => {
    const litItem = litKey === undefined ? undefined : computed.find((i) => i.kind === "half-credential" && i.credentialKey === litKey);
    return { litItem, items: litItem ? [litItem, ...computed.filter((i) => i !== litItem)] : computed };
  }, [computed, litKey]);

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
      {/* A job is text you hand to an agent, so its door shows the empty handoff card (router KTD13). */}
      <button type="button" className="door" onClick={() => navigate({ view: "deck", deck: "router" })}>
        <Outline kind="handoff" width={empty ? 164 : 54} />
        <span>Find an agent for a job</span>
      </button>
    </div>
  );

  // One tree whatever has loaded, so the doors never remount under a click.
  const holds = (profileSlug: string, key: string) => matrix?.cells.get(cellKey(profileSlug, key))?.status === "met";
  const shown = all ? items : items.slice(0, SHOWN);
  // Agents cheapest first once the user set a cost order, the rest after them by name (router R10, R11).
  const profiles = shelf ? byCost(shelf.state) : [];
  const showNeeds = !!shelf && items.length > 0;
  const showAgents = !!shelf && profiles.length > 0;
  const showBadges = !!shelf && shelf.groups.length > 0;
  const paired = showNeeds && showAgents && showBadges;
  // One collection of the user's own reads as today's single list, with no group heading (R1, R2).
  const grouped = !!shelf && (shelf.groups.length > 1 || shelf.groups.some((g) => g.collection.from !== undefined));
  // A slug no longer in the folder simply lights nothing.
  const lit = route.view === "home" ? route.litCollection : undefined;
  // With no collection, no badge can show, so Add a collection moves under the doors (R7).
  const noCollections = !!state && state.collections.length === 0;
  // With no agents, the first test leads (KTD10): on the preset in an empty folder, on the
  // first badge with a task otherwise. Badges with no task lead with their rows instead, so the
  // preset never runs over the user's own badge (R9).
  const firstTest = firstTestFor(state, shelf);
  const addCollection = () => navigate({ view: "deck", deck: "collection" });

  const badgeCard = (c: ShelfCredential) => {
    const holders = profiles.filter((p) => holds(p.slug, c.key));
    const goTo = state && matrix ? goToOf(state, c.key) : null;
    const flags = goTo && matrix ? goToStanding(matrix, goTo).flags : [];
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
                  <Machine mini setup={p} keys={shelf?.keys.get(p.slug)} plugged={shelf?.plugs.get(p.slug)} width={36} />
                  <span className="visually-hidden">{p.name}</span>
                </span>
              ))
            )}
          </span>
          {/* One text run, so the hidden holder names stay the only text that is just a name (KTD8). */}
          {goTo && <span className={`badge-card-goto${flags.length > 0 ? " flagged" : ""}`}>{goToLine(goTo.profile.name, flags)}</span>}
        </button>
      </li>
    );
  };

  return (
    <div className={empty ? "home home-empty" : "home"}>
      <h1 className="visually-hidden">Home</h1>

      <p className="home-replay">
        <button type="button" className="ghost" onClick={replay}>
          Watch the intro
        </button>
      </p>

      {shelf && (showNeeds || showAgents || showBadges) && (
        <div className={paired ? "home-shelves home-shelves-paired" : "home-shelves"}>
          {showNeeds && (
            <section className="home-section" aria-labelledby="home-needs">
              <h2 id="home-needs">What needs you</h2>
              <ol className="needs">
                {shown.map((item) => (
                  <li key={`${item.kind}:${itemId(item)}`}>
                    <NeedRow item={item} shelf={shelf} lit={item === litItem} onOpen={() => navigate(item.route)} />
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
                        <Machine mini setup={p} keys={shelf.keys.get(p.slug)} plugged={shelf.plugs.get(p.slug)} width={96} />
                        <span className="agent-card-name">{p.name}</span>
                        {/* Each setting keeps its line whole; the line breaks only between them. */}
                        <span className="agent-card-setup">
                          {[p.harness, p.model, p.effort]
                            .filter(Boolean)
                            .map((part, i) => (
                              <Fragment key={i}>
                                {i > 0 && " · "}
                                <span>{part}</span>
                              </Fragment>
                            ))}
                        </span>
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
              <button type="button" className="link more" onClick={() => navigate({ view: "deck", deck: "cost-order" })}>
                Order by cost
              </button>
            </section>
          )}

          {showBadges && (
            <section className="home-section" aria-labelledby="home-badges">
              <div className="home-section-head">
                <h2 id="home-badges">Badges</h2>
                <button type="button" className="link more" onClick={addCollection}>
                  Add a collection
                </button>
              </div>
              {grouped
                ? shelf.groups.map(({ collection, credentials }) => {
                    const headingId = `home-collection-${collection.slug}`;
                    return (
                      <div key={collection.slug} role="group" aria-labelledby={headingId} className={collection.slug === lit ? "collection-group lit" : "collection-group"}>
                        <div className="collection-group-head">
                          <h3 id={headingId}>{collection.name}</h3>
                          <button
                            type="button"
                            className="link more"
                            aria-label={`Add a badge to ${collection.name}`}
                            onClick={() => navigate({ view: "deck", deck: "credential", collectionSlug: collection.slug })}
                          >
                            Add a badge here
                          </button>
                          <button
                            type="button"
                            className="link more"
                            aria-label={`Rename ${collection.name}`}
                            onClick={() => navigate({ view: "deck", deck: "edit-collection", collectionSlug: collection.slug, part: "name" })}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className="link more"
                            aria-label={`Delete ${collection.name}`}
                            onClick={() => navigate({ view: "deck", deck: "trash", item: { kind: "collection", collectionSlug: collection.slug } })}
                          >
                            Delete
                          </button>
                        </div>
                        {credentials.length > 0 && <ul className="shelf">{credentials.map(badgeCard)}</ul>}
                      </div>
                    );
                  })
                : shelf.credentials.length > 0 && <ul className="shelf">{shelf.credentials.map(badgeCard)}</ul>}
            </section>
          )}
        </div>
      )}

      {firstTest && (
        <div className="first-test">
          <button
            type="button"
            className="primary"
            onClick={() =>
              navigate(
                // On a badge, the agent card's way back to a waiting test opens it at Hand it over.
                firstTest.credentialKey
                  ? { view: "deck", deck: "agent", returnTo: { credentialKey: firstTest.credentialKey } }
                  : { view: "deck", deck: "agent", firstTest: true },
              )
            }
          >
            Try a first test
          </button>
        </div>
      )}

      {doors}

      {/* After the doors, so they never remount when it comes or goes. */}
      {noCollections && (
        <p className="home-add-collection">
          <button type="button" className="link more" onClick={addCollection}>
            Add a collection
          </button>
        </p>
      )}
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

/** A row's key. Held rows on one badge are told apart by their handoff (hold-and-compare KTD12). */
/** The first test Home leads with, if any: the preset (no key) or a badge with a task. */
function firstTestFor(state: FolderState | null, shelf: Shelf | null): { credentialKey?: string } | null {
  if (!state || state.profiles.length > 0) return null;
  if (state.credentials.length === 0) return {};
  const ready = shelf?.credentials.find((c) => c.credential.task.trim() !== "");
  return ready ? { credentialKey: ready.key } : null;
}

function itemId(item: NeedsYouItem): string {
  if (item.kind === "held") return `${item.credentialKey}|${item.handoffId}`;
  return "credentialKey" in item ? `${item.credentialKey}|${"profileSlug" in item ? item.profileSlug : ""}` : item.profileSlug;
}

function NeedRow({ item, shelf, lit, onOpen }: { item: NeedsYouItem; shelf: Shelf; lit: boolean; onOpen(): void }) {
  const cred = "credentialKey" in item ? shelf.byKey.get(item.credentialKey) : undefined;
  const agent = "profileSlug" in item && item.profileSlug ? shelf.profiles.get(item.profileSlug) : undefined;
  const name = cred?.credential.name ?? "";
  const who = agent?.name ?? "";

  let title: string;
  let detail: string;
  switch (item.kind) {
    case "reply":
      title = `Pull ${who}'s handoff`;
      detail = name;
      break;
    case "held":
      title = item.takes.length > 1 ? `Compare ${item.takes.length} replies` : `Judge ${who}'s reply`;
      detail = `${name} · ${handoffText(shelf.state, item.credentialKey, item.handoffId)}`;
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
    <button type="button" className={`need need-${item.kind}${lit ? " lit" : ""}`} onClick={onOpen}>
      {mark}
      <span className="need-title">{title}</span>
      <span className="need-detail">{detail}</span>
    </button>
  );
}
