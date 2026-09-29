// Edits one credential: name, learning targets, task and rubric (R2-R4, F1).
// The draft and the file text it opened with live here, so a folder reload never
// resets them (KTD6). Saves are explicit and refused when the file changed on disk.

import { useId, useMemo, useState } from "react";
import { pickExportFolder } from "./exportFolder";
import { renderBadgeFor } from "../badge/resolve";
import type { BadgeSettings } from "../badge/settings";
import { collectionPath, credentialPath } from "../domain/folder";
import { importBadgeArt, setCredentialBadgeOverride, updateCredential } from "../domain/operations";
import { parseCredentialKey, type Collection, type Credential, type FolderState, type Slug } from "../domain/types";
import { Badge } from "./Badge";
import { BadgeControls, cleanSettings, isEmptySettings, useRingHues } from "./BadgeControls";
import { PromptPanel } from "./PromptPanel";
import { EditorStatus, SaveBar, useDraftWithBase } from "./useDraftWithBase";
import { describeError, useFolder } from "./useFolderState";

type CredentialDraft = Pick<Credential, "name" | "learningTargets" | "task" | "rubric">;

export interface CredentialEditorProps {
  /** `collection/slug`. Key the editor by it so another credential gets a fresh draft. */
  credentialKey: string;
}

export function CredentialEditor({ credentialKey }: CredentialEditorProps) {
  const { storage } = useFolder();
  const { collectionSlug, slug } = parseCredentialKey(credentialKey);
  const path = credentialPath(collectionSlug, slug);
  const find = (s: FolderState) => s.credentials.find((c) => c.collectionSlug === collectionSlug && c.slug === slug) ?? null;
  const d = useDraftWithBase<CredentialDraft>(path, (s) => {
    const c = find(s);
    return c && { name: c.name, learningTargets: [...c.learningTargets], task: c.task, rubric: c.rubric };
  });
  const taskHint = useId();
  const [showPrompts, setShowPrompts] = useState(false);

  if (d.draft === null) {
    return (
      <section className="editor">
        <EditorStatus d={d} />
        <p className="muted">This credential is not in the folder. It may have been moved or deleted outside the app.</p>
      </section>
    );
  }
  const draft = d.draft;
  const set = (patch: Partial<CredentialDraft>) => d.edit({ ...draft, ...patch });
  const targets = draft.learningTargets;
  const setTarget = (i: number, text: string) => set({ learningTargets: targets.map((t, j) => (j === i ? text : t)) });
  const moveTarget = (i: number, by: -1 | 1) => {
    const next = [...targets];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    set({ learningTargets: next });
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.name.trim() === "") {
      d.setError("Give the credential a name before saving.");
      return;
    }
    void d.save(async (dr, base, s) => {
      // Slug, collection and any hand-added sections come from the stored credential.
      const stored = find(s);
      if (!stored) throw new Error("This credential is not in the folder.");
      return updateCredential(storage, { ...stored, ...dr, learningTargets: dr.learningTargets.map((t) => t.trim()).filter((t) => t !== "") }, base);
    });
  };

  return (
    <section className="editor" aria-label={`Credential ${draft.name || slug}`}>
      <div className="editor-head">
        <h2>{draft.name.trim() || "Untitled credential"}</h2>
        <button type="button" onClick={() => setShowPrompts(true)}>
          Prompts
        </button>
      </div>
      {showPrompts && <PromptPanel credentialKey={credentialKey} onClose={() => setShowPrompts(false)} />}
      <EditorStatus d={d} />
      <form onSubmit={onSubmit}>
        <label className="field">
          <span>Credential name</span>
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </label>

        <fieldset className="field">
          <legend>Learning targets</legend>
          {targets.length === 0 ? (
            <p className="muted">No learning targets yet. Add what someone who holds this credential can do.</p>
          ) : (
            <ol className="rows">
              {targets.map((t, i) => (
                <li key={i} className="row">
                  <input
                    aria-label={`Learning target ${i + 1}`}
                    value={t}
                    placeholder="I can…"
                    onChange={(e) => setTarget(i, e.target.value)}
                  />
                  <button type="button" aria-label={`Move learning target ${i + 1} up`} disabled={i === 0} onClick={() => moveTarget(i, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move learning target ${i + 1} down`}
                    disabled={i === targets.length - 1}
                    onClick={() => moveTarget(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove learning target ${i + 1}`}
                    onClick={() => set({ learningTargets: targets.filter((_, j) => j !== i) })}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ol>
          )}
          <button type="button" onClick={() => set({ learningTargets: [...targets, ""] })}>
            Add learning target
          </button>
        </fieldset>

        <div className="field">
          <label htmlFor={`${taskHint}-task`}>Task</label>
          <span className="field-hint" id={taskHint}>
            What the agent is asked to do. It goes into the test prompt.
          </span>
          <textarea
            id={`${taskHint}-task`}
            rows={6}
            aria-describedby={taskHint}
            value={draft.task}
            onChange={(e) => set({ task: e.target.value })}
          />
        </div>

        <label className="field">
          <span>Rubric</span>
          <span className="field-hint">Only you see this</span>
          <textarea rows={6} value={draft.rubric} onChange={(e) => set({ rubric: e.target.value })} />
        </label>

        <SaveBar d={d} />
      </form>

      <CredentialBadge collectionSlug={collectionSlug} slug={slug} name={draft.name.trim() || slug} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Badge section: its own draft on collection.json, with its own Save and Revert,
// separate from the credential text draft (U5).

interface BadgeDraft {
  settings: BadgeSettings;
}

function CredentialBadge({ collectionSlug, slug, name }: { collectionSlug: Slug; slug: Slug; name: string }) {
  const { state, storage } = useFolder();
  const path = collectionPath(collectionSlug);
  const findCollection = (s: FolderState) => s.collections.find((c) => c.slug === collectionSlug) ?? null;
  const b = useDraftWithBase<BadgeDraft>(path, (s) => {
    const c = findCollection(s);
    return c && { settings: c.badgeOverrides?.[slug] ?? {} };
  });
  const [artMissing, setArtMissing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [artError, setArtError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportOutcome, setExportOutcome] = useState<{ error: boolean; message: string } | null>(null);

  const collection = state ? findCollection(state) : null;
  const settings = b.draft?.settings ?? null;
  // The preview renders from a draft copy of the collection carrying the unsaved override.
  const draftCollection = useMemo<Collection | null>(
    () => collection && settings && { ...collection, badgeOverrides: { ...(collection.badgeOverrides ?? {}), [slug]: settings } },
    [collection, settings, slug],
  );
  const ringHues = useRingHues(draftCollection, slug);

  if (!collection || !draftCollection || settings === null) return null;

  const onPickArt = async () => {
    setPicking(true);
    setArtError(null);
    try {
      // Copies the file only. The setting is written by Save.
      const art = await importBadgeArt(storage, collectionSlug, slug);
      if (art !== null) b.edit({ settings: { ...settings, art } });
    } catch (e) {
      setArtError(describeError(e));
    } finally {
      setPicking(false);
    }
  };

  const onSave = (e: React.FormEvent) => {
    e.preventDefault();
    void b.save((dr, base, s) => {
      const clean = cleanSettings(dr.settings);
      return setCredentialBadgeOverride(storage, s, collectionSlug, slug, isEmptySettings(clean) ? null : clean, base);
    });
  };

  const onSaveSvg = async () => {
    if (!state) return;
    setExporting(true);
    setExportOutcome(null);
    try {
      const folder = await pickExportFolder();
      if (!folder) return;
      const saved = state.credentials.find((c) => c.collectionSlug === collectionSlug && c.slug === slug);
      const file = `${slug}.svg`;
      const { svg, artMissing } = await renderBadgeFor(storage, collection, { slug, name: saved?.name ?? name });
      await storage.writeText("export", file, svg);
      setExportOutcome({
        error: false,
        message: `Saved ${file} to ${folder}.${artMissing ? " The art could not be read, so the badge was saved without it." : ""}`,
      });
    } catch (err) {
      setExportOutcome({ error: true, message: `Could not save the badge: ${describeError(err)}` });
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="badge-section" aria-label="Badge">
      <h3>Badge</h3>
      <EditorStatus d={b} />
      <div className="badge-layout">
        <div className="badge-preview">
          <Badge collection={draftCollection} credential={{ slug, name }} size={200} onArtMissing={setArtMissing} />
          <button type="button" onClick={() => void onSaveSvg()} disabled={b.dirty || exporting}>
            Save badge as SVG
          </button>
          {b.dirty && <span className="field-hint">Save or revert the badge first.</span>}
          {exportOutcome && (
            <p className={exportOutcome.error ? "form-error" : "muted"} role={exportOutcome.error ? "alert" : "status"}>
              {exportOutcome.message}
            </p>
          )}
        </div>
        <form onSubmit={onSave}>
          <BadgeControls
            mode="credential"
            collectionSettings={collection.badge ?? {}}
            value={settings}
            onChange={(next) => b.edit({ settings: next })}
            ringHues={ringHues}
            titleDefaults={{ main: name, eyebrow: collection.name }}
            onPickArt={() => void onPickArt()}
            pickingArt={picking}
            artError={artError}
            artMissing={artMissing}
          />
          <SaveBar d={b} label="Save badge">
            <button type="button" onClick={b.revert} disabled={!b.dirty}>
              Revert badge
            </button>
          </SaveBar>
        </form>
      </div>
    </section>
  );
}
