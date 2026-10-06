// Moving an agent, a credential or a whole collection to the trash: one card that names
// what goes with it.
// Nothing is deleted. The files move under trash/<stamp>/ in the data folder at their
// own paths, so moving them back restores the item and its results. A handoff plugged
// into the agent, or fed from the badge, is pulled with no result (R17).

import { loadFolder } from "../domain/folder";
import { trashCollection, trashCredential, trashProfile } from "../domain/operations";
import { credentialKey, parseCredentialKey, type Assessment, type FolderState, type HeldReply } from "../domain/types";
import { Deck } from "./Deck";
import { useNav } from "./nav";
import type { TrashItem } from "./routes";
import { livePlugs, usePendingTests } from "./pendingTests";
import { Missing } from "./shared";
import { useFolder } from "./useFolderState";

/** The quiet way in, at the foot of an opened agent or badge. */
export function TrashLink({ onOpen }: { onOpen(): void }) {
  return (
    <p className="detail-trash">
      <button type="button" className="ghost detail-trash-button" onClick={onOpen}>
        Move to trash
      </button>
    </p>
  );
}

/** What goes with it: its results and its held replies, each named only when there are any. */
function goesLine(results: number, held: number): string {
  if (results === 0 && held === 0) return "It has no results.";
  const parts: string[] = [];
  if (results > 0) parts.push(results === 1 ? "result" : `${results} results`);
  if (held > 0) parts.push(held === 1 ? (results > 0 ? "its held reply" : "held reply") : `${held} held replies`);
  return `Its ${parts.join(" and ")} ${results + held === 1 ? "goes" : "go"} with it.`;
}

/** What goes with a collection: its badges and their results (collections plan R4). */
function collectionLine(badges: number, results: number): string {
  if (badges === 0 && results === 0) return "It has no badges.";
  const parts: string[] = [];
  if (badges > 0) parts.push(badges === 1 ? "badge" : `${badges} badges`);
  if (results > 0) parts.push(results === 1 ? (badges > 0 ? "its result" : "result") : `${results} results`);
  return `Its ${parts.join(" and ")} ${badges + results === 1 ? "goes" : "go"} with it.`;
}

/** The plugs that go: the agent's own, or each agent's fed from the badge. */
function plugLine(item: TrashItem, holders: string[]): string | null {
  if (holders.length === 0) return null;
  if (item.kind === "agent") return "Its handoff is pulled with no result.";
  return holders.length === 1 ? `${holders[0]}'s handoff is pulled with no result.` : `${holders.length} handoffs are pulled with no result.`;
}

export function TrashDeck({ item }: { item: TrashItem }) {
  const { storage, state, folder, apply, reload } = useFolder();
  const { pending, remove } = usePendingTests(folder);
  const { navigate } = useNav();
  if (!state) return null;

  const home = () => navigate({ view: "home" });
  const back = () =>
    item.kind === "agent"
      ? navigate({ view: "item", item: "agent", profileSlug: item.profileSlug })
      : item.kind === "badge"
        ? navigate({ view: "item", item: "badge", credentialKey: item.credentialKey })
        : home();

  const name =
    item.kind === "agent"
      ? state.profiles.find((p) => p.slug === item.profileSlug)?.name
      : item.kind === "badge"
        ? state.credentials.find((c) => credentialKey(c) === item.credentialKey)?.name
        : state.collections.find((c) => c.slug === item.collectionSlug)?.name;
  if (name === undefined) return <Missing onHome={home} />;

  /** True for a badge key the move takes: the badge itself, or any badge in the collection. */
  const takesBadge = (key: string) =>
    item.kind === "badge" ? key === item.credentialKey : item.kind === "collection" && parseCredentialKey(key).collectionSlug === item.collectionSlug;
  /** True for a waiting test the move ends. */
  const takesPlug = (p: { profileSlug: string; credentialKey: string }) => (item.kind === "agent" ? p.profileSlug === item.profileSlug : takesBadge(p.credentialKey));

  // Everything the move takes from assessments/: the results, and the replies held without a verdict.
  const goes = (a: Assessment | HeldReply) => (item.kind === "agent" ? a.profileSlug === item.profileSlug : takesBadge(credentialKey(a)));
  const results = state.assessments.filter(goes).length;
  const held = state.held.filter(goes).length;
  const badges = item.kind === "collection" ? state.credentials.filter((c) => c.collectionSlug === item.collectionSlug).length : 0;
  const plugged = livePlugs(pending, state)
    .filter(takesPlug)
    .map((p) => state.profiles.find((a) => a.slug === p.profileSlug)!.name);
  const pulled = plugLine(item, plugged);

  async function move(current: FolderState) {
    if (item.kind === "agent") return trashProfile(storage, current, item.profileSlug);
    if (item.kind === "collection") return trashCollection(storage, current, item.collectionSlug);
    const { collectionSlug, slug } = parseCredentialKey(item.credentialKey);
    return trashCredential(storage, current, collectionSlug, slug);
  }

  async function finish({ keepMine }: { keepMine: boolean }) {
    // Keep mine moves it anyway, over whatever changed on disk since the card opened.
    const current = keepMine ? await loadFolder(storage) : state;
    if (!current) return;
    try {
      apply(await move(current));
    } catch (e) {
      // Show what is on disk now, so trying again moves only what is left.
      apply(await loadFolder(storage));
      throw e;
    }
    // A waiting test for it would otherwise pass to a new agent or credential with its name.
    for (const p of pending) if (takesPlug(p)) remove(p.profileSlug, p.credentialKey);
    home();
  }

  return (
    <Deck
      label="Move to trash"
      onClose={back}
      onFinish={finish}
      onUseTheirs={() => void reload().then(back)}
      beats={[
        {
          id: "trash",
          title: item.kind === "collection" ? `Move ${name} to the trash` : `Move ${name} to trash`,
          forward: "Move to trash",
          body: (
            <>
              <p className="muted">{item.kind === "collection" ? collectionLine(badges, results) : goesLine(results, held)}</p>
              {pulled && <p className="muted">{pulled}</p>}
            </>
          ),
        },
      ]}
    />
  );
}
