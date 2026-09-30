// Moving an agent or a credential to the trash: one card that names what goes with it.
// Nothing is deleted. The files move under trash/<stamp>/ in the data folder at their
// own paths, so moving them back restores the item and its results.

import { loadFolder } from "../domain/folder";
import { trashCredential, trashProfile } from "../domain/operations";
import { credentialKey, parseCredentialKey, type FolderState } from "../domain/types";
import { Deck } from "./Deck";
import { useNav } from "./nav";
import type { TrashItem } from "./routes";
import { usePendingTests } from "./pendingTests";
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

function resultsLine(count: number): string {
  if (count === 0) return "It has no results.";
  return count === 1 ? "Its result goes with it." : `Its ${count} results go with it.`;
}

export function TrashDeck({ item }: { item: TrashItem }) {
  const { storage, state, folder, apply, reload } = useFolder();
  const { pending, remove } = usePendingTests(folder);
  const { navigate } = useNav();
  if (!state) return null;

  const back = () =>
    navigate(item.kind === "agent" ? { view: "item", item: "agent", profileSlug: item.profileSlug } : { view: "item", item: "badge", credentialKey: item.credentialKey });
  const home = () => navigate({ view: "home" });

  const name =
    item.kind === "agent"
      ? state.profiles.find((p) => p.slug === item.profileSlug)?.name
      : state.credentials.find((c) => credentialKey(c) === item.credentialKey)?.name;
  if (name === undefined) return <Missing onHome={home} />;

  const results = state.assessments.filter((a) =>
    item.kind === "agent" ? a.profileSlug === item.profileSlug : credentialKey(a) === item.credentialKey,
  ).length;

  async function move(current: FolderState) {
    if (item.kind === "agent") return trashProfile(storage, current, item.profileSlug);
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
    for (const p of pending) {
      const gone = item.kind === "agent" ? p.profileSlug === item.profileSlug : p.credentialKey === item.credentialKey;
      if (gone) remove(p.profileSlug, p.credentialKey);
    }
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
          title: `Move ${name} to trash`,
          forward: "Move to trash",
          body: <p className="muted">{resultsLine(results)}</p>,
        },
      ]}
    />
  );
}
