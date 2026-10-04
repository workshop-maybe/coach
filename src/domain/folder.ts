// The data folder format (KTD3, KTD4, KTD6, KTD7): paths, per-entity parse and
// serialize, a whole-folder load that reports unreadable files by path, and saves
// that refuse to overwrite a file changed since it was opened.

import YAML from "yaml";
import { parseBadgeSettings, type BadgeSettings } from "../badge/settings";
import { ChangedOnDiskError, type Storage } from "../storage/storage";
import { parseCredentialMd, serializeCredentialMd } from "./credential-md";
import { isTestContext } from "./context";
import { isProbability } from "./jevRequest";
import type {
  AgentProfile,
  AgentSetup,
  Assessment,
  AssessmentResult,
  Collection,
  Credential,
  FolderState,
  Handoff,
  JevPoint,
  JevReading,
  LoadError,
  Mark,
  Slug,
  TestContext,
} from "./types";

// ---------------------------------------------------------------------------
// Paths (Output Structure)

export const MARKER_PATH = "andamio-desktop.json";
export const FORMAT_VERSION = 1;

const COLLECTIONS_DIR = "collections";
const AGENTS_DIR = "agents";
export const ASSESSMENTS_DIR = "assessments";
const TRASH_DIR = "trash";

/** The edited skeleton. Absent means the built-in one; written only on the first edit (KTD1). */
export const SKELETON_PATH = "handoffs/skeleton.md";

export function collectionPath(slug: Slug): string {
  return `${COLLECTIONS_DIR}/${slug}/collection.json`;
}

/** The folder every credential in a collection saves to, and their pasted images with them. */
export function credentialsDir(collectionSlug: Slug): string {
  return `${COLLECTIONS_DIR}/${collectionSlug}/credentials`;
}

export function credentialPath(collectionSlug: Slug, slug: Slug): string {
  return `${credentialsDir(collectionSlug)}/${slug}.md`;
}

export function profilePath(slug: Slug): string {
  return `${AGENTS_DIR}/${slug}.json`;
}

/** The folder one agent's results on one badge save to, and their pasted images with them. */
export function assessmentDir(profileSlug: Slug, collectionSlug: Slug, credentialSlug: Slug): string {
  return `${ASSESSMENTS_DIR}/${profileSlug}/${collectionSlug}/${credentialSlug}`;
}

export function assessmentPath(profileSlug: Slug, collectionSlug: Slug, credentialSlug: Slug, fileStem: string): string {
  return `${assessmentDir(profileSlug, collectionSlug, credentialSlug)}/${fileStem}.md`;
}

/** Every handoff file for one badge, parsed or not. */
export function handoffsDir(collectionSlug: Slug, credentialSlug: Slug): string {
  return `${COLLECTIONS_DIR}/${collectionSlug}/handoffs/${credentialSlug}`;
}

export function handoffPath(collectionSlug: Slug, credentialSlug: Slug, id: string): string {
  return `${handoffsDir(collectionSlug, credentialSlug)}/${id}.md`;
}

/** Every go-to mark file for one badge, parsed or not. Kept with the badge, so trashing an agent leaves them (KTD1). */
export function marksDir(collectionSlug: Slug, credentialSlug: Slug): string {
  return `${COLLECTIONS_DIR}/${collectionSlug}/marks/${credentialSlug}`;
}

export function markPath(collectionSlug: Slug, credentialSlug: Slug, id: string): string {
  return `${marksDir(collectionSlug, credentialSlug)}/${id}.json`;
}

/** Where a file moved to the trash at `stamp` lands: its own path under trash/<stamp>/. */
export function trashPath(stamp: string, path: string): string {
  return `${TRASH_DIR}/${stamp}/${path}`;
}

/** True for any file under assessments/<agent>/<collection>/<credential>/, whatever the agent. */
export function isCredentialResult(path: string, collectionSlug: Slug, credentialSlug: Slug): boolean {
  const parts = path.split("/");
  return parts.length > 4 && parts[0] === ASSESSMENTS_DIR && parts[2] === collectionSlug && parts[3] === credentialSlug;
}

/** Every result file for one agent, parsed or not. */
export function profileResultsDir(profileSlug: Slug): string {
  return `${ASSESSMENTS_DIR}/${profileSlug}`;
}

/** A Windows-safe UTC stamp, e.g. 20260929T084900Z. */
export function fileStemFor(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "");
}

export function serializeMarker(): string {
  return `${JSON.stringify({ format: FORMAT_VERSION })}\n`;
}

// ---------------------------------------------------------------------------
// JSON helpers

type Json = Record<string, unknown>;

function parseObject(text: string): Json {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object.");
  }
  return value as Json;
}

function requiredString(obj: Json, key: string): string {
  const v = obj[key];
  if (typeof v !== "string") throw new Error(`Field "${key}" must be a string.`);
  return v;
}

function optionalString(obj: Json, key: string): string {
  const v = obj[key];
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new Error(`Field "${key}" must be a string.`);
  return v;
}

function stringRecord(obj: Json, key: string): Record<string, string> {
  const v = obj[key];
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v) || Object.values(v).some((x) => typeof x !== "string")) {
    throw new Error(`Field "${key}" must be an object of strings.`);
  }
  return { ...(v as Record<string, string>) };
}

// ---------------------------------------------------------------------------
// Collection JSON

/**
 * Parses collection.json. Badge settings are tolerant (KTD3): a malformed `badge`
 * value or `badgeOverrides` entry is kept raw for the next save and reported as a
 * warning, never an error.
 */
export function parseCollectionWithWarnings(text: string, slug: Slug): { collection: Collection; warnings: string[] } {
  const obj = parseObject(text);
  const order = obj.order ?? [];
  if (!Array.isArray(order) || order.some((s) => typeof s !== "string")) {
    throw new Error('Field "order" must be a list of credential slugs.');
  }
  const codes = obj.codes ?? {};
  if (
    typeof codes !== "object" ||
    codes === null ||
    Array.isArray(codes) ||
    Object.values(codes).some((n) => typeof n !== "number" || !Number.isInteger(n) || n < 1)
  ) {
    throw new Error('Field "codes" must map credential slugs to positive integers.');
  }
  const collection: Collection = {
    slug,
    name: requiredString(obj, "name"),
    description: optionalString(obj, "description"),
    order: [...(order as string[])],
    codes: { ...(codes as Record<string, number>) },
  };
  const warnings: string[] = [];

  if (obj.badge !== undefined) {
    const parsed = parseBadgeSettings(obj.badge);
    if ("settings" in parsed) {
      collection.badge = parsed.settings;
    } else {
      collection.badgeRaw = obj.badge;
      warnings.push(`Field "badge": ${parsed.message}`);
    }
  }

  const overrides = obj.badgeOverrides;
  if (overrides !== undefined) {
    if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
      collection.badgeOverridesRaw = overrides;
      warnings.push('Field "badgeOverrides" must map credential slugs to badge settings.');
    } else {
      const typed: Record<Slug, BadgeSettings> = {};
      const raw: Record<Slug, unknown> = {};
      for (const [key, value] of Object.entries(overrides)) {
        const parsed = parseBadgeSettings(value);
        if ("settings" in parsed) {
          typed[key] = parsed.settings;
        } else {
          raw[key] = value;
          warnings.push(`Field "badgeOverrides.${key}": ${parsed.message}`);
        }
      }
      collection.badgeOverrides = typed;
      if (Object.keys(raw).length > 0) collection.badgeOverrideEntriesRaw = raw;
    }
  }

  return { collection, warnings };
}

export function parseCollection(text: string, slug: Slug): Collection {
  return parseCollectionWithWarnings(text, slug).collection;
}

export function serializeCollection(collection: Collection): string {
  const { name, description, order, codes } = collection;
  const out: Json = { name, description, order, codes };

  // A malformed value was never replaced by a typed one, so it goes back as it came.
  const badge = collection.badge !== undefined ? collection.badge : collection.badgeRaw;
  if (badge !== undefined) out.badge = badge;

  if (collection.badgeOverrides === undefined && collection.badgeOverridesRaw !== undefined) {
    out.badgeOverrides = collection.badgeOverridesRaw;
  } else {
    // Typed entries first, then malformed entries no typed value has replaced.
    const entries: Json = { ...(collection.badgeOverrides ?? {}) };
    for (const [key, value] of Object.entries(collection.badgeOverrideEntriesRaw ?? {})) {
      if (!(key in entries)) entries[key] = value;
    }
    if (Object.keys(entries).length > 0) out.badgeOverrides = entries;
  }

  return `${JSON.stringify(out, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Profile JSON

export function parseProfile(text: string, slug: Slug): AgentProfile {
  const obj = parseObject(text);
  return {
    slug,
    name: requiredString(obj, "name"),
    harness: optionalString(obj, "harness"),
    model: optionalString(obj, "model"),
    effort: optionalString(obj, "effort"),
    repo: optionalString(obj, "repo"),
    notes: optionalString(obj, "notes"),
    params: stringRecord(obj, "params"),
  };
}

export function serializeProfile(profile: AgentProfile): string {
  const { name, harness, model, effort, repo, notes, params } = profile;
  return `${JSON.stringify({ name, harness, model, effort, repo, notes, params }, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Go-to mark JSON: the agent's slug and the marked result's file stem (KTD1).

export function parseMark(text: string, ids: Pick<Mark, "collectionSlug" | "credentialSlug" | "id">): Mark {
  const obj = parseObject(text);
  return { ...ids, profileSlug: requiredString(obj, "agent"), fileStem: requiredString(obj, "result") };
}

export function serializeMark(mark: Mark): string {
  return `${JSON.stringify({ agent: mark.profileSlug, result: mark.fileStem }, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Assessment Markdown: YAML frontmatter, then `## Note` and `## Handback`.
// The hand-back is everything after the first `## Handback` line following the
// note, minus the one blank line and one final newline the serializer adds.

const NOTE_HEADING = "## Note";
const HANDBACK_HEADING = "## Handback";

export type AssessmentIds = Pick<Assessment, "profileSlug" | "collectionSlug" | "credentialSlug" | "fileStem">;

export function serializeAssessment(a: Assessment): string {
  const front = YAML.stringify({
    result: a.result,
    recorded_at: a.recordedAt,
    assignment_version: a.assignmentVersion,
    setup: { harness: a.setup.harness, model: a.setup.model, effort: a.setup.effort },
    ...(a.context
      ? {
          context: {
            machine_id: a.context.machineId,
            machine: a.context.machine,
            memory: a.context.memory,
            captured_at: a.context.capturedAt,
          },
        }
      : {}),
    ...(a.handoff ? { handoff: { id: a.handoff.id, text: a.handoff.text } } : {}),
    ...(a.jev ? { jev: serializeJev(a.jev) } : {}),
  });
  const note = a.note.replace(/\r\n?/g, "\n").trim();
  return [
    "---\n",
    front,
    "---\n\n",
    `${NOTE_HEADING}\n\n`,
    note === "" ? "" : `${note}\n\n`,
    `${HANDBACK_HEADING}\n\n`,
    a.handBack,
    "\n",
  ].join("");
}

/** The `jev` mapping. The verdict fields are written only for a reading seen after the verdict. */
function serializeJev(r: JevReading): Json {
  return {
    model: r.model,
    assignment_version: r.assignmentVersion,
    asked_at: r.askedAt,
    seen: r.seen,
    ...(r.seen === "after" ? { verdict_when_seen: r.verdictWhenSeen, verdict_changed: r.verdictChanged } : {}),
    overall: r.overall,
    points: r.points.map((p) => ({ text: p.text, probability: p.probability })),
  };
}

function setupString(obj: Json, key: string): string {
  const v = obj[key];
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  throw new Error(`Frontmatter "setup.${key}" must be text.`);
}

/**
 * The optional `context` mapping. Anything malformed reads as no context rather than
 * failing the file, so a hand edit can't turn a result into a load error (KTD5).
 */
function parseContext(raw: unknown): TestContext | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const obj = raw as Json;
  const captured = obj.captured_at;
  const context = {
    machineId: obj.machine_id,
    machine: obj.machine,
    memory: obj.memory,
    capturedAt: captured instanceof Date ? captured.toISOString() : captured,
  };
  return isTestContext(context) ? context : undefined;
}

/**
 * The optional `handoff` mapping. Anything malformed reads as no handoff rather than
 * failing the file (KTD4). An id YAML took as a number reads as text.
 */
function parseHandoff(raw: unknown): Assessment["handoff"] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const { id, text } = raw as Json;
  const idText = typeof id === "number" ? String(id) : id;
  if (typeof idText !== "string" || idText === "" || typeof text !== "string") return undefined;
  return { id: idText, text };
}

/** Non-empty text, with a YAML number read as text. Anything else is null. */
function jevText(v: unknown): string | null {
  const text = typeof v === "number" ? String(v) : v;
  return typeof text === "string" && text !== "" ? text : null;
}

/**
 * The optional `jev` mapping. Anything malformed reads as no reading rather than failing
 * the file (KTD12). Verdict fields on a reading seen before the verdict are ignored.
 */
function parseJev(raw: unknown): JevReading | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const obj = raw as Json;
  const model = jevText(obj.model);
  const version = jevText(obj.assignment_version);
  const asked = obj.asked_at;
  const askedAt = asked instanceof Date ? asked.toISOString() : asked;
  if (model === null || version === null || typeof askedAt !== "string" || askedAt === "") return undefined;
  if (!isProbability(obj.overall) || !Array.isArray(obj.points)) return undefined;

  const points: JevPoint[] = [];
  for (const p of obj.points as unknown[]) {
    if (typeof p !== "object" || p === null || Array.isArray(p)) return undefined;
    const { text, probability } = p as Json;
    if (typeof text !== "string" || !isProbability(probability)) return undefined;
    points.push({ text, probability });
  }

  const base = { model, assignmentVersion: version, askedAt, overall: obj.overall, points };
  if (obj.seen === "before") return { ...base, seen: "before" };
  if (obj.seen !== "after") return undefined;
  const verdict = obj.verdict_when_seen;
  if ((verdict !== "met" && verdict !== "not_met") || typeof obj.verdict_changed !== "boolean") return undefined;
  return { ...base, seen: "after", verdictWhenSeen: verdict, verdictChanged: obj.verdict_changed };
}

export function parseAssessment(text: string, ids: AssessmentIds): Assessment {
  const open = /^---[ \t]*\r?\n/.exec(text);
  if (!open) throw new Error("Assessment file has no YAML frontmatter (expected it to start with ---).");
  const rest = text.slice(open[0].length);
  const close = /^---[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!close) throw new Error("Assessment frontmatter is not closed with ---.");

  const front: unknown = YAML.parse(rest.slice(0, close.index));
  if (typeof front !== "object" || front === null || Array.isArray(front)) {
    throw new Error("Assessment frontmatter must be a YAML mapping.");
  }
  const fm = front as Json;

  const result = fm.result;
  if (result !== "met" && result !== "not_met") {
    throw new Error('Frontmatter "result" must be "met" or "not_met".');
  }
  const recorded = fm.recorded_at;
  const recordedAt =
    recorded instanceof Date ? recorded.toISOString() : typeof recorded === "string" ? recorded : null;
  if (recordedAt === null) throw new Error('Frontmatter "recorded_at" must be an ISO time.');
  const version = fm.assignment_version;
  if (typeof version !== "string" && typeof version !== "number") {
    throw new Error('Frontmatter "assignment_version" must be text.');
  }
  const setupRaw = fm.setup ?? {};
  if (typeof setupRaw !== "object" || setupRaw === null || Array.isArray(setupRaw)) {
    throw new Error('Frontmatter "setup" must be a mapping of harness, model and effort.');
  }
  const setup: AgentSetup = {
    harness: setupString(setupRaw as Json, "harness"),
    model: setupString(setupRaw as Json, "model"),
    effort: setupString(setupRaw as Json, "effort"),
  };

  const body = rest.slice(close.index + close[0].length);
  const noteMatch = /^## Note[ \t]*\r?$/m.exec(body);
  const afterNoteStart = noteMatch ? noteMatch.index + noteMatch[0].length : 0;
  const handMatch = /^## Handback[ \t]*\r?$/m.exec(body.slice(afterNoteStart));

  let note: string;
  let handBack: string;
  if (handMatch) {
    const handStart = afterNoteStart + handMatch.index;
    note = body.slice(afterNoteStart, handStart);
    handBack = body.slice(handStart + handMatch[0].length);
    // Drop the heading's line break, the one blank line after it and the final newline.
    handBack = handBack.replace(/^\n(?:\r?\n)?/, "").replace(/\r?\n$/, "");
  } else {
    note = body.slice(afterNoteStart);
    handBack = "";
  }

  const context = parseContext(fm.context);
  const handoff = parseHandoff(fm.handoff);
  const jev = parseJev(fm.jev);
  return {
    ...ids,
    result: result as AssessmentResult,
    recordedAt,
    assignmentVersion: String(version),
    setup,
    note: note.replace(/\r\n?/g, "\n").trim(),
    handBack,
    ...(context ? { context } : {}),
    ...(handoff ? { handoff } : {}),
    ...(jev ? { jev } : {}),
  };
}

// ---------------------------------------------------------------------------
// Load

/** Editor backups, hidden files and atomic-write temp files. */
function isIgnoredName(name: string): boolean {
  return (
    name.startsWith(".") ||
    name.startsWith("~") ||
    name.endsWith("~") ||
    /\.(tmp|temp|swp|swx|bak)$/i.test(name) ||
    /\.tmp[-.]/i.test(name)
  );
}

function stem(name: string, ext: ".md" | ".json"): string | null {
  if (isIgnoredName(name) || !name.endsWith(ext)) return null;
  const s = name.slice(0, -ext.length);
  return s === "" ? null : s;
}

function byName<T extends { name: string; slug: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug);
}

type BadgeFile = Pick<Handoff, "collectionSlug" | "credentialSlug" | "id">;

/** By collection, then credential, then id: stems are stamps, so ids sort in creation order (KTD3). */
function byBadgeThenId(a: BadgeFile, b: BadgeFile): number {
  return compare(a.collectionSlug, b.collectionSlug) || compare(a.credentialSlug, b.credentialSlug) || compare(a.id, b.id);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reads the whole folder. Unreadable files land in `errors` and are never written. */
export async function loadFolder(storage: Storage): Promise<FolderState> {
  const state: FolderState = {
    collections: [],
    credentials: [],
    profiles: [],
    assessments: [],
    skeleton: null,
    handoffs: [],
    marks: [],
    errors: [],
    warnings: [],
    raw: {},
  };
  const errors: LoadError[] = state.errors;

  const marker = await storage.readText("data", MARKER_PATH);
  if (marker === null) {
    const text = serializeMarker();
    await storage.writeText("data", MARKER_PATH, text);
    state.raw[MARKER_PATH] = text;
  } else {
    state.raw[MARKER_PATH] = marker;
  }

  /** Reads and parses one file; records the raw text on success and the error otherwise. */
  async function load<T>(path: string, parse: (text: string) => T): Promise<T | null> {
    try {
      const text = await storage.readText("data", path);
      if (text === null) return null; // Vanished between list and read.
      const value = parse(text);
      state.raw[path] = text;
      return value;
    } catch (err) {
      errors.push({ path, message: message(err) });
      return null;
    }
  }

  // Collections and credentials.
  const collectionFiles = new Map<Slug, string>();
  const credentialFiles = new Map<Slug, { slug: Slug; path: string }[]>();
  const handoffFiles: (BadgeFile & { path: string })[] = [];
  const markFiles: (BadgeFile & { path: string })[] = [];
  for (const path of await storage.listFiles("data", COLLECTIONS_DIR)) {
    const parts = path.split("/");
    if (parts.length === 3 && parts[2] === "collection.json" && !isIgnoredName(parts[1])) {
      collectionFiles.set(parts[1], path);
    } else if (parts.length === 4 && parts[2] === "credentials" && !isIgnoredName(parts[1])) {
      const slug = stem(parts[3], ".md");
      if (slug === null) continue;
      const list = credentialFiles.get(parts[1]) ?? [];
      list.push({ slug, path });
      credentialFiles.set(parts[1], list);
    } else if (parts.length === 5 && parts[2] === "handoffs" && !isIgnoredName(parts[1]) && !isIgnoredName(parts[3])) {
      const id = stem(parts[4], ".md");
      if (id !== null) handoffFiles.push({ collectionSlug: parts[1], credentialSlug: parts[3], id, path });
    } else if (parts.length === 5 && parts[2] === "marks" && !isIgnoredName(parts[1]) && !isIgnoredName(parts[3])) {
      const id = stem(parts[4], ".json");
      if (id !== null) markFiles.push({ collectionSlug: parts[1], credentialSlug: parts[3], id, path });
    }
  }

  const collectionSlugs = [...new Set([...collectionFiles.keys(), ...credentialFiles.keys()])];
  const collections: Collection[] = [];
  for (const slug of collectionSlugs) {
    const path = collectionFiles.get(slug);
    const parsed = path
      ? await load(path, (t) => {
          const { collection, warnings } = parseCollectionWithWarnings(t, slug);
          for (const message of warnings) state.warnings.push({ path, message });
          return collection;
        })
      : null;
    // A missing or unreadable collection.json still lets its credentials load.
    collections.push(parsed ?? { slug, name: slug, description: "", order: [], codes: {} });
  }
  collections.sort(byName);

  for (const collection of collections) {
    const loaded: Credential[] = [];
    for (const { slug, path } of credentialFiles.get(collection.slug) ?? []) {
      const c = await load(path, (t) => parseCredentialMd(t, { slug, collectionSlug: collection.slug }));
      if (c) loaded.push(c);
    }
    const bySlug = new Map(loaded.map((c) => [c.slug, c]));
    const ordered = collection.order.filter((s, i, all) => bySlug.has(s) && all.indexOf(s) === i).map((s) => bySlug.get(s)!);
    const listed = new Set(ordered.map((c) => c.slug));
    ordered.push(...loaded.filter((c) => !listed.has(c.slug)).sort(byName));

    collection.order = ordered.map((c) => c.slug);
    let next = Math.max(0, ...Object.values(collection.codes)) + 1;
    for (const c of ordered) {
      if (!(c.slug in collection.codes)) collection.codes[c.slug] = next++;
    }
    state.credentials.push(...ordered);
  }
  state.collections = collections;

  // Handoffs (KTD1): template text, verbatim. A file that cannot be read lands in errors.
  state.skeleton = await load(SKELETON_PATH, (t) => t);
  for (const { path, ...ids } of handoffFiles) {
    const text = await load(path, (t) => t);
    if (text !== null) state.handoffs.push({ ...ids, text });
  }
  state.handoffs.sort(byBadgeThenId);

  // Go-to marks (KTD1). One that cannot be read lands in errors and is skipped, as a result is.
  for (const { path, ...ids } of markFiles) {
    const mark = await load(path, (t) => parseMark(t, ids));
    if (mark) state.marks.push(mark);
  }
  state.marks.sort(byBadgeThenId);

  // Agent profiles.
  for (const path of await storage.listFiles("data", AGENTS_DIR)) {
    const parts = path.split("/");
    if (parts.length !== 2) continue;
    const slug = stem(parts[1], ".json");
    if (slug === null) continue;
    const p = await load(path, (t) => parseProfile(t, slug));
    if (p) state.profiles.push(p);
  }
  state.profiles.sort(byName);

  // Assessments.
  for (const path of await storage.listFiles("data", ASSESSMENTS_DIR)) {
    const parts = path.split("/");
    if (parts.length !== 5 || parts.slice(1, 4).some(isIgnoredName)) continue;
    const fileStem = stem(parts[4], ".md");
    if (fileStem === null) continue;
    const ids: AssessmentIds = { profileSlug: parts[1], collectionSlug: parts[2], credentialSlug: parts[3], fileStem };
    const a = await load(path, (t) => parseAssessment(t, ids));
    if (a) state.assessments.push(a);
  }

  return state;
}

// ---------------------------------------------------------------------------
// Save

/**
 * Writes `contents` only if the file still holds `baseText`, the text the caller
 * opened it with (null: the file must not exist yet). Otherwise throws
 * ChangedOnDiskError and writes nothing (KTD6).
 */
export async function saveText(storage: Storage, path: string, contents: string, baseText: string | null): Promise<void> {
  const current = await storage.readText("data", path);
  if (current !== baseText) throw new ChangedOnDiskError(path);
  await storage.writeText("data", path, contents);
}

export function saveCredential(storage: Storage, credential: Credential, baseText: string | null): Promise<void> {
  return saveText(storage, credentialPath(credential.collectionSlug, credential.slug), serializeCredentialMd(credential), baseText);
}

export function saveCollection(storage: Storage, collection: Collection, baseText: string | null): Promise<void> {
  return saveText(storage, collectionPath(collection.slug), serializeCollection(collection), baseText);
}

export function saveProfile(storage: Storage, profile: AgentProfile, baseText: string | null): Promise<void> {
  return saveText(storage, profilePath(profile.slug), serializeProfile(profile), baseText);
}

/** Assessments are always new files. */
export function saveAssessment(storage: Storage, assessment: Assessment): Promise<void> {
  const path = assessmentPath(assessment.profileSlug, assessment.collectionSlug, assessment.credentialSlug, assessment.fileStem);
  return saveText(storage, path, serializeAssessment(assessment), null);
}
