// One-beat edits (R4, U6, U7). Opening a part of a badge or an agent runs a deck for that
// one part: a credential's name, learning targets, task, rubric or look, an agent's
// name, repo, notes or parameters, and a collection's name (collections plan U6). The file text each card opened with is the base of its
// save, so a file changed on disk meanwhile turns into the deck's conflict card (KTD2, KTD3).
// A task or rubric change on a badge with holders warns first that they will re-test (R18),
// including detail the targets card moves from a target into the rubric.
//
// Writing the bar happens in panes (U6 of the deep-work panes plan, R7, R18): the task,
// rubric and notes cards fill the window with focus in the editor, and while their text
// has changed the deck holds unsaved work, so Escape never throws it away (R19, R20, KTD8).
// The re-test warning stays an ordinary card under that same signal.

import { useState } from "react";
import type { KeyboardEvent } from "react";
import { PALETTES } from "../badge/palettes";
import type { BadgeSettings, BadgeTitle } from "../badge/settings";
import { collectionPath, credentialPath, credentialsDir, loadFolder, profilePath } from "../domain/folder";
import { folderOf } from "../domain/images";
import { cellKey, type Matrix } from "../domain/matrix";
import { collectionAsOnDisk, importBadgeArt, setCredentialBadgeOverride, updateCollection, updateCredential, updateProfile } from "../domain/operations";
import { checkCriteriaPrompt, refinePrompt, reviewAssignmentPrompt, suggestAssignmentsPrompt } from "../domain/prompts";
import { appendToRubric } from "../domain/target-check";
import {
  credentialKey,
  parseCredentialKey,
  type AgentProfile,
  type Collection,
  type Credential,
  type FolderState,
  type Slug,
} from "../domain/types";
import { Machine } from "../cast/Machine";
import { Badge } from "./Badge";
import { Deck, type Beat } from "./Deck";
import { useNav } from "./nav";
import { useRichDraft } from "./richDraft";
import { RichText } from "./RichText";
import type { AgentPart, CollectionPart, CredentialPart } from "./routes";
import { CopyHelper, Field, LineMove, Missing, TargetHint, fileName, paletteName } from "./shared";
import { describeError, useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";
import { useRichImages } from "./useRichImages";

// ---------------------------------------------------------------------------
// Shared pieces

/** Agents whose matrix cell for a credential is met: its holders (R7). A flagged met still holds. */
export function holdersOf(matrix: Matrix, profiles: AgentProfile[], key: string): AgentProfile[] {
  return profiles.filter((p) => matrix.cells.get(cellKey(p.slug, key))?.status === "met");
}

/** Drops empty parts so an empty setting is stored as absent. */
function cleanSettings(s: BadgeSettings): BadgeSettings {
  const out: BadgeSettings = {};
  if (s.palette !== undefined) out.palette = s.palette;
  if (s.colors !== undefined) out.colors = { ...s.colors };
  if (s.art !== undefined) out.art = s.art;
  if (s.title !== undefined) {
    const title: BadgeTitle = {};
    if (s.title.main?.trim()) title.main = s.title.main.trim();
    if (s.title.eyebrow?.trim()) title.eyebrow = s.title.eyebrow.trim();
    if (Object.keys(title).length > 0) out.title = title;
  }
  return out;
}

/**
 * Lines added one at a time, each settling above the next (the cycle-deck idiom). Enter on
 * a line with text adds it; Enter on an empty line moves the deck on. With `onMove`, the
 * lines are learning targets and each offers to move its detail to the rubric.
 */
export function Lines({
  lines,
  onChange,
  line,
  onLine,
  label,
  placeholder,
  onMove,
}: {
  lines: string[];
  onChange(next: string[]): void;
  line: string;
  onLine(next: string): void;
  label: string;
  placeholder: string;
  onMove?(rubricLine: string): void;
}) {
  function add() {
    if (line.trim() === "") return;
    onChange([...lines, line.trim()]);
    onLine("");
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || line.trim() === "") return;
    e.preventDefault();
    add();
  }
  return (
    <>
      {lines.length > 0 && (
        <ol className="deck-settled edit-lines" aria-label={label}>
          {lines.map((t, i) => (
            <li key={`${i}:${t}`}>
              <span>{t}</span>
              {onMove && (
                <LineMove
                  text={t}
                  onMove={(m) => {
                    onChange(lines.map((x, j) => (j === i ? m.target : x)));
                    onMove(m.rubricLine);
                  }}
                />
              )}
              <button type="button" className="link edit-line-remove" aria-label={`Remove ${t}`} onClick={() => onChange(lines.filter((_, j) => j !== i))}>
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
      <Field>
        <input aria-label={`New ${label.toLowerCase().replace(/s$/, "")}`} value={line} autoComplete="off" placeholder={placeholder} onChange={(e) => onLine(e.target.value)} onKeyDown={onKeyDown} />
      </Field>
      {onMove && (
        <TargetHint
          text={line}
          onMove={(m) => {
            onLine(m.target);
            onMove(m.rubricLine);
          }}
        />
      )}
      <p className="helper">
        <button type="button" className="link" onClick={add} disabled={line.trim() === ""}>
          Add another
        </button>
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// A credential's parts (U6)

export interface EditCredentialDeckProps {
  credentialKey: string;
  part: CredentialPart;
}

export function EditCredentialDeck(props: EditCredentialDeckProps) {
  const { state } = useFolder();
  const { navigate } = useNav();
  // The card waits for the matrix too, so its holders are known before the task can change.
  const matrix = useMatrix(state);
  if (!state) return null;
  const credential = state.credentials.find((c) => credentialKey(c) === props.credentialKey);
  const collection = state.collections.find((c) => c.slug === credential?.collectionSlug);
  if (!credential || !collection) return <Missing onHome={() => navigate({ view: "home" })} />;
  if (!matrix) return null;
  return <EditCredential {...props} credential={credential} collection={collection} state={state} matrix={matrix} />;
}

interface Opened {
  credential: Credential;
  collection: Collection;
  state: FolderState;
  matrix: Matrix;
}

function EditCredential({ credentialKey: key, part, credential: atOpen, collection: collectionAtOpen, state: stateAtOpen, matrix: matrixAtOpen }: EditCredentialDeckProps & Opened) {
  const { storage, state, apply, reload } = useFolder();
  const { navigate } = useNav();
  const { collectionSlug, slug } = parseCredentialKey(key);
  const credPath = credentialPath(collectionSlug, slug);
  const colPath = collectionPath(collectionSlug);
  // The card edits what was on disk when it opened; saves are checked against these texts.
  const [opened] = useState(() => ({
    credential: atOpen,
    collection: collectionAtOpen,
    credBase: stateAtOpen.raw[credPath] ?? null,
    colBase: stateAtOpen.raw[colPath] ?? null,
    holders: holdersOf(matrixAtOpen, stateAtOpen.profiles, key),
  }));
  const c = opened.credential;

  const [name, setName] = useState(c.name);
  const [targets, setTargets] = useState(() => c.learningTargets.filter((t) => t.trim() !== ""));
  const [line, setLine] = useState("");
  // Detail moved out of a target, appended to the rubric as it is when the card saves.
  const [moved, setMoved] = useState<string[]>([]);
  const taskDraft = useRichDraft(c.task);
  const rubricDraft = useRichDraft(c.rubric);
  const task = taskDraft.value;
  const rubric = rubricDraft.value;
  // Pasted images go beside the credential's file.
  const taskImages = useRichImages(credentialsDir(collectionSlug), task);
  const rubricImages = useRichImages(credentialsDir(collectionSlug), rubric);
  const [look, setLook] = useState<BadgeSettings>(() => opened.collection.badgeOverrides?.[slug] ?? {});
  const [artError, setArtError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const badgeHome = () => navigate({ view: "item", item: "badge", credentialKey: key });
  const allTargets = line.trim() ? [...targets, line.trim()] : targets;

  async function saveCredential(patch: Partial<Credential> | ((base: Credential) => Partial<Credential>), keepMine: boolean) {
    // Keep mine lays only this part over the file as it is now, so other changes on disk stay.
    const current = keepMine ? await loadFolder(storage) : state;
    const base = keepMine ? (current?.raw[credPath] ?? null) : opened.credBase;
    const onDisk = keepMine ? current?.credentials.find((x) => credentialKey(x) === key) : undefined;
    const from = onDisk ?? c;
    apply(await updateCredential(storage, { ...from, ...(typeof patch === "function" ? patch(from) : patch) }, base));
  }

  async function finish({ keepMine }: { keepMine: boolean }) {
    switch (part) {
      case "name":
        await saveCredential({ name: name.trim() }, keepMine);
        break;
      case "targets":
        await saveCredential(
          (from) => (moved.length === 0 ? { learningTargets: allTargets } : { learningTargets: allTargets, rubric: moved.reduce(appendToRubric, from.rubric).trim() }),
          keepMine,
        );
        break;
      case "task":
        await saveCredential({ task: task.trim() }, keepMine);
        break;
      case "rubric":
        await saveCredential({ rubric: rubric.trim() }, keepMine);
        break;
      case "look": {
        const current = keepMine ? await loadFolder(storage) : state;
        if (!current) return;
        const base = keepMine ? (current.raw[colPath] ?? null) : opened.colBase;
        const next = cleanSettings(look);
        apply(await setCredentialBadgeOverride(storage, current, collectionSlug, slug, Object.keys(next).length > 0 ? next : null, base));
        break;
      }
    }
    badgeHome();
  }

  async function useTheirs() {
    await reload();
    badgeHome();
  }

  // A changed task or rubric asks the holders to re-test, so the card says so before saving (R18, AE6).
  // Detail moved out of a target changes the rubric too.
  const rubricAdded = part === "rubric" ? rubric.trim() !== "" : part === "targets" && moved.length > 0;
  const firstRubric = c.rubric.trim() === "" && rubricAdded;
  const unsaved = (part === "task" && taskDraft.changed) || (part === "rubric" && rubricDraft.changed);
  const changed = unsaved || (part === "targets" && moved.length > 0);
  const warn = changed && opened.holders.length > 0;
  const warnBeat: Beat = {
    id: "warn",
    title: "Holders will re-test",
    forward: "Save",
    body: (
      <div className="edit-warn">
        <p>{firstRubric ? "Adding the first rubric counts as a change. " : ""}They keep the badge and are asked to re-test.</p>
        <ul className="edit-holders" aria-label="Holders">
          {opened.holders.map((p) => (
            <li key={p.slug}>
              <Machine mini setup={p} width={36} />
              <span>{p.name}</span>
            </li>
          ))}
        </ul>
      </div>
    ),
  };

  const draftCollection: Collection = {
    ...opened.collection,
    badgeOverrides: { ...(opened.collection.badgeOverrides ?? {}), [slug]: cleanSettings(look) },
  };
  const preview = <Badge collection={draftCollection} credential={{ slug, name: c.name }} size={120} className="edit-preview" />;

  async function pickArt() {
    setPicking(true);
    setArtError(null);
    try {
      const art = await importBadgeArt(storage, collectionSlug, slug);
      if (art !== null) setLook((l) => ({ ...l, art }));
    } catch (e) {
      setArtError(describeError(e));
    } finally {
      setPicking(false);
    }
  }

  let beats: Beat[];
  switch (part) {
    case "name":
      beats = [
        {
          id: "name",
          title: "What is it called",
          forward: "Save",
          valid: name.trim() !== "",
          body: <Field><input aria-label="Name" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} /></Field>,
        },
      ];
      break;
    case "targets":
      beats = [
        {
          id: "targets",
          title: "What its holder can do",
          forward: warn ? "Next" : "Save",
          valid: allTargets.length > 0,
          body: (
            <Lines
              lines={targets}
              onChange={setTargets}
              line={line}
              onLine={setLine}
              label="Learning targets"
              placeholder="I can…"
              onMove={(l) => setMoved((m) => [...m, l])}
            />
          ),
        },
        ...(warn ? [warnBeat] : []),
      ];
      break;
    case "task":
      beats = [
        {
          id: "task",
          title: "The task",
          forward: warn ? "Next" : "Save",
          valid: task.trim() !== "" && taskDraft.changed && !taskImages.busy,
          settled: "Task changed",
          pane: true,
          focusBody: true,
          body: (
            <>
              <RichText aria-label="Task" placeholder="What the agent is asked to do" value={task} onChange={taskDraft.setValue} onNormalized={taskDraft.onNormalized} images={taskImages.images} />
              {/* An agent drafts the task for pasting back in here (KTD9, R9). */}
              <CopyHelper label="Suggest a task" text={() => suggestAssignmentsPrompt({ ...c, task }, { count: "one" })} />
              <CopyHelper label="Review this assignment" text={() => reviewAssignmentPrompt({ ...c, task })} />
              <CopyHelper label="Write a refine prompt" text={() => refinePrompt({ ...c, task })} />
            </>
          ),
        },
        ...(warn ? [warnBeat] : []),
      ];
      break;
    case "rubric":
      beats = [
        {
          id: "rubric",
          title: "What good looks like",
          forward: warn ? "Next" : "Save",
          valid: rubricDraft.changed && !rubricImages.busy,
          settled: firstRubric ? "Rubric added" : "Rubric changed",
          pane: true,
          focusBody: true,
          body: (
            <>
              <RichText aria-label="Rubric" placeholder="How you will judge it" value={rubric} onChange={rubricDraft.setValue} onNormalized={rubricDraft.onNormalized} images={rubricImages.images} />
              <CopyHelper label="Check my criteria" text={() => checkCriteriaPrompt({ ...c, rubric })} />
            </>
          ),
        },
        ...(warn ? [warnBeat] : []),
      ];
      break;
    case "look":
      beats = [
        {
          id: "palette",
          title: "Colors",
          forward: look.palette === undefined ? "Skip" : "Next",
          settled: look.palette === undefined ? undefined : paletteName(look.palette),
          body: ({ advance }) => (
            <div className="edit-look">
              {preview}
              <div className="swatches" role="group" aria-label="Palettes">
                {PALETTES.map((p) => (
                  <button
                    key={p.slug}
                    type="button"
                    className="swatch"
                    aria-pressed={look.palette === p.slug}
                    onClick={() => {
                      const { colors: _c, ...rest } = look;
                      setLook({ ...rest, palette: p.slug });
                      advance();
                    }}
                  >
                    <span className="swatch-chip" aria-hidden="true" style={{ background: p.deep, borderColor: p.prim, outlineColor: p.sec }} />
                    <span>{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ),
        },
        {
          id: "art",
          title: "Art",
          forward: look.art ? "Next" : "Skip",
          settled: look.art ? fileName(look.art) : undefined,
          body: (
            <div className="edit-look">
              {preview}
              <p className="helper">
                <button type="button" onClick={() => void pickArt()} disabled={picking}>
                  Choose an image
                </button>
                {look.art && <span className="helper-status">{fileName(look.art)}</span>}
              </p>
              {artError && (
                <p className="deck-error" role="alert">
                  {artError}
                </p>
              )}
            </div>
          ),
        },
        {
          id: "title",
          title: "Title",
          forward: "Save",
          body: (
            <div className="edit-look">
              {preview}
              <Field>
                <input
                  aria-label="Title"
                  value={look.title?.main ?? ""}
                  placeholder={c.name}
                  autoComplete="off"
                  onChange={(e) => setLook({ ...look, title: { ...look.title, main: e.target.value } })}
                />
              </Field>
            </div>
          ),
        },
      ];
      break;
  }

  return <Deck label={`Edit ${c.name}`} beats={beats} unsaved={unsaved} onClose={badgeHome} onFinish={finish} onUseTheirs={() => void useTheirs()} />;
}

// ---------------------------------------------------------------------------
// A collection's name (collections plan U6, R3)

export interface EditCollectionDeckProps {
  collectionSlug: Slug;
  part: CollectionPart;
}

export function EditCollectionDeck(props: EditCollectionDeckProps) {
  const { state } = useFolder();
  const { navigate } = useNav();
  if (!state) return null;
  const collection = state.collections.find((c) => c.slug === props.collectionSlug);
  if (!collection) return <Missing onHome={() => navigate({ view: "home" })} />;
  return <EditCollection {...props} collection={collection} state={state} />;
}

function EditCollection({ collectionSlug, collection: atOpen, state: stateAtOpen }: EditCollectionDeckProps & { collection: Collection; state: FolderState }) {
  const { storage, state, apply, reload } = useFolder();
  const { navigate } = useNav();
  const path = collectionPath(collectionSlug);
  const [opened] = useState(() => ({ collection: atOpen, base: stateAtOpen.raw[path] ?? null }));
  const [name, setName] = useState(opened.collection.name);

  const home = () => navigate({ view: "home" });

  async function finish({ keepMine }: { keepMine: boolean }) {
    const current = keepMine ? await loadFolder(storage) : state;
    if (!current) return;
    // Keep mine lays only the name over the file as it is now, so other changes on disk stay.
    const base = keepMine ? (current.raw[path] ?? null) : opened.base;
    const from = collectionAsOnDisk(base, keepMine ? (current.collections.find((c) => c.slug === collectionSlug) ?? opened.collection) : opened.collection);
    apply(await updateCollection(storage, current, { ...from, name: name.trim() }, base));
    navigate({ view: "home", litCollection: collectionSlug });
  }

  async function useTheirs() {
    await reload();
    home();
  }

  const beat: Beat = {
    id: "name",
    title: "What is it called",
    forward: "Rename the collection",
    valid: name.trim() !== "" && name.trim() !== opened.collection.name,
    body: <Field><input aria-label="Name" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} /></Field>,
  };

  return <Deck label={`Rename ${opened.collection.name}`} beats={[beat]} onClose={home} onFinish={finish} onUseTheirs={() => void useTheirs()} />;
}

// ---------------------------------------------------------------------------
// An agent's parts (U7)

export interface EditAgentDeckProps {
  profileSlug: Slug;
  part: AgentPart;
}

export function EditAgentDeck(props: EditAgentDeckProps) {
  const { state } = useFolder();
  const { navigate } = useNav();
  if (!state) return null;
  const profile = state.profiles.find((p) => p.slug === props.profileSlug);
  if (!profile) return <Missing onHome={() => navigate({ view: "home" })} />;
  return <EditAgent {...props} profile={profile} state={state} />;
}

/** A parameter line, "name = value", split at the first "=". */
export function parseParam(line: string): [string, string] | null {
  const i = line.indexOf("=");
  const k = (i < 0 ? line : line.slice(0, i)).trim();
  if (k === "") return null;
  return [k, i < 0 ? "" : line.slice(i + 1).trim()];
}

function EditAgent({ profileSlug, part, profile: atOpen, state: stateAtOpen }: EditAgentDeckProps & { profile: AgentProfile; state: FolderState }) {
  const { storage, state, apply, reload } = useFolder();
  const { navigate } = useNav();
  const path = profilePath(profileSlug);
  const [opened] = useState(() => ({ profile: atOpen, base: stateAtOpen.raw[path] ?? null }));
  const p = opened.profile;

  const [name, setName] = useState(p.name);
  const [repo, setRepo] = useState(p.repo);
  const notesDraft = useRichDraft(p.notes);
  const notes = notesDraft.value;
  // Notes save inside agents/<slug>.json, so their images go in agents/.
  const notesImages = useRichImages(folderOf(path), notes);
  const [params, setParams] = useState(() => Object.entries(p.params).map(([k, v]) => `${k} = ${v}`));
  const [line, setLine] = useState("");

  const agentHome = () => navigate({ view: "item", item: "agent", profileSlug });
  const allParams = line.trim() ? [...params, line.trim()] : params;

  function patch(): Partial<AgentProfile> {
    switch (part) {
      case "name":
        return { name: name.trim() };
      case "repo":
        return { repo: repo.trim() };
      case "notes":
        return { notes: notes.trim() };
      case "params":
        return { params: Object.fromEntries(allParams.map(parseParam).filter((x): x is [string, string] => x !== null)) };
    }
  }

  async function finish({ keepMine }: { keepMine: boolean }) {
    const current = keepMine ? await loadFolder(storage) : state;
    if (!current) return;
    const base = keepMine ? (current.raw[path] ?? null) : opened.base;
    // Keep mine lays only this part over the file as it is now, so other changes on disk stay.
    const onDisk = keepMine ? current.profiles.find((x) => x.slug === profileSlug) : undefined;
    apply(await updateProfile(storage, current, { ...(onDisk ?? p), ...patch() }, base));
    agentHome();
  }

  async function useTheirs() {
    await reload();
    agentHome();
  }

  let beat: Beat;
  switch (part) {
    case "name":
      beat = {
        id: "name",
        title: "What is it called",
        forward: "Save",
        valid: name.trim() !== "",
        body: <Field><input aria-label="Name" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} /></Field>,
      };
      break;
    case "repo":
      beat = {
        id: "repo",
        title: "Where it works",
        forward: "Save",
        body: <Field><input aria-label="Repo" value={repo} autoComplete="off" placeholder="The folder it opens in" onChange={(e) => setRepo(e.target.value)} /></Field>,
      };
      break;
    case "notes":
      beat = {
        id: "notes",
        title: "Notes",
        forward: "Save",
        valid: notesDraft.changed && !notesImages.busy,
        pane: true,
        focusBody: true,
        body: <RichText aria-label="Notes" placeholder="Anything worth remembering" value={notes} onChange={notesDraft.setValue} onNormalized={notesDraft.onNormalized} images={notesImages.images} />,
      };
      break;
    case "params":
      beat = {
        id: "params",
        title: "Parameters",
        forward: "Save",
        body: <Lines lines={params} onChange={setParams} line={line} onLine={setLine} label="Parameters" placeholder="name = value" />,
      };
      break;
  }

  return <Deck label={`Edit ${p.name}`} beats={[beat]} unsaved={part === "notes" && notesDraft.changed} onClose={agentHome} onFinish={finish} onUseTheirs={() => void useTheirs()} />;
}
