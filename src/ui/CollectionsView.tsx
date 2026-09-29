// Collections and their credentials (R1, F1): create and rename collections, add and
// reorder credentials, open a credential's editor, and export a collection.

import { useMemo, useState } from "react";
import type { BadgeSettings } from "../badge/settings";
import { collectionPath } from "../domain/folder";
import {
  createCollection,
  createCredential,
  importBadgeArt,
  reorderCredentials,
  updateCollection,
  updateCollectionBadge,
} from "../domain/operations";
import { credentialKey, type Collection, type FolderState } from "../domain/types";
import { useNav } from "./AppShell";
import { Badge } from "./Badge";
import { BadgeControls, cleanSettings, isEmptySettings, useRingHues } from "./BadgeControls";
import { CredentialEditor } from "./CredentialEditor";
import { EditorStatus, SaveBar, useDraftWithBase, type DraftWithBase } from "./useDraftWithBase";
import { ExportDialog } from "./ExportDialog";
import { PageHeader } from "./PageHeader";
import { describeError, useFolder } from "./useFolderState";

export function CollectionsView() {
  const { route, navigate } = useNav();
  const { state } = useFolder();
  if (route.view !== "collections" || state === null) return null;
  const { collectionSlug, credentialKey: key } = route;

  if (collectionSlug && key) {
    const collection = state.collections.find((c) => c.slug === collectionSlug);
    return (
      <div className="stack">
        <button type="button" className="link back" onClick={() => navigate({ view: "collections", collectionSlug })}>
          Back to {collection?.name ?? collectionSlug}
        </button>
        <CredentialEditor key={key} credentialKey={key} />
      </div>
    );
  }
  if (collectionSlug) return <CollectionDetail key={collectionSlug} slug={collectionSlug} />;
  return <CollectionList />;
}

// ---------------------------------------------------------------------------

function CollectionList() {
  const { state, storage, apply } = useFolder();
  const { navigate } = useNav();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const collections = state?.collections ?? [];

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state || name.trim() === "") return;
    try {
      const result = await createCollection(storage, state, name);
      apply(result.state);
      setName("");
      navigate({ view: "collections", collectionSlug: result.slug });
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <section className="stack">
      <PageHeader
        kicker="Your credentials"
        title="Collections"
        lead={<>A credential is <strong>a promise you can check.</strong> Group them into collections.</>}
      />
      {collections.length === 0 ? (
        <p className="muted">No collections yet. A collection groups related credentials. Create one to start writing credentials.</p>
      ) : (
        <ul className="item-list" aria-label="Collections">
          {collections.map((c) => (
            <li key={c.slug}>
              <button type="button" className="item" onClick={() => navigate({ view: "collections", collectionSlug: c.slug })}>
                <span className="item-name">{c.name}</span>
                <span className="muted">
                  {c.order.length === 1 ? "1 credential" : `${c.order.length} credentials`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="inline-form" onSubmit={onCreate}>
        <label className="field">
          <span>New collection name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" disabled={name.trim() === ""}>
          Create collection
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function CollectionDetail({ slug }: { slug: string }) {
  const { state, storage, apply } = useFolder();
  const { navigate } = useNav();
  const path = collectionPath(slug);
  const find = (s: typeof state) => s?.collections.find((c) => c.slug === slug) ?? null;
  const d = useDraftWithBase<Pick<Collection, "name" | "description">>(path, (s) => {
    const c = find(s);
    return c && { name: c.name, description: c.description };
  });
  // The badge panel keeps a second draft on the same file, with its own Save and Revert.
  const b = useDraftWithBase<{ settings: BadgeSettings }>(path, (s) => {
    const c = find(s);
    return c && { settings: c.badge ?? {} };
  });
  const [newName, setNewName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [artMissing, setArtMissing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [artError, setArtError] = useState<string | null>(null);

  const collection = find(state);
  const badgeSettings = b.draft?.settings ?? null;
  const firstCredential = collection?.order
    .map((credSlug) => state?.credentials.find((c) => c.collectionSlug === slug && c.slug === credSlug))
    .find((c) => c !== undefined);
  const sample = firstCredential ? { slug: firstCredential.slug, name: firstCredential.name } : SAMPLE_CREDENTIAL;
  // The preview shows the collection's own settings, so the sample credential's override is left out.
  const previewCollection = useMemo<Collection | null>(() => {
    if (!collection || !badgeSettings) return null;
    const { [sample.slug]: _own, ...others } = collection.badgeOverrides ?? {};
    return { ...collection, badge: badgeSettings, badgeOverrides: others };
  }, [collection, badgeSettings, sample.slug]);
  const ringHues = useRingHues(previewCollection, sample.slug);
  const allCollections = (
    <button type="button" className="link back" onClick={() => navigate({ view: "collections" })}>
      All collections
    </button>
  );
  if (!state || !collection || d.draft === null || badgeSettings === null || previewCollection === null) {
    return (
      <section className="stack">
        {allCollections}
        <p className="muted">This collection is not in the folder. It may have been moved or deleted outside the app.</p>
      </section>
    );
  }
  const draft = d.draft;
  const credentials = state.credentials.filter((c) => c.collectionSlug === slug);
  const nameOf = (credSlug: string) => credentials.find((c) => c.slug === credSlug)?.name;

  // Every app write to collection.json touches only its own fields. Another draft on the
  // file may save on top of it, but only when the file matched that draft's base before
  // the write. Otherwise an outside edit is pending, and rebasing would hide it and let
  // the next save overwrite it (KTD6).
  const rebaseIfUnchanged = (before: string | null, next: FolderState, writer?: DraftWithBase<unknown>) => {
    for (const other of [d, b] as DraftWithBase<unknown>[]) {
      if (other !== writer && before === other.base) other.rebase(next);
    }
  };

  /** Runs a draft's save and rebases the other drafts on this screen. */
  const saveAndRebase = async <T,>(draft: DraftWithBase<T>, run: (dr: T, base: string | null, s: FolderState) => Promise<FolderState>) => {
    let before: string | null = null;
    let after: FolderState | null = null;
    const ok = await draft.save(async (dr, base, s) => {
      before = s.raw[path] ?? null;
      after = await run(dr, base, s);
      return after;
    });
    if (ok && after) rebaseIfUnchanged(before, after, draft as DraftWithBase<unknown>);
  };

  const move = async (i: number, by: -1 | 1) => {
    const order = [...collection.order];
    [order[i], order[i + by]] = [order[i + by], order[i]];
    setActionError(null);
    try {
      const before = state.raw[path] ?? null;
      const next = await reorderCredentials(storage, state, slug, order, before);
      apply(next);
      rebaseIfUnchanged(before, next);
    } catch (err) {
      setActionError(describeError(err));
    }
  };

  const onAddCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newName.trim() === "") return;
    setActionError(null);
    try {
      const before = state.raw[path] ?? null;
      const result = await createCredential(storage, state, slug, newName);
      apply(result.state);
      rebaseIfUnchanged(before, result.state);
      setNewName("");
      navigate({ view: "collections", collectionSlug: slug, credentialKey: result.key });
    } catch (err) {
      setActionError(describeError(err));
    }
  };

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.name.trim() === "") {
      d.setError("Give the collection a name before saving.");
      return;
    }
    void saveAndRebase(d, async (dr, base, s) => {
      const stored = find(s);
      if (!stored) throw new Error("This collection is not in the folder.");
      return updateCollection(storage, s, { ...stored, name: dr.name.trim(), description: dr.description }, base);
    });
  };

  const onSaveBadge = (e: React.FormEvent) => {
    e.preventDefault();
    void saveAndRebase(b, (dr, base, s) => {
      const clean = cleanSettings(dr.settings);
      return updateCollectionBadge(storage, s, slug, isEmptySettings(clean) ? undefined : clean, base);
    });
  };

  const onPickArt = async () => {
    setPicking(true);
    setArtError(null);
    try {
      // Copies the file only. The setting is written by Save.
      const art = await importBadgeArt(storage, slug, null);
      if (art !== null) b.edit({ settings: { ...badgeSettings, art } });
    } catch (err) {
      setArtError(describeError(err));
    } finally {
      setPicking(false);
    }
  };

  const overriders = b.dirty ? credentialsOverriding(collection, badgeSettings, nameOf) : [];

  return (
    <section className="stack">
      {allCollections}
      <PageHeader
        kicker="Collection"
        title={collection.name}
        actions={
          <button type="button" onClick={() => setShowExport(true)}>
            Export
          </button>
        }
      />
      {showExport && <ExportDialog collectionSlug={slug} onClose={() => setShowExport(false)} />}

      <h2>Credentials</h2>
      {collection.order.length === 0 ? (
        <p className="muted">No credentials yet. Add one below, then give it learning targets and an assignment.</p>
      ) : (
        <ol className="item-list" aria-label="Credentials">
          {collection.order.map((credSlug, i) => {
            const name = nameOf(credSlug);
            const label = name ?? credSlug;
            return (
              <li key={credSlug} className="row">
                {name !== undefined ? (
                  <Badge collection={collection} credential={{ slug: credSlug, name }} size={64} className="badge-thumb" />
                ) : (
                  <span className="badge-placeholder badge-thumb" style={{ width: 64, height: 64 }} aria-hidden="true" />
                )}
                {name !== undefined ? (
                  <button
                    type="button"
                    className="item"
                    onClick={() => navigate({ view: "collections", collectionSlug: slug, credentialKey: credentialKey({ collectionSlug: slug, slug: credSlug }) })}
                  >
                    {name}
                  </button>
                ) : (
                  <span className="item muted">{credSlug} (file missing)</span>
                )}
                <button type="button" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => void move(i, -1)}>
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${label} down`}
                  disabled={i === collection.order.length - 1}
                  onClick={() => void move(i, 1)}
                >
                  ↓
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <form className="inline-form" onSubmit={onAddCredential}>
        <label className="field">
          <span>New credential name</span>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
        <button type="submit" disabled={newName.trim() === ""}>
          Add credential
        </button>
      </form>
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}

      <h2>About this collection</h2>
      <EditorStatus d={d} />
      <form onSubmit={onSave}>
        <label className="field">
          <span>Collection name</span>
          <input value={draft.name} onChange={(e) => d.edit({ ...draft, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea rows={3} value={draft.description} onChange={(e) => d.edit({ ...draft, description: e.target.value })} />
        </label>
        <SaveBar d={d} label="Save collection" />
      </form>

      <section className="badge-section" aria-label="Badge">
        <h2>Badge</h2>
        <p className="muted">These settings apply to every credential in the collection. A credential can set its own in its editor.</p>
        <EditorStatus d={b} />
        <div className="badge-layout">
          <div className="badge-preview">
            <Badge collection={previewCollection} credential={sample} size={200} onArtMissing={setArtMissing} />
          </div>
          <form onSubmit={onSaveBadge}>
            <BadgeControls
              mode="collection"
              collectionSettings={badgeSettings}
              value={badgeSettings}
              onChange={(next) => b.edit({ settings: next })}
              ringHues={ringHues}
              titleDefaults={{ main: "Credential name", eyebrow: collection.name }}
              onPickArt={() => void onPickArt()}
              pickingArt={picking}
              artError={artError}
              artMissing={artMissing}
            />
            {overriders.length > 0 && (
              <p className="badge-note">
                {overriders.length === 1 ? "This credential sets its own value for what you changed, and keeps it: " : "These credentials set their own value for what you changed, and keep it: "}
                {overriders.join(", ")}.
              </p>
            )}
            <SaveBar d={b} label="Save badge settings" variant="ink">
              <button type="button" onClick={b.revert} disabled={!b.dirty}>
                Revert badge settings
              </button>
            </SaveBar>
          </form>
        </div>
      </section>
    </section>
  );
}

const SAMPLE_CREDENTIAL = { slug: "sample", name: "Sample credential" };

/** Names of credentials whose overrides set a field the collection draft changes. */
function credentialsOverriding(collection: Collection, draft: BadgeSettings, nameOf: (slug: string) => string | undefined): string[] {
  const saved = collection.badge ?? {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const colors = !same(saved.palette, draft.palette) || !same(saved.colors, draft.colors);
  const art = !same(saved.art, draft.art);
  const main = !same(saved.title?.main, draft.title?.main);
  const eyebrow = !same(saved.title?.eyebrow, draft.title?.eyebrow);
  return collection.order.flatMap((credSlug) => {
    const o = collection.badgeOverrides?.[credSlug];
    if (!o) return [];
    const touches =
      (colors && (o.palette !== undefined || o.colors !== undefined)) ||
      (art && o.art !== undefined) ||
      (main && !!o.title?.main) ||
      (eyebrow && !!o.title?.eyebrow);
    return touches ? [nameOf(credSlug) ?? credSlug] : [];
  });
}
