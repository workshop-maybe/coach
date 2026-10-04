// Domain operations (U4): create and edit collections, credentials and profiles,
// duplicate profiles, and record assessments. Each operation writes through the
// folder layer's saves (which refuse outdated base texts, KTD6) and returns the
// folder freshly reloaded, so `raw` always matches what is on disk.

import type { BadgeSettings } from "../badge/settings";
import { ChangedOnDiskError, type Storage } from "../storage/storage";
import {
  ASSESSMENTS_DIR,
  assessmentDir,
  collectionPath,
  credentialPath,
  fileStemFor,
  handoffPath,
  handoffsDir,
  heldPath,
  isCredentialResult,
  loadFolder,
  markPath,
  marksDir,
  profilePath,
  profileResultsDir,
  saveAssessment,
  saveCollection,
  saveCredential,
  saveProfile,
  saveText,
  serializeHeld,
  serializeMark,
  SKELETON_PATH,
  trashPath,
  type AssessmentIds,
} from "./folder";
import { checkHandoff, isHandoffLocked, type HandoffProblem } from "./handoffs";
import { resultOf } from "./goTo";
import { heldOf } from "./handoffResults";
import { assignmentVersion } from "./hash";
import { findPreset, presetCredential } from "./presets";
import { rubricParts, tappedPoints } from "./secondOpinion";
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
  type HeldReply,
  type JevReading,
  type Mark,
  type Slug,
  type TestContext,
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

/** Thrown when an update would change a handoff that a result names (R5, KTD5). Save it as a new handoff instead. */
export class HandoffLockedError extends Error {
  constructor(
    public readonly credentialKey: string,
    public readonly handoffId: string,
  ) {
    super(`The handoff "${handoffId}" of "${credentialKey}" is locked because it has results. Save the edit as a new handoff.`);
    this.name = "HandoffLockedError";
  }
}

/** Thrown when a template fails the save check (KTD2, R7). */
export class HandoffProblemError extends Error {
  constructor(public readonly problem: HandoffProblem) {
    super(problem.kind === "missing-slot" ? `A handoff needs ${problem.slot}.` : "A handoff cannot include the badge's rubric.");
    this.name = "HandoffProblemError";
  }
}

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
// Badges (KTD3, KTD4). Both setters spread the stored collection, so a badge save
// never changes the name, description, order or codes.

/** Sets the collection's badge settings, or clears them with `undefined`. */
export async function updateCollectionBadge(
  storage: Storage,
  state: FolderState,
  collectionSlug: Slug,
  badge: BadgeSettings | undefined,
  baseText: string | null,
): Promise<FolderState> {
  const stored = findCollection(state, collectionSlug);
  // Dropping badgeRaw means a malformed stored value is replaced or cleared too.
  const { badge: _badge, badgeRaw: _raw, ...rest } = stored;
  const next: Collection = badge === undefined ? rest : { ...rest, badge };
  await saveCollection(storage, next, baseText);
  return loadFolder(storage);
}

/** Sets one credential's badge override, or removes it with `null`. Other entries stay as they are. */
export async function setCredentialBadgeOverride(
  storage: Storage,
  state: FolderState,
  collectionSlug: Slug,
  credentialSlug: Slug,
  override: BadgeSettings | null,
  baseText: string | null,
): Promise<FolderState> {
  const stored = findCollection(state, collectionSlug);
  if (override !== null) findCredential(state, collectionSlug, credentialSlug);

  const next = withoutOverride(stored, credentialSlug);
  if (override !== null) next.badgeOverrides = { ...(stored.badgeOverrides ?? {}), [credentialSlug]: override };
  await saveCollection(storage, next, baseText);
  return loadFolder(storage);
}

/** The collection with one credential's badge override removed, malformed entry included. */
function withoutOverride(stored: Collection, credentialSlug: Slug): Collection {
  const next: Collection = { ...stored };
  if (stored.badgeOverrideEntriesRaw !== undefined) {
    const { [credentialSlug]: _dropped, ...otherRaw } = stored.badgeOverrideEntriesRaw;
    if (Object.keys(otherRaw).length > 0) next.badgeOverrideEntriesRaw = otherRaw;
    else delete next.badgeOverrideEntriesRaw;
  }
  if (stored.badgeOverrides !== undefined) {
    const { [credentialSlug]: _removed, ...others } = stored.badgeOverrides;
    next.badgeOverrides = others;
  }
  return next;
}

/**
 * Copies a picked image into the collection's badge folder and returns its
 * folder-relative path, or null when the picker was cancelled. It never writes
 * collection.json: the path is a draft value until the badge Save (KTD4).
 */
export async function importBadgeArt(
  storage: Storage,
  collectionSlug: Slug,
  credentialSlug: Slug | null,
): Promise<string | null> {
  return storage.importBadgeArt(collectionSlug, credentialSlug);
}

// ---------------------------------------------------------------------------
// Credentials

/** What a new credential can start with, written in its first save. */
export type CredentialContent = Pick<Credential, "learningTargets" | "task" | "rubric" | "extraSections">;

/** Adds a credential to a collection with the next unused module code (KTD7). */
export async function createCredential(
  storage: Storage,
  state: FolderState,
  collectionSlug: Slug,
  name: string,
  content?: CredentialContent,
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
    ...content,
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
  // The collection first: if the credential write then fails, the listed slug has no file
  // and loads as nothing, so a retry never finds a stray badge (its code is skipped, KTD7).
  await saveCollection(storage, updated, colBase);
  await saveCredential(storage, credential, null);
  return { state: await loadFolder(storage), key: credentialKey(credential) };
}

/** The collection a credential lands in when the folder has none. */
export const DEFAULT_COLLECTION_NAME = "My credentials";

/**
 * Makes a badge from a preset: in the first collection, or a new My credentials when there
 * is none. The preset is written whole in the credential's first save, so no empty badge
 * file is ever left behind.
 */
export async function createPresetCredential(
  storage: Storage,
  state: FolderState,
  presetId: string,
): Promise<{ state: FolderState; key: string }> {
  const preset = findPreset(presetId);
  if (!preset) throw new Error(`There is no preset "${presetId}".`);
  // With no collection in hand, read the folder again: a try that failed after making My
  // credentials left it on disk, and a retry should land there instead of conflicting.
  let current = state.collections.length > 0 ? state : await loadFolder(storage);
  let collectionSlug = current.collections[0]?.slug;
  if (!collectionSlug) {
    const made = await createCollection(storage, current, DEFAULT_COLLECTION_NAME);
    current = made.state;
    collectionSlug = made.slug;
  }
  const { name, learningTargets, task, rubric, extraSections } = presetCredential(preset, collectionSlug);
  return createCredential(storage, current, collectionSlug, name, { learningTargets, task, rubric, extraSections });
}

export async function updateCredential(
  storage: Storage,
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
// Handoffs (KTD1, KTD3, KTD5): template files, saved verbatim.

function assertHandoffOk(text: string, rubric?: string): void {
  const problem = checkHandoff(text, rubric);
  if (problem) throw new HandoffProblemError(problem);
}

/** Saves the skeleton. Base null means the folder still uses the built-in one (R2). */
export async function saveSkeleton(storage: Storage, text: string, baseText: string | null): Promise<FolderState> {
  assertHandoffOk(text);
  await saveText(storage, SKELETON_PATH, text, baseText);
  return loadFolder(storage);
}

const STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

/**
 * A stamp later than every `<stamp><ext>` file already in `dir`, so the new file is the
 * newest there even when two are made in the same second or the clock reads earlier. A
 * badge's handoffs (R6), its go-to marks (KTD2), and each agent's results and held replies on
 * it (hold-and-compare KTD5) take their stems from it. `dir` is listed recursively.
 */
async function nextStamp(storage: Storage, dir: string, ext: string, now: Date): Promise<string> {
  let time = Math.floor(now.getTime() / 1000) * 1000;
  for (const path of await storage.listFiles("data", dir)) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const m = STAMP.exec(name.endsWith(ext) ? name.slice(0, -ext.length) : name);
    if (m) time = Math.max(time, Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + 1000);
  }
  return fileStemFor(new Date(time));
}

/** Adds a handoff to a badge as a new file, which becomes the badge's default (R4, R6). */
export async function createHandoff(
  storage: Storage,
  state: FolderState,
  collectionSlug: Slug,
  credentialSlug: Slug,
  text: string,
  now = new Date(),
): Promise<{ state: FolderState; id: string }> {
  const credential = findCredential(state, collectionSlug, credentialSlug);
  assertHandoffOk(text, credential.rubric);
  const id = await nextStamp(storage, handoffsDir(collectionSlug, credentialSlug), ".md", now);
  await saveText(storage, handoffPath(collectionSlug, credentialSlug, id), text, null);
  return { state: await loadFolder(storage), id };
}

/** Rewrites a handoff in place, keeping its id. Refuses one that a result names (R5). */
export async function updateHandoff(
  storage: Storage,
  state: FolderState,
  collectionSlug: Slug,
  credentialSlug: Slug,
  id: string,
  text: string,
  baseText: string | null,
): Promise<FolderState> {
  const credential = findCredential(state, collectionSlug, credentialSlug);
  const key = credentialKey(credential);
  if (!state.handoffs.some((h) => credentialKey(h) === key && h.id === id)) throw new Error(`No handoff "${id}" on "${key}".`);
  if (isHandoffLocked(state, key, id)) throw new HandoffLockedError(key, id);
  assertHandoffOk(text, credential.rubric);
  await saveText(storage, handoffPath(collectionSlug, credentialSlug, id), text, baseText);
  return loadFolder(storage);
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
  /** The context captured when the test prompt was copied, when there was one. */
  context?: TestContext;
  /** The handoff the test ran with, as copied. Recording it locks that handoff (KTD5). */
  handoff?: Assessment["handoff"];
  /** Jev's reading of this reply, when the user asked. Dropped unless its version is the one stamped (KTD11). */
  jev?: JevReading;
  /** The rubric points the user tapped as missed. Kept only on a Not met result, and only those in the rubric stamped (KTD14). */
  missedPoints?: string[];
}

/** A reply to hold: what a result would record, without the verdict, a note or missed points. */
export type HoldInput = Omit<AssessmentInput, "result" | "note" | "missedPoints">;

/** What a result or a held reply stamps about the test from the folder as it is now (R16). */
async function stampTest(state: FolderState, input: HoldInput) {
  if (typeof input.handBack !== "string" || input.handBack.trim() === "") {
    throw new Error("Paste the agent's hand-back before saving.");
  }
  const profile = findProfile(state, input.profileSlug);
  const credential = findCredential(state, input.collectionSlug, input.credentialSlug);
  const version = await assignmentVersion(credential.task, credential.rubric);
  return {
    ids: { profileSlug: profile.slug, collectionSlug: credential.collectionSlug, credentialSlug: credential.slug },
    assignmentVersion: version,
    setup: { harness: profile.harness, model: profile.model, effort: profile.effort },
    handBack: input.handBack,
    ...(input.context ? { context: input.context } : {}),
    ...(input.handoff ? { handoff: { id: input.handoff.id, text: input.handoff.text } } : {}),
    ...(input.jev && input.jev.assignmentVersion === version ? { jev: input.jev } : {}),
  };
}

/**
 * A stem later than every result and held reply of this agent on this badge (hold-and-compare
 * KTD5), so no new result can take the stem of a reply still held, which would read as its verdict.
 */
function nextResultStem(storage: Storage, ids: Omit<AssessmentIds, "fileStem">, now: Date): Promise<string> {
  return nextStamp(storage, assessmentDir(ids.profileSlug, ids.collectionSlug, ids.credentialSlug), ".md", now);
}

/**
 * The tapped points that are points of `rubric`, once each, in rubric order (KTD14). A point
 * from an earlier rubric, or text that is not a point, is dropped.
 */
function keptMissedPoints(tapped: readonly string[], rubric: string): string[] {
  return tappedPoints(rubricParts(rubric).points, tapped);
}

/**
 * Records a result the user chose (R14, R15), stamped with the credential's current
 * assignment version and the profile's current setup (R16). Always a new file, named for
 * `now` or the next free second after it. A Jev reading taken against any other assignment
 * version is left off; the result still saves. Missed points are kept only on a Not met
 * result, and only those that are points of the rubric stamped. Returns the stem it wrote.
 */
export async function recordAssessment(
  storage: Storage,
  state: FolderState,
  input: AssessmentInput,
  now: Date = new Date(),
): Promise<{ state: FolderState; fileStem: string }> {
  if (input.result !== "met" && input.result !== "not_met") {
    throw new Error('Choose "met" or "not met" before saving.');
  }
  const { ids, ...test } = await stampTest(state, input);
  // The credential stampTest hashed, so the rubric is the one at the version stamped.
  const { rubric } = findCredential(state, ids.collectionSlug, ids.credentialSlug);
  const missed = input.result === "not_met" ? keptMissedPoints(input.missedPoints ?? [], rubric) : [];
  const fileStem = await nextResultStem(storage, ids, now);
  const assessment: Assessment = {
    ...ids,
    fileStem,
    result: input.result,
    recordedAt: now.toISOString(),
    note: input.note ?? "",
    ...test,
    ...(missed.length > 0 ? { missedPoints: missed } : {}),
  };
  await saveAssessment(storage, assessment);
  return { state: await loadFolder(storage), fileStem };
}

// ---------------------------------------------------------------------------
// Held replies (hold-and-compare KTD1 to KTD5)

/**
 * Holds a reply without a verdict (R1, R2): a new file one folder below the agent's results
 * on the badge, stamped as a result would be. It is not a result and holds no badge.
 */
export async function holdReply(storage: Storage, state: FolderState, input: HoldInput, now: Date = new Date()): Promise<{ state: FolderState; fileStem: string }> {
  const { ids, ...test } = await stampTest(state, input);
  const fileStem = await nextResultStem(storage, ids, now);
  const held: HeldReply = { ...ids, fileStem, heldAt: now.toISOString(), ...test };
  await saveText(storage, heldPath(ids.profileSlug, ids.collectionSlug, ids.credentialSlug, fileStem), serializeHeld(held), null);
  return { state: await loadFolder(storage), fileStem };
}

/**
 * Judges a held reply, named by its agent, badge and stem (R6, R9, R10): a new result under
 * the held reply's own stem and time, with what it recorded about its test (KTD3). The held
 * file is never touched; the folder stops listing it as held once the result is there
 * (KTD4). Refuses a reply no longer held.
 */
export async function judgeHeldReply(storage: Storage, state: FolderState, ref: AssessmentIds, result: AssessmentResult): Promise<FolderState> {
  if (result !== "met" && result !== "not_met") throw new Error('Choose "met" or "not met" before saving.');
  findProfile(state, ref.profileSlug);
  const credential = findCredential(state, ref.collectionSlug, ref.credentialSlug);
  const held = heldOf(state, ref.profileSlug, credentialKey(credential), ref.fileStem);
  if (!held) throw new Error("That reply is no longer held.");
  const { heldAt, ...rest } = held;
  await saveAssessment(storage, { ...rest, result, recordedAt: heldAt, note: "" });
  return loadFolder(storage);
}

// ---------------------------------------------------------------------------
// Go-to marks

/** The result a mark is made on: its agent, its badge and its file stem. */
export interface MarkInput {
  profileSlug: Slug;
  collectionSlug: Slug;
  credentialSlug: Slug;
  fileStem: string;
}

/**
 * Marks a Met result as the agent the user chose for its badge (R1, R3): a new mark file
 * named for when it was made, never a change to the result (KTD1, KTD2). Checks the result
 * against the folder as given, since the view that asks may hold it across a reload.
 */
export async function markGoTo(storage: Storage, state: FolderState, input: MarkInput, now: Date = new Date()): Promise<FolderState> {
  findProfile(state, input.profileSlug);
  const credential = findCredential(state, input.collectionSlug, input.credentialSlug);
  const result = resultOf(state, input.profileSlug, credentialKey(credential), input.fileStem);
  if (!result) throw new Error("That result is no longer in the folder.");
  if (result.result !== "met") throw new Error("Only a Met result can make an agent the go-to.");
  const dir = marksDir(credential.collectionSlug, credential.slug);
  const id = await nextStamp(storage, dir, ".json", now);
  const mark: Mark = { collectionSlug: credential.collectionSlug, credentialSlug: credential.slug, id, profileSlug: input.profileSlug, fileStem: input.fileStem };
  await saveText(storage, markPath(mark.collectionSlug, mark.credentialSlug, id), serializeMark(mark), null);
  return loadFolder(storage);
}

// ---------------------------------------------------------------------------
// Trash: an agent or a credential leaves the app with its results, moved (never
// deleted) under trash/<stamp>/ at the same paths, so moving the files back restores it.
// The item's own file moves last: if a move fails partway, the item still loads and
// trashing it again moves what is left.

async function moveToTrash(storage: Storage, paths: string[], stamp: string): Promise<void> {
  for (const path of paths) await storage.moveFile("data", path, trashPath(stamp, path));
}

/** Moves an agent and every result recorded for it to the trash. */
export async function trashProfile(storage: Storage, state: FolderState, profileSlug: Slug, now = new Date()): Promise<FolderState> {
  findProfile(state, profileSlug);
  const results = await storage.listFiles("data", profileResultsDir(profileSlug));
  await moveToTrash(storage, [...results, profilePath(profileSlug)], fileStemFor(now));
  return loadFolder(storage);
}

/**
 * Moves a credential, its handoffs and every agent's results for it to the trash, and
 * takes it out of its collection's order and badge overrides. The collection as it was
 * goes into the trash too, so its order and the credential's badge look can be restored.
 * The collection saves before anything moves, so a file changed on disk moves nothing (KTD6).
 */
export async function trashCredential(
  storage: Storage,
  state: FolderState,
  collectionSlug: Slug,
  credentialSlug: Slug,
  now = new Date(),
): Promise<FolderState> {
  const stored = findCollection(state, collectionSlug);
  findCredential(state, collectionSlug, credentialSlug);
  const path = collectionPath(collectionSlug);
  const base = state.raw[path] ?? null;
  const stamp = fileStemFor(now);

  const next = { ...withoutOverride(stored, credentialSlug), order: stored.order.filter((s) => s !== credentialSlug) };
  await saveCollection(storage, next, base);
  if (base !== null) await storage.writeText("data", trashPath(stamp, path), base);

  // Every agent's results for it, every handoff file and every go-to mark, parsed or not.
  const results = (await storage.listFiles("data", ASSESSMENTS_DIR)).filter((p) => isCredentialResult(p, collectionSlug, credentialSlug));
  const handoffs = await storage.listFiles("data", handoffsDir(collectionSlug, credentialSlug));
  const marks = await storage.listFiles("data", marksDir(collectionSlug, credentialSlug));
  await moveToTrash(storage, [...results, ...handoffs, ...marks, credentialPath(collectionSlug, credentialSlug)], stamp);
  return loadFolder(storage);
}
