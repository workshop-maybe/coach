// Domain operations (U4): create and edit collections, credentials and profiles,
// duplicate profiles, and record assessments. Each operation writes through the
// folder layer's saves (which refuse outdated base texts, KTD6) and returns the
// folder freshly reloaded, so `raw` always matches what is on disk.

import { ChangedOnDiskError, type Storage } from "../storage/storage";
import {
  collectionPath,
  credentialPath,
  fileStemFor,
  loadFolder,
  saveAssessment,
  saveCollection,
  saveCredential,
  saveProfile,
} from "./folder";
import { assignmentVersion } from "./hash";
import { uniqueSlug } from "./slug";
import {
  credentialKey,
  type AgentProfile,
  type AgentSetup,
  type Assessment,
  type AssessmentResult,
  type Collection,
  type Credential,
  type FolderState,
  type Slug,
} from "./types";

/** Thrown when an update would change the setup of a profile that has results (R6, KTD10). */
export class SetupLockedError extends Error {
  constructor(
    public readonly profileSlug: Slug,
    public readonly fields: (keyof AgentSetup)[],
  ) {
    super(`The setup of "${profileSlug}" is locked because it has results. Duplicate it to try a different setup.`);
    this.name = "SetupLockedError";
  }
}

const SETUP_FIELDS: (keyof AgentSetup)[] = ["harness", "model", "effort"];

function findCollection(state: FolderState, slug: Slug): Collection {
  const c = state.collections.find((x) => x.slug === slug);
  if (!c) throw new Error(`No collection "${slug}".`);
  return c;
}

function findProfile(state: FolderState, slug: Slug): AgentProfile {
  const p = state.profiles.find((x) => x.slug === slug);
  if (!p) throw new Error(`No agent profile "${slug}".`);
  return p;
}

function findCredential(state: FolderState, collectionSlug: Slug, slug: Slug): Credential {
  const c = state.credentials.find((x) => x.collectionSlug === collectionSlug && x.slug === slug);
  if (!c) throw new Error(`No credential "${collectionSlug}/${slug}".`);
  return c;
}

/** Checks every target before any write, so a multi-file operation never half-applies. */
async function assertUnchanged(storage: Storage, bases: [path: string, base: string | null][]): Promise<void> {
  for (const [path, base] of bases) {
    if ((await storage.readText("data", path)) !== base) throw new ChangedOnDiskError(path);
  }
}

// ---------------------------------------------------------------------------
// Collections

export async function createCollection(
  storage: Storage,
  state: FolderState,
  name: string,
): Promise<{ state: FolderState; slug: Slug }> {
  const slug = uniqueSlug(name, state.collections.map((c) => c.slug));
  await saveCollection(storage, { slug, name: name.trim(), description: "", order: [], codes: {} }, null);
  return { state: await loadFolder(storage), slug };
}

/** Saves name, description and order. Module codes are never changed here (KTD7). */
export async function updateCollection(
  storage: Storage,
  state: FolderState,
  collection: Collection,
  baseText: string | null,
): Promise<FolderState> {
  const stored = findCollection(state, collection.slug);
  await saveCollection(storage, { ...collection, codes: { ...stored.codes } }, baseText);
  return loadFolder(storage);
}

/** Changes the display order only. Codes stay as they are (KTD7). */
export async function reorderCredentials(
  storage: Storage,
  state: FolderState,
  collectionSlug: Slug,
  orderedSlugs: Slug[],
  baseText: string | null,
): Promise<FolderState> {
  const stored = findCollection(state, collectionSlug);
  const current = [...stored.order].sort();
  const next = [...orderedSlugs].sort();
  if (current.length !== next.length || current.some((s, i) => s !== next[i])) {
    throw new Error("A reorder must list every credential in the collection exactly once.");
  }
  await saveCollection(storage, { ...stored, order: [...orderedSlugs] }, baseText);
  return loadFolder(storage);
}

// ---------------------------------------------------------------------------
// Credentials

/** Adds a credential to a collection with the next unused module code (KTD7). */
export async function createCredential(
  storage: Storage,
  state: FolderState,
  collectionSlug: Slug,
  name: string,
): Promise<{ state: FolderState; key: string }> {
  const collection = findCollection(state, collectionSlug);
  const taken = [
    ...state.credentials.filter((c) => c.collectionSlug === collectionSlug).map((c) => c.slug),
    ...Object.keys(collection.codes),
  ];
  const slug = uniqueSlug(name, taken);
  const credential: Credential = {
    slug,
    collectionSlug,
    name: name.trim(),
    learningTargets: [],
    task: "",
    rubric: "",
    extraSections: [],
  };
  const code = Math.max(0, ...Object.values(collection.codes)) + 1;
  const updated: Collection = {
    ...collection,
    order: [...collection.order, slug],
    codes: { ...collection.codes, [slug]: code },
  };

  const colPath = collectionPath(collectionSlug);
  const colBase = state.raw[colPath] ?? null;
  await assertUnchanged(storage, [
    [colPath, colBase],
    [credentialPath(collectionSlug, slug), null],
  ]);
  await saveCredential(storage, credential, null);
  await saveCollection(storage, updated, colBase);
  return { state: await loadFolder(storage), key: credentialKey(credential) };
}

export async function updateCredential(
  storage: Storage,
  _state: FolderState,
  credential: Credential,
  baseText: string | null,
): Promise<FolderState> {
  await saveCredential(storage, credential, baseText);
  return loadFolder(storage);
}

// ---------------------------------------------------------------------------
// Agent profiles

export async function createProfile(
  storage: Storage,
  state: FolderState,
  fields: Omit<AgentProfile, "slug">,
): Promise<{ state: FolderState; slug: Slug }> {
  const slug = uniqueSlug(fields.name, state.profiles.map((p) => p.slug));
  await saveProfile(storage, { ...fields, params: { ...fields.params }, slug }, null);
  return { state: await loadFolder(storage), slug };
}

/** True when the profile has any assessment. The UI reads the same predicate (KTD10). */
export function isSetupLocked(state: FolderState, profileSlug: Slug): boolean {
  return state.assessments.some((a) => a.profileSlug === profileSlug);
}

/** Name, repo, notes and params always save. Harness, model and effort only while unlocked (R6, R7). */
export async function updateProfile(
  storage: Storage,
  state: FolderState,
  profile: AgentProfile,
  baseText: string | null,
): Promise<FolderState> {
  if (isSetupLocked(state, profile.slug)) {
    const stored = findProfile(state, profile.slug);
    const changed = SETUP_FIELDS.filter((f) => profile[f] !== stored[f]);
    if (changed.length > 0) throw new SetupLockedError(profile.slug, changed);
  }
  await saveProfile(storage, profile, baseText);
  return loadFolder(storage);
}

/** An unsaved copy with every field editable. Writes nothing; save it with createProfile. */
export function duplicateProfileDraft(state: FolderState, profileSlug: Slug): Omit<AgentProfile, "slug"> {
  const { slug: _slug, ...fields } = findProfile(state, profileSlug);
  return { ...fields, name: `${fields.name} (copy)`, params: { ...fields.params } };
}

// ---------------------------------------------------------------------------
// Assessments

export interface AssessmentInput {
  profileSlug: Slug;
  collectionSlug: Slug;
  credentialSlug: Slug;
  result: AssessmentResult;
  note: string;
  handBack: string;
}

/**
 * Records a result the user chose (R14, R15), stamped with the credential's current
 * assignment version and the profile's current setup (R16). Always a new file.
 */
export async function recordAssessment(
  storage: Storage,
  state: FolderState,
  input: AssessmentInput,
  now: Date = new Date(),
): Promise<FolderState> {
  if (input.result !== "met" && input.result !== "not_met") {
    throw new Error('Choose "met" or "not met" before saving.');
  }
  if (typeof input.handBack !== "string" || input.handBack.trim() === "") {
    throw new Error("Paste the agent's hand-back before saving.");
  }
  const profile = findProfile(state, input.profileSlug);
  const credential = findCredential(state, input.collectionSlug, input.credentialSlug);

  const assessment: Assessment = {
    profileSlug: profile.slug,
    collectionSlug: credential.collectionSlug,
    credentialSlug: credential.slug,
    fileStem: fileStemFor(now),
    result: input.result,
    recordedAt: now.toISOString(),
    assignmentVersion: await assignmentVersion(credential.task, credential.rubric),
    setup: { harness: profile.harness, model: profile.model, effort: profile.effort },
    note: input.note ?? "",
    handBack: input.handBack,
  };
  await saveAssessment(storage, assessment);
  return loadFolder(storage);
}
