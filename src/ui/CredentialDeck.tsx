// Create a credential (U3, R9-R12, R20): three beats, then its badge. Nothing is written
// until "Make the badge". The credential goes into the folder's first collection, or a
// new "My credentials" when there is none (KTD6). Opened from a test that is missing its
// credential, it hands the new one straight back to that test (AE2).

import { useRef, useState } from "react";
import { credentialPath, loadFolder } from "../domain/folder";
import { createCollection, createCredential, updateCredential } from "../domain/operations";
import { suggestAssignmentsPrompt } from "../domain/prompts";
import { credentialKey, parseCredentialKey, type Credential } from "../domain/types";
import { Badge } from "./Badge";
import { Deck, type Beat } from "./Deck";
import { useNav } from "./nav";
import type { TestPick } from "./routes";
import { CopyHelper, focusOnMount } from "./shared";
import { RichText } from "./RichText";
import { useFolder } from "./useFolderState";

export const DEFAULT_COLLECTION_NAME = "My credentials";

export function CredentialDeck({ returnTo }: { returnTo?: TestPick }) {
  const { storage, state, apply } = useFolder();
  const { navigate } = useNav();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [task, setTask] = useState("");
  const [made, setMade] = useState<string | null>(null);
  // Set once the credential file exists, so a retry after a failed second save never makes a second one.
  const created = useRef<string | null>(null);

  const draft: Credential = {
    slug: "",
    collectionSlug: "",
    name: name.trim(),
    learningTargets: target.trim() ? [target.trim()] : [],
    task,
    rubric: "",
    extraSections: [],
  };

  async function make({ keepMine }: { keepMine: boolean }) {
    if (!state) return;
    let current = keepMine ? await loadFolder(storage) : state;
    let key = created.current;
    if (key === null) {
      let collectionSlug = current.collections[0]?.slug;
      if (!collectionSlug) {
        const col = await createCollection(storage, current, DEFAULT_COLLECTION_NAME);
        current = col.state;
        collectionSlug = col.slug;
      }
      const result = await createCredential(storage, current, collectionSlug, name);
      current = result.state;
      key = result.key;
      created.current = key;
      apply(current);
    }
    const { collectionSlug, slug } = parseCredentialKey(key);
    const stored = current.credentials.find((c) => credentialKey(c) === key);
    if (!stored) throw new Error("The new credential could not be read back.");
    const base = current.raw[credentialPath(collectionSlug, slug)] ?? null;
    const next = await updateCredential(storage, { ...stored, learningTargets: draft.learningTargets, task: task.trim() }, base);
    apply(next);
    if (returnTo?.profileSlug) navigate({ view: "deck", deck: "test", profileSlug: returnTo.profileSlug, credentialKey: key });
    else setMade(key);
  }

  if (made && state) {
    const credential = state.credentials.find((c) => credentialKey(c) === made);
    const collection = state.collections.find((c) => c.slug === credential?.collectionSlug);
    return (
      <section className="deck" aria-label="Create a credential">
        <button type="button" className="deck-close ghost" aria-label="Close" onClick={() => navigate({ view: "home" })}>
          ×
        </button>
        <div className="deck-card made-badge">
          <h2 tabIndex={-1} ref={focusOnMount}>
            {credential?.name ?? name}
          </h2>
          {credential && collection && <Badge collection={collection} credential={credential} size={180} className="made-badge-art" />}
          <div className="deck-actions">
            <button type="button" className="primary" onClick={() => navigate({ view: "deck", deck: "test", credentialKey: made })}>
              Test it on an agent
            </button>
          </div>
        </div>
      </section>
    );
  }

  const beats: Beat[] = [
    {
      id: "name",
      title: "What is it called",
      forward: "Next",
      valid: name.trim() !== "",
      settled: name.trim(),
      body: <input aria-label="Name" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />,
    },
    {
      id: "target",
      title: "One thing its holder can do",
      forward: "Next",
      valid: target.trim() !== "",
      settled: target.trim(),
      body: <input aria-label="Learning target" value={target} autoComplete="off" placeholder="I can…" onChange={(e) => setTarget(e.target.value)} />,
    },
    {
      id: "task",
      title: "The task",
      forward: "Make the badge",
      valid: task.trim() !== "",
      body: (
        <>
          <RichText aria-label="Task" value={task} onChange={setTask} placeholder="What the agent is asked to do" />
          <CopyHelper label="Suggest a task" text={() => suggestAssignmentsPrompt(draft)} />
        </>
      ),
    },
  ];

  return <Deck label="Create a credential" beats={beats} onClose={() => navigate({ view: "home" })} onFinish={make} />;
}
