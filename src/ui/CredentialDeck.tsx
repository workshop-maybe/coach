// Create a credential (U3, R9-R12, R20): where to start, then three beats of your own or
// one card for a preset, then its badge. Nothing is written until "Make the badge". The
// credential goes into the folder's first collection, or a new "My credentials" when
// there is none (KTD6). Opened from a test that is missing its credential, it hands the
// new one straight back to that test (AE2).

import { useRef, useState } from "react";
import { credentialPath, loadFolder } from "../domain/folder";
import { createCollection, createCredential, updateCredential } from "../domain/operations";
import { PRESETS, presetCredential } from "../domain/presets";
import { suggestAssignmentsPrompt } from "../domain/prompts";
import { credentialKey, parseCredentialKey, type Collection, type Credential } from "../domain/types";
import { Cartridge } from "../cast/Cartridge";
import { Outline } from "../cast/Outline";
import { Badge } from "./Badge";
import { Deck, type Beat } from "./Deck";
import { useNav } from "./nav";
import type { TestPick } from "./routes";
import { CopyHelper, focusOnMount } from "./shared";
import { RichText } from "./RichText";
import { useFolder } from "./useFolderState";

export const DEFAULT_COLLECTION_NAME = "My credentials";

/** The "Where to start" answer: your own, or a preset's id. */
const OWN = "own";

export function CredentialDeck({ returnTo }: { returnTo?: TestPick }) {
  const { storage, state, apply } = useFolder();
  const { navigate } = useNav();
  const [start, setStart] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [task, setTask] = useState("");
  const [made, setMade] = useState<string | null>(null);
  // Set once the credential file exists, so a retry after a failed second save never makes a second one.
  const created = useRef<string | null>(null);

  // A preset lands where your own would: the first collection, or a new My credentials.
  const landing: Collection = state?.collections[0] ?? { slug: "my-credentials", name: DEFAULT_COLLECTION_NAME, description: "", order: [], codes: {} };
  const preset = PRESETS.find((p) => p.id === start);
  const picked = preset ? presetCredential(preset, landing.slug) : null;

  const draft: Credential = picked ?? {
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
      const result = await createCredential(storage, current, collectionSlug, draft.name);
      current = result.state;
      key = result.key;
      created.current = key;
      apply(current);
    }
    const { collectionSlug, slug } = parseCredentialKey(key);
    const stored = current.credentials.find((c) => credentialKey(c) === key);
    if (!stored) throw new Error("The new credential could not be read back.");
    const base = current.raw[credentialPath(collectionSlug, slug)] ?? null;
    const filled: Credential = picked
      ? { ...stored, learningTargets: picked.learningTargets, task: picked.task, rubric: picked.rubric, extraSections: picked.extraSections }
      : { ...stored, learningTargets: draft.learningTargets, task: task.trim() };
    const next = await updateCredential(storage, filled, base);
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
            {credential?.name ?? draft.name}
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

  // The deck stays mounted when the answer here changes, so the beats after it swap in place.
  const where: Beat = {
    id: "start",
    title: "Where to start",
    body: ({ advance }) => (
      <ul className="choices choices-badges">
        <li>
          <button
            type="button"
            className="choice choice-door"
            aria-pressed={start === OWN}
            onClick={() => {
              setStart(OWN);
              advance();
            }}
          >
            <Outline kind="cartridge" width={40} />
            <span className="choice-name">Build your own</span>
          </button>
        </li>
        {PRESETS.map((p) => {
          const c = presetCredential(p, landing.slug);
          return (
            <li key={p.id}>
              <button
                type="button"
                className="choice"
                aria-pressed={start === p.id}
                onClick={() => {
                  setStart(p.id);
                  advance();
                }}
              >
                <Cartridge collection={landing} credential={c} width={48} />
                <span className="choice-name">{c.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    ),
  };

  const beats: Beat[] = picked
    ? [
        where,
        {
          id: "preset",
          title: picked.name,
          forward: "Make the badge",
          body: (
            <ol className="preset-targets" aria-label="Learning targets">
              {picked.learningTargets.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          ),
        },
      ]
    : [
        where,
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
