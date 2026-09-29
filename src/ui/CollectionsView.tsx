// Collections and their credentials (R1, F1): create and rename collections, add and
// reorder credentials, open a credential's editor, and export a collection.

import { useState } from "react";
import { collectionPath } from "../domain/folder";
import { createCollection, createCredential, reorderCredentials, updateCollection } from "../domain/operations";
import { credentialKey, type Collection, type FolderState } from "../domain/types";
import { useNav } from "./AppShell";
import { CredentialEditor } from "./CredentialEditor";
import { EditorStatus, SaveBar, useDraftWithBase } from "./useDraftWithBase";
import { ExportDialog } from "./ExportDialog";
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
      <h1>Collections</h1>
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
  const [newName, setNewName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);

  const collection = find(state);
  const allCollections = (
    <button type="button" className="link back" onClick={() => navigate({ view: "collections" })}>
      All collections
    </button>
  );
  if (!state || !collection || d.draft === null) {
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

  // The app wrote only the order. A name edit in progress may save on top of it, but only
  // when the file matched the editor's base before that write. Otherwise an outside edit
  // is pending, and rebasing would hide it and let the next save overwrite it (KTD6).
  const rebaseIfUnchanged = (before: string | null, next: FolderState) => {
    if (before === d.base) d.rebase(next);
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
    void d.save(async (dr, base, s) => {
      const stored = find(s);
      if (!stored) throw new Error("This collection is not in the folder.");
      return updateCollection(storage, s, { ...stored, name: dr.name.trim(), description: dr.description }, base);
    });
  };

  return (
    <section className="stack">
      {allCollections}
      <div className="editor-head">
        <h1>{collection.name}</h1>
        <button type="button" onClick={() => setShowExport(true)}>
          Export
        </button>
      </div>
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
    </section>
  );
}
