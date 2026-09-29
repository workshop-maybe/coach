// Agent profiles (R5): the list, a new agent, and the selected profile's editor.

import { useState } from "react";
import { useNav } from "./AppShell";
import { BLANK_PROFILE, NewProfileEditor, ProfileEditor, type ProfileFields } from "./ProfileEditor";
import { useFolder } from "./useFolderState";

export function ProfilesView() {
  const { state } = useFolder();
  const { route, navigate } = useNav();
  // An unsaved new or duplicated profile. It lives only here until saved.
  const [draft, setDraft] = useState<{ id: number; fields: ProfileFields } | null>(null);
  if (route.view !== "agents" || state === null) return null;
  const selected = route.profileSlug;
  const openDraft = (fields: ProfileFields) => setDraft({ id: Date.now(), fields });

  return (
    <div className="stack">
      <div className="editor-head">
        <h1>Agents</h1>
        <button type="button" onClick={() => openDraft(BLANK_PROFILE)}>
          New agent
        </button>
      </div>
      {state.profiles.length === 0 ? (
        <p className="muted">No agents yet. Add each agent setup you run: its harness, model, effort and the repo it works in.</p>
      ) : (
        <ul className="item-list" aria-label="Agents">
          {state.profiles.map((p) => (
            <li key={p.slug}>
              <button
                type="button"
                className="item"
                aria-current={!draft && p.slug === selected ? "true" : undefined}
                onClick={() => {
                  setDraft(null);
                  navigate({ view: "agents", profileSlug: p.slug });
                }}
              >
                <span className="item-name">{p.name}</span>
                <span className="muted">{[p.harness, p.model, p.effort].map((s) => s || "not set").join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {draft ? (
        <NewProfileEditor
          key={draft.id}
          initial={draft.fields}
          onCancel={() => setDraft(null)}
          onCreated={(slug) => {
            setDraft(null);
            navigate({ view: "agents", profileSlug: slug });
          }}
        />
      ) : (
        selected && <ProfileEditor key={selected} profileSlug={selected} onDuplicate={openDraft} />
      )}
    </div>
  );
}
