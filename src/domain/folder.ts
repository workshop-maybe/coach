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
  HeldReply,
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

/** The folder name, inside an agent's results for a badge, that holds its held replies. */
const HELD_DIR = "held";

/**
 * One agent's held replies on one badge (hold-and-compare KTD1): one folder below the results
 * they will join, so the result loader never reads them and both trash actions move them. Their
 * pasted images sit in the results folder above, beside the result each one becomes.
 */
export function heldDir(profileSlug: Slug, collectionSlug: Slug, credentialSlug: Slug): string {
  return `${assessmentDir(profileSlug, collectionSlug, credentialSlug)}/${HELD_DIR}`;
}

export function heldPath(profileSlug: Slug, collectionSlug: Slug, credentialSlug: Slug, fileStem: string): string {
  return `${heldDir(profileSlug, collectionSlug, credentialSlug)}/${fileStem}.md`;
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

/** What a result and a held reply both record about the test that produced the reply. */
type TestRecord = Pick<Assessment, "assignmentVersion" | "setup" | "context" | "handoff" | "jev">;

/** The front matter fields a result and a held reply share, after each one's time field. */
function testFields(r: TestRecord): Json {
  return {
    assignment_version: r.assignmentVersion,
    setup: { harness: r.setup.harness, model: r.setup.model, effort: r.setup.effort },
    ...(r.context
      ? {
          context: {
            machine_id: r.context.machineId,
            machine: r.context.machine,
            memory: r.context.memory,
            captured_at: r.context.capturedAt,
          },
        }
      : {}),
    ...(r.handoff ? { handoff: { id: r.handoff.id, text: r.handoff.text } } : {}),
    ...(r.jev ? { jev: serializeJev(r.jev) } : {}),
  };
}

export function serializeAssessment(a: Assessment): string {
  const front = YAML.stringify({
    result: a.result,
    recorded_at: a.recordedAt,
    ...testFields(a),
    // A result's own: a held reply has no verdict, so it never carries missed points.
    ...(a.missedPoints && a.missedPoints.length > 0 ? { missed_points: a.missedPoints } : {}),
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

/**
 * The `jev` mapping. The verdict fields are written only for a reading seen after the verdict,
 * and `targets` and `examples_sent` only when present, so an older reading writes back as it was.
 */
function serializeJev(r: JevReading): Json {
  return {
    model: r.model,
    assignment_version: r.assignmentVersion,
    asked_at: r.askedAt,
    seen: r.seen,
    ...(r.seen === "after" ? { verdict_when_seen: r.verdictWhenSeen, verdict_changed: r.verdictChanged } : {}),
    overall: r.overall,
    points: serializeJevPoints(r.points),
    ...(r.targets && r.targets.length > 0 ? { targets: serializeJevPoints(r.targets) } : {}),
    ...(r.examplesSent !== undefined ? { examples_sent: r.examplesSent } : {}),
  };
}

function serializeJevPoints(points: JevPoint[]): Json[] {
  return points.map((p) => ({ text: p.text, probability: p.probability }));
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

/** A list of texts with their probabilities, as `points` and `targets` are saved. Null when it is not one. */
function parseJevPoints(raw: unknown): JevPoint[] | null {
  if (!Array.isArray(raw)) return null;
  const points: JevPoint[] = [];
  for (const p of raw as unknown[]) {
    if (typeof p !== "object" || p === null || Array.isArray(p)) return null;
    const { text, probability } = p as Json;
    if (typeof text !== "string" || !isProbability(probability)) return null;
    points.push({ text, probability });
  }
  return points;
}

/**
 * The optional `jev` mapping. Anything malformed reads as no reading rather than failing
 * the file (KTD12). Verdict fields on a reading seen before the verdict are ignored.
 * `targets` and `examples_sent` came later: a malformed one reads as absent and the
 * reading still loads (KTD14).
 */
function parseJev(raw: unknown): JevReading | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const obj = raw as Json;
  const model = jevText(obj.model);
  const version = jevText(obj.assignment_version);
  const asked = obj.asked_at;
  const askedAt = asked instanceof Date ? asked.toISOString() : asked;
  if (model === null || version === null || typeof askedAt !== "string" || askedAt === "") return undefined;
  const points = parseJevPoints(obj.points);
  if (!isProbability(obj.overall) || points === null) return undefined;

  const targets = parseJevPoints(obj.targets);
  const sent = obj.examples_sent;
  const base = {
    model,
    assignmentVersion: version,
    askedAt,
    overall: obj.overall,
    points,
    ...(targets !== null && targets.length > 0 ? { targets } : {}),
    ...(typeof sent === "number" && Number.isInteger(sent) && sent >= 0 ? { examplesSent: sent } : {}),
  };
  if (obj.seen === "before") return { ...base, seen: "before" };
  if (obj.seen !== "after") return undefined;
  const verdict = obj.verdict_when_seen;
  if ((verdict !== "met" && verdict !== "not_met") || typeof obj.verdict_changed !== "boolean") return undefined;
  return { ...base, seen: "after", verdictWhenSeen: verdict, verdictChanged: obj.verdict_changed };
}

// Whole lines, each tested without the "\n" that ends it. A "\r" before the "\n" stays on the
// line, so CRLF files read too.
const CLOSE_LINE = /^---[ \t]*\r?$/;
const NOTE_LINE = /^## Note[ \t]*\r?$/;
const HANDBACK_LINE = /^## Handback[ \t]*\r?$/;

/**
 * The first line of `text` that `line` matches, by where it starts and where its text ends
 * (at its "\n", or the end of the text). Lines end only at "\n" (KTD14): a multiline `^` also
 * starts a line after a lone "\r", U+2028 or U+2029, which YAML writes raw inside a value and a
 * pasted note may hold, so a rubric point could end the front matter early or a note read as a heading.
 */
function findLine(text: string, line: RegExp): { start: number; end: number } | null {
  for (let start = 0; ; ) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    if (line.test(text.slice(start, end))) return { start, end };
    if (newline === -1) return null;
    start = newline + 1;
  }
}

/** Splits a Markdown file into its YAML front matter mapping and the body after it. `kind` names the file in errors. */
function splitFrontMatter(text: string, kind: string): { fm: Json; body: string } {
  const open = /^---[ \t]*\r?\n/.exec(text);
  if (!open) throw new Error(`${kind} file has no YAML frontmatter (expected it to start with ---).`);
  const rest = text.slice(open[0].length);
  const close = findLine(rest, CLOSE_LINE);
  if (!close) throw new Error(`${kind} frontmatter is not closed with ---.`);

  const front: unknown = YAML.parse(rest.slice(0, close.start));
  if (typeof front !== "object" || front === null || Array.isArray(front)) {
    throw new Error(`${kind} frontmatter must be a YAML mapping.`);
  }
  return { fm: front as Json, body: rest.slice(close.end + 1) };
}

/** A required ISO time field. YAML may have read it as a date. */
function isoTime(fm: Json, key: string): string {
  const v = fm[key];
  const time = v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null;
  if (time === null) throw new Error(`Frontmatter "${key}" must be an ISO time.`);
  return time;
}

/** The fields a result and a held reply share. Optional mappings that are malformed read as absent. */
function parseTestRecord(fm: Json): TestRecord {
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
  const context = parseContext(fm.context);
  const handoff = parseHandoff(fm.handoff);
  const jev = parseJev(fm.jev);
  return {
    assignmentVersion: String(version),
    setup,
    ...(context ? { context } : {}),
    ...(handoff ? { handoff } : {}),
    ...(jev ? { jev } : {}),
  };
}

/** The reply after a `## Handback` heading line ending at `end`, minus the blank line and final newline the serializer adds. */
function handBackAfter(text: string, end: number): string {
  return text.slice(end).replace(/^\n(?:\r?\n)?/, "").replace(/\r?\n$/, "");
}

export function parseAssessment(text: string, ids: AssessmentIds): Assessment {
  const { fm, body } = splitFrontMatter(text, "Assessment");

  const result = fm.result;
  if (result !== "met" && result !== "not_met") {
    throw new Error('Frontmatter "result" must be "met" or "not_met".');
  }
  const recordedAt = isoTime(fm, "recorded_at");
  const record = parseTestRecord(fm);
  const missed = fm.missed_points;
  // Anything but a non-empty list of text reads as no missed points, never as a load error (KTD14).
  const missedPoints = Array.isArray(missed) && missed.length > 0 && missed.every((p) => typeof p === "string") ? (missed as string[]) : null;

  const noteLine = findLine(body, NOTE_LINE);
  const afterNote = body.slice(noteLine ? noteLine.end : 0);
  const handLine = findLine(afterNote, HANDBACK_LINE);
  const note = handLine ? afterNote.slice(0, handLine.start) : afterNote;
  const handBack = handLine ? handBackAfter(afterNote, handLine.end) : "";

  return {
    ...ids,
    result: result as AssessmentResult,
    recordedAt,
    ...record,
    ...(missedPoints ? { missedPoints } : {}),
    note: note.replace(/\r\n?/g, "\n").trim(),
    handBack,
  };
}

// ---------------------------------------------------------------------------
// Held reply Markdown (hold-and-compare KTD2): a result's front matter without a
// verdict, `held_at` in place of `recorded_at`, then `## Handback`. No note.

export function serializeHeld(h: HeldReply): string {
  const front = YAML.stringify({ held_at: h.heldAt, ...testFields(h) });
  return ["---\n", front, "---\n\n", `${HANDBACK_HEADING}\n\n`, h.handBack, "\n"].join("");
}

/** Parses a held reply. A stray `result` key or a hand-added `## Note` before the reply is ignored. */
export function parseHeld(text: string, ids: AssessmentIds): HeldReply {
  const { fm, body } = splitFrontMatter(text, "Held reply");
  const heldAt = isoTime(fm, "held_at");
  const record = parseTestRecord(fm);
  const handLine = findLine(body, HANDBACK_LINE);
  return { ...ids, heldAt, ...record, handBack: handLine ? handBackAfter(body, handLine.end) : "" };
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

/** By collection, credential, agent, then stem. */
function byBadgeAgentStem(a: AssessmentIds, b: AssessmentIds): number {
  return (
    compare(a.collectionSlug, b.collectionSlug) ||
    compare(a.credentialSlug, b.credentialSlug) ||
    compare(a.profileSlug, b.profileSlug) ||
    compare(a.fileStem, b.fileStem)
  );
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
    held: [],
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

  // Assessments, and the held replies one folder below them (hold-and-compare KTD1).
  const assessmentFiles = await storage.listFiles("data", ASSESSMENTS_DIR);
  const listed = new Set(assessmentFiles);
  for (const path of assessmentFiles) {
    const parts = path.split("/");
    if (parts.length !== 5 || parts.slice(1, 4).some(isIgnoredName)) continue;
    const fileStem = stem(parts[4], ".md");
    if (fileStem === null) continue;
    const ids: AssessmentIds = { profileSlug: parts[1], collectionSlug: parts[2], credentialSlug: parts[3], fileStem };
    const a = await load(path, (t) => parseAssessment(t, ids));
    if (a) state.assessments.push(a);
  }

  // A held reply is judged once a result file has its stem, whether or not that result
  // parses, and a judged one is never read (KTD4): the held file stays as the record.
  for (const path of assessmentFiles) {
    const parts = path.split("/");
    if (parts.length !== 6 || parts[4] !== HELD_DIR || parts.slice(1, 4).some(isIgnoredName)) continue;
    const fileStem = stem(parts[5], ".md");
    if (fileStem === null) continue;
    const ids: AssessmentIds = { profileSlug: parts[1], collectionSlug: parts[2], credentialSlug: parts[3], fileStem };
    if (listed.has(assessmentPath(ids.profileSlug, ids.collectionSlug, ids.credentialSlug, fileStem))) continue;
    const h = await load(path, (t) => parseHeld(t, ids));
    if (h) state.held.push(h);
  }
  state.held.sort(byBadgeAgentStem);

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
