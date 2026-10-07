// Create a credential (U3, R9-R12, R20): where to start, then three beats of your own or
// one card for a preset, then its badge. Your own takes its learning targets as lines, one
// added on each Enter, as the badge's own targets part does. Nothing is written until "Make the badge". The
// credential lands by the collections plan's KTD4: "My credentials", else the folder's one
// collection of your own, else a new "My credentials". Opened for a collection, it goes there,
// and shows Not in the folder once that collection is gone. Opened from a test that is missing
// its credential, it hands the new one straight back to that test (AE2).
//
// The task card is a pane (U6 of the deep-work panes plan, R7, R18): the editor fills the
// window and takes first focus, and once a task is written the deck holds unsaved work,
// so Escape steps back a card but never leaves the deck (R19, R20, KTD8).
//
// Made from a job the router matched to no badge (router R12, KTD14), it starts on your own
// with the job as the task, leaves out "Where to start", whose presets would drop the job,
// and counts the job as unsaved from the start. Leaving goes back to the router's card.

import { useRef, useState } from "react";
import { credentialPath, credentialsDir, loadFolder } from "../domain/folder";
import { DEFAULT_COLLECTION_NAME, createCredential, createPresetCredential, ensureLandingCollection, landingCollection, updateCredential } from "../domain/operations";
import { PRESETS, findPreset, presetCredential } from "../domain/presets";
import { suggestAssignmentsPrompt } from "../domain/prompts";
import { appendToRubric } from "../domain/target-check";
import { credentialKey, parseCredentialKey, type Collection, type Credential, type Slug } from "../domain/types";
import { Cartridge } from "../cast/Cartridge";
import { Outline } from "../cast/Outline";
import { Badge } from "./Badge";
import { Deck, type Beat } from "./Deck";
import { useNav } from "./nav";
import type { FromJob, TestPick } from "./routes";
import { useRichDraft } from "./richDraft";
import { Lines } from "./EditDecks";
import { CopyHelper, Field, Missing, focusOnMount } from "./shared";
import { RichText } from "./RichText";
import { useFolder } from "./useFolderState";
import { useRichImages } from "./useRichImages";

/** The "Where to start" answer: your own, or a preset's id. */
const OWN = "own";

export function CredentialDeck({ returnTo, fromJob, collectionSlug }: { returnTo?: TestPick; fromJob?: FromJob; collectionSlug?: Slug }) {
  const { storage, state, apply } = useFolder();
  const { navigate } = useNav();
  const fromRouter = fromJob !== undefined;
  const [start, setStart] = useState<string | null>(fromRouter ? OWN : null);
  const [name, setName] = useState("");
  // The targets added so far, and the line being typed, which counts as the last one.
  const [targets, setTargets] = useState<string[]>([]);
  const [line, setLine] = useState("");
  const allTargets = line.trim() ? [...targets, line.trim()] : targets;
  const taskDraft = useRichDraft(fromJob?.task ?? "");
  const task = taskDraft.value;
  // Detail the target check moved out of a target. There is no rubric card here, so it waits.
  const [rubric, setRubric] = useState("");
  const [made, setMade] = useState<string | null>(null);
  // Set once the credential file exists, so a retry after a failed second save never makes a second one.
  const created = useRef<string | null>(null);

  // The collection asked for, looked up again on every render because the folder reloads on
  // focus. Without one, a preset lands where your own would (KTD4), or in the My credentials
  // make() will create.
  const asked = collectionSlug === undefined ? undefined : state?.collections.find((c) => c.slug === collectionSlug);
  const landing: Collection = asked ?? (state && landingCollection(state)) ?? { slug: "my-credentials", name: DEFAULT_COLLECTION_NAME, description: "", order: [], codes: {} };
  // A pasted image goes where the credential will: the same rule make() follows.
  const taskImages = useRichImages(credentialsDir(landing.slug), task);
  const preset = start === null ? undefined : findPreset(start);
  const picked = preset ? presetCredential(preset, landing.slug) : null;

  const draft: Credential = picked ?? {
    slug: "",
    collectionSlug: "",
    name: name.trim(),
    learningTargets: allTargets,
    task,
    rubric,
    extraSections: [],
  };

  async function make({ keepMine }: { keepMine: boolean }) {
    if (!state) return;
    let current = keepMine ? await loadFolder(storage) : state;
    if (preset) {
      // A preset is written whole in one save, so a failed try leaves no badge to retry around.
      const result = await createPresetCredential(storage, current, preset.id, collectionSlug);
      apply(result.state);
      return landed(result.key);
    }
    let key = created.current;
    if (key === null) {
      let target = collectionSlug;
      if (target === undefined) {
        const land = await ensureLandingCollection(storage, current);
        current = land.state;
        target = land.slug;
      }
      const result = await createCredential(storage, current, target, draft.name);
      current = result.state;
      key = result.key;
      created.current = key;
      apply(current);
    }
    const { collectionSlug: madeIn, slug } = parseCredentialKey(key);
    const stored = current.credentials.find((c) => credentialKey(c) === key);
    if (!stored) throw new Error("The new credential could not be read back.");
    const base = current.raw[credentialPath(madeIn, slug)] ?? null;
    const filled: Credential = { ...stored, learningTargets: draft.learningTargets, task: task.trim(), rubric: rubric.trim() };
    const next = await updateCredential(storage, filled, base);
    apply(next);
    landed(key);
  }

  /** A made badge goes straight back to the test that asked for it, or shows itself. */
  function landed(key: string) {
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

  if (collectionSlug !== undefined && state && !asked) return <Missing onHome={() => navigate({ view: "home" })} />;

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

  const ownBeats: Beat[] = [
    {
      id: "name",
      title: "What is it called",
      forward: "Next",
      valid: name.trim() !== "",
      settled: name.trim(),
      body: (
        <Field>
          <input aria-label="Name" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </Field>
      ),
    },
    {
      id: "targets",
      title: "What its holder can do",
      forward: "Next",
      valid: allTargets.length > 0,
      // A pane keeps its trail to one line, so several targets settle as their count.
      settled: allTargets.length > 1 ? `${allTargets.length} learning targets` : allTargets[0],
      body: (
        <Lines
          lines={targets}
          onChange={setTargets}
          line={line}
          onLine={setLine}
          label="Learning targets"
          placeholder="I can…"
          onMove={(rubricLine) => setRubric((r) => appendToRubric(r, rubricLine))}
        />
      ),
    },
    {
      id: "task",
      title: "The task",
      forward: "Make the badge",
      valid: task.trim() !== "" && !taskImages.busy,
      pane: true,
      focusBody: true,
      body: (
        <>
          <RichText aria-label="Task" value={task} onChange={taskDraft.setValue} onNormalized={taskDraft.onNormalized} placeholder="What the agent is asked to do" images={taskImages.images} />
          <CopyHelper label="Suggest a task" text={() => suggestAssignmentsPrompt(draft)} />
        </>
      ),
    },
  ];

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
    : fromRouter
      ? ownBeats
      : [where, ...ownBeats];

  // A task written for your own credential is the work Escape must not lose; a preset has no
  // task card. A job brought from the router is that work from the start, and leaving takes
  // it back to the router's card.
  const unsaved = picked === null && (taskDraft.changed || (fromRouter && task.trim() !== ""));
  const leave = () => navigate(fromJob ? { view: "deck", deck: "router", resume: fromJob.router } : { view: "home" });
  return <Deck label="Create a credential" beats={beats} unsaved={unsaved} onClose={leave} onFinish={make} />;
}
