// The data folder format (KTD3, KTD4, KTD6, KTD7): paths, per-entity parse and
// serialize, a whole-folder load that reports unreadable files by path, and saves
// that refuse to overwrite a file changed since it was opened.

import YAML from "yaml";
import { parseBadgeSettings, type BadgeSettings } from "../badge/settings";
import { ChangedOnDiskError, type Storage } from "../storage/storage";
import { parseCredentialMd, serializeCredentialMd } from "./credential-md";
import { isTestContext } from "./context";
import { isProbability } from "./jevRequest";
import { chooseBreak, isBreakLine, isItemRef, isOneText, joinSlots, splitSlots, textOf, type ReplyRecord } from "./replyItems";
import type {
  AgentProfile,
  AgentSetup,
  Assessment,
  AssessmentResult,
  Collection,
  Credential,
  FolderState,
  Handoff,
  HeadToHead,
  HeadToHeadPoint,
  HeldReading,
  HeldReply,
  JevPoint,
  JevReading,
  LoadError,
  Mark,
  Rejudge,
  ReplyRef,
  ReplyItem,
  RoutingRecord,
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

/** The folder name, inside an agent's results for a badge, that holds its re-judges. */
const REJUDGED_DIR = "rejudged";

/**
 * One agent's re-judges on one badge (jev-in-compare KTD1): one folder below the results they
 * re-judge, like held replies, so older app versions skip them and both trash actions move them.
 */
export function rejudgedDir(profileSlug: Slug, collectionSlug: Slug, credentialSlug: Slug): string {
  return `${assessmentDir(profileSlug, collectionSlug, credentialSlug)}/${REJUDGED_DIR}`;
}

/** Where a re-judge with this id (a stamp) saves. */
export function rejudgedPath(profileSlug: Slug, collectionSlug: Slug, credentialSlug: Slug, id: string): string {
  return `${rejudgedDir(profileSlug, collectionSlug, credentialSlug)}/${id}.md`;
}

/** The folder name, inside an agent's results for a badge, that holds readings of its held replies. */
const READINGS_DIR = "readings";

/** One agent's readings of its held replies on one badge (jev-in-compare KTD3), placed as re-judges are. */
export function readingsDir(profileSlug: Slug, collectionSlug: Slug, credentialSlug: Slug): string {
  return `${assessmentDir(profileSlug, collectionSlug, credentialSlug)}/${READINGS_DIR}`;
}

/** Where a held reply's reading with this id (a stamp) saves. */
export function heldReadingPath(profileSlug: Slug, collectionSlug: Slug, credentialSlug: Slug, id: string): string {
  return `${readingsDir(profileSlug, collectionSlug, credentialSlug)}/${id}.json`;
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

/**
 * Every head-to-head file for one badge, parsed or not (jev-in-compare KTD4). Kept with the
 * badge beside its marks, since each names two agents, so trashing an agent leaves them.
 */
export function headToHeadDir(collectionSlug: Slug, credentialSlug: Slug): string {
  return `${COLLECTIONS_DIR}/${collectionSlug}/head-to-head/${credentialSlug}`;
}

/** Where a head-to-head with this id (a stamp) saves. */
export function headToHeadPath(collectionSlug: Slug, credentialSlug: Slug, id: string): string {
  return `${headToHeadDir(collectionSlug, credentialSlug)}/${id}.json`;
}

/** The order the user set over their agents, cheapest first (router KTD9). At the root, since every JSON file in agents/ is a profile. */
export const COST_ORDER_PATH = "cost-order.json";

/** Every time the user took an agent for a job, one file each, named for when (router KTD10). Neither trash moves it. */
export const ROUTING_DIR = "routing";

export function routingPath(id: string): string {
  return `${ROUTING_DIR}/${id}.json`;
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

/** A required string that is not empty, such as a file stem or a model id. */
function requiredText(obj: Json, key: string): string {
  const v = requiredString(obj, key);
  if (v === "") throw new Error(`Field "${key}" must not be empty.`);
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
  const from = optionalString(obj, "from");
  if (from) collection.from = from;
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
  if (collection.from !== undefined) out.from = collection.from;

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
// Cost order JSON: agent slugs, cheapest first (router KTD9). Repeats are kept once.

export function parseCostOrder(text: string): Slug[] {
  const agents = parseObject(text).agents;
  if (!Array.isArray(agents) || agents.some((a) => typeof a !== "string")) {
    throw new Error('Field "agents" must be a list of agent names.');
  }
  return [...new Set(agents as string[])];
}

export function serializeCostOrder(slugs: readonly Slug[]): string {
  return `${JSON.stringify({ agents: [...new Set(slugs)] }, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Routing record JSON (router KTD10). Written once; the app does not read it back yet.

export function serializeRoutingRecord(record: RoutingRecord): string {
  const { harness, model, effort } = record.setup;
  const body = {
    job: record.job,
    collection: record.collectionSlug,
    credential: record.credentialSlug,
    agent: record.profileSlug,
    setup: { harness, model, effort },
    recommended: record.recommended,
    basis: record.basis,
    steppedUp: record.steppedUp,
    matched: record.matched,
    ...(record.difficulty ? { difficulty: record.difficulty } : {}),
    ...(record.jevModel ? { jevModel: record.jevModel } : {}),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Assessment Markdown: YAML frontmatter, then `## Note` and `## Handback`.
// The hand-back is everything after the first `## Handback` line following the
// note, minus the one blank line and one final newline the serializer adds. A reply
// with items other than one text item lists them in front matter, and its text items
// fill that body between break lines (reply-artifacts KTD1).

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

/**
 * A reply's front matter fields and the `## Handback` body (reply-artifacts KTD1). A reply of
 * exactly one text item writes no fields and its text as the body, byte for byte as before items.
 * Any other writes its items, each text item as a bare slot, and the text slots fill the body in
 * order with a break line between them. The break is chosen here, so it is the one the body uses.
 */
function replyParts(r: ReplyRecord): { fields: Json; body: string } {
  const items = r.items;
  if (!items) return { fields: {}, body: r.handBack };
  if (isOneText(items)) return { fields: {}, body: items[0].text };
  const texts = items.flatMap((item) => (item.kind === "text" ? [item.text] : []));
  const itemBreak = chooseBreak(texts);
  return { fields: { item_break: itemBreak, items: items.map(itemEntry) }, body: joinSlots(texts, itemBreak) };
}

/** One `items` entry. A text item is only its kind: its text is a slot in the body. */
function itemEntry(item: ReplyItem): Json {
  switch (item.kind) {
    case "text":
      return { kind: "text" };
    case "link":
      return { kind: "link", url: item.url };
    default:
      return { kind: item.kind, name: item.name, ref: item.ref };
  }
}

export function serializeAssessment(a: Assessment): string {
  const reply = replyParts(a);
  const front = YAML.stringify({
    result: a.result,
    recorded_at: a.recordedAt,
    ...testFields(a),
    ...reply.fields,
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
    reply.body,
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

/**
 * The optional `items` list, each text item with an empty slot. Null when it is not a non-empty
 * list of known kinds with their fields, or when a file names a ref outside its place (KTD2).
 * A name YAML took as a number reads as text.
 */
function parseItemEntries(raw: unknown): ReplyItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const items: ReplyItem[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const { kind, name, ref, url } = entry as Json;
    if (kind === "text") {
      items.push({ kind, text: "" });
    } else if (kind === "link") {
      if (typeof url !== "string" || url === "") return null;
      items.push({ kind, url });
    } else if (kind === "image" || kind === "video" || kind === "file") {
      const display = jevText(name);
      if (display === null || typeof ref !== "string" || !isItemRef(kind, ref)) return null;
      items.push({ kind, name: display, ref });
    } else {
      return null;
    }
  }
  return items;
}

/**
 * A reply from its front matter and its `## Handback` body (reply-artifacts KTD1). With no
 * `items`, the body is one text item, as every reply saved before items was (R12). With them,
 * the body splits at the `item_break` line into one slot per text item. Anything malformed,
 * including a slot count that does not match, reads as no items: the whole body is one text
 * item, never a load error, as `parseContext` and `parseJev` read theirs.
 */
function parseReply(fm: Json, body: string): ReplyRecord {
  const asOneText = { handBack: body };
  const slots = parseItemEntries(fm.items);
  if (slots === null) return asOneText;
  const textCount = slots.filter((s) => s.kind === "text").length;
  const itemBreak = fm.item_break;
  const texts = typeof itemBreak === "string" && isBreakLine(itemBreak) ? splitSlots(body, itemBreak) : [body];
  if (textCount === 0 ? body !== "" : texts.length !== textCount) return asOneText;
  let next = 0;
  const items = slots.map((s): ReplyItem => (s.kind === "text" ? { kind: "text", text: texts[next++] } : s));
  if (isOneText(items)) return { handBack: texts[0] };
  return { handBack: textOf(items), items };
}

/** The required `result` field of a result or a re-judge. */
function verdictOf(fm: Json): AssessmentResult {
  const result = fm.result;
  if (result !== "met" && result !== "not_met") {
    throw new Error('Frontmatter "result" must be "met" or "not_met".');
  }
  return result;
}

/** The optional `missed_points` list. Anything but a non-empty list of text reads as none, never as a load error (KTD14). */
function parseMissedPoints(missed: unknown): string[] | null {
  return Array.isArray(missed) && missed.length > 0 && missed.every((p) => typeof p === "string") ? (missed as string[]) : null;
}

export function parseAssessment(text: string, ids: AssessmentIds): Assessment {
  const { fm, body } = splitFrontMatter(text, "Assessment");

  const result = verdictOf(fm);
  const recordedAt = isoTime(fm, "recorded_at");
  const record = parseTestRecord(fm);
  const missedPoints = parseMissedPoints(fm.missed_points);

  const noteLine = findLine(body, NOTE_LINE);
  const afterNote = body.slice(noteLine ? noteLine.end : 0);
  const handLine = findLine(afterNote, HANDBACK_LINE);
  const note = handLine ? afterNote.slice(0, handLine.start) : afterNote;
  const reply = parseReply(fm, handLine ? handBackAfter(afterNote, handLine.end) : "");

  return {
    ...ids,
    result,
    recordedAt,
    ...record,
    ...(missedPoints ? { missedPoints } : {}),
    note: note.replace(/\r\n?/g, "\n").trim(),
    ...reply,
  };
}

// ---------------------------------------------------------------------------
// Held reply Markdown (hold-and-compare KTD2): a result's front matter without a
// verdict, `held_at` in place of `recorded_at`, then `## Handback`. No note.

export function serializeHeld(h: HeldReply): string {
  const reply = replyParts(h);
  const front = YAML.stringify({ held_at: h.heldAt, ...testFields(h), ...reply.fields });
  return ["---\n", front, "---\n\n", `${HANDBACK_HEADING}\n\n`, reply.body, "\n"].join("");
}

/** Parses a held reply. A stray `result` key or a hand-added `## Note` before the reply is ignored. */
export function parseHeld(text: string, ids: AssessmentIds): HeldReply {
  const { fm, body } = splitFrontMatter(text, "Held reply");
  const heldAt = isoTime(fm, "held_at");
  const record = parseTestRecord(fm);
  const handLine = findLine(body, HANDBACK_LINE);
  return { ...ids, heldAt, ...record, ...parseReply(fm, handLine ? handBackAfter(body, handLine.end) : "") };
}

// ---------------------------------------------------------------------------
// Re-judge Markdown (jev-in-compare KTD1): front matter naming the result by its stem, the
// new verdict, its time and any missed points, then `## Note` and the note, which runs to the
// end of the file. No reply: the result keeps it.

export type RejudgeIds = Pick<Rejudge, "profileSlug" | "collectionSlug" | "credentialSlug" | "id">;

export function serializeRejudge(r: Rejudge): string {
  const front = YAML.stringify({
    reply: r.fileStem,
    result: r.result,
    judged_at: r.judgedAt,
    ...(r.missedPoints && r.missedPoints.length > 0 ? { missed_points: r.missedPoints } : {}),
  });
  const note = r.note.replace(/\r\n?/g, "\n").trim();
  return ["---\n", front, "---\n\n", `${NOTE_HEADING}\n`, note === "" ? "" : `\n${note}\n`].join("");
}

/** Parses a re-judge. A missing or malformed reply, verdict or time throws; malformed missed points read as none, as on a result. */
export function parseRejudge(text: string, ids: RejudgeIds): Rejudge {
  const { fm, body } = splitFrontMatter(text, "Re-judge");
  const fileStem = jevText(fm.reply);
  if (fileStem === null) throw new Error('Frontmatter "reply" must be the file stem of the result it re-judges.');
  const result = verdictOf(fm);
  const judgedAt = isoTime(fm, "judged_at");
  const missedPoints = parseMissedPoints(fm.missed_points);
  const noteLine = findLine(body, NOTE_LINE);
  const note = body.slice(noteLine ? noteLine.end : 0);
  return {
    ...ids,
    fileStem,
    result,
    judgedAt,
    note: note.replace(/\r\n?/g, "\n").trim(),
    ...(missedPoints ? { missedPoints } : {}),
  };
}

// ---------------------------------------------------------------------------
// Held reading JSON (jev-in-compare KTD3): the held reply's stem and the reading, written as
// a result's `jev` mapping is.

export type HeldReadingIds = Pick<HeldReading, "profileSlug" | "collectionSlug" | "credentialSlug" | "id">;

export function serializeHeldReading(h: HeldReading): string {
  return `${JSON.stringify({ reply: h.fileStem, jev: serializeJev(h.reading) }, null, 2)}\n`;
}

/** Parses a held reading. A missing reply, or a reading that won't read, throws. */
export function parseHeldReading(text: string, ids: HeldReadingIds): HeldReading {
  const obj = parseObject(text);
  const fileStem = requiredText(obj, "reply");
  const reading = parseJev(obj.jev);
  if (!reading) throw new Error('Field "jev" must be a Jev reading.');
  return { ...ids, fileStem, reading };
}

// ---------------------------------------------------------------------------
// Head-to-head JSON (jev-in-compare KTD4): the model, version and time of the ask, the two
// replies by agent and stem, and each point's raw answers in both orders. Parsed strictly.

export type HeadToHeadIds = Pick<HeadToHead, "collectionSlug" | "credentialSlug" | "id">;

export function serializeHeadToHead(h: HeadToHead): string {
  const out = {
    model: h.model,
    assignment_version: h.assignmentVersion,
    asked_at: h.askedAt,
    first: serializeReplyRef(h.first),
    second: serializeReplyRef(h.second),
    points: h.points.map((p) => ({ text: p.text, first_over: p.firstOver, second_over: p.secondOver })),
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** Parses a head-to-head. A missing field, a point that is not text, or a probability outside 0 to 1 throws. */
export function parseHeadToHead(text: string, ids: HeadToHeadIds): HeadToHead {
  const obj = parseObject(text);
  return {
    ...ids,
    model: requiredText(obj, "model"),
    assignmentVersion: requiredText(obj, "assignment_version"),
    askedAt: requiredText(obj, "asked_at"),
    first: parseReplyRef(obj, "first"),
    second: parseReplyRef(obj, "second"),
    points: parseHeadToHeadPoints(obj.points),
  };
}

function serializeReplyRef(r: ReplyRef): Json {
  return { agent: r.profileSlug, reply: r.fileStem };
}

function parseReplyRef(obj: Json, key: string): ReplyRef {
  const v = obj[key];
  const bad = new Error(`Field "${key}" must name an agent and a reply.`);
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw bad;
  const { agent, reply } = v as Json;
  if (typeof agent !== "string" || agent === "" || typeof reply !== "string" || reply === "") throw bad;
  return { profileSlug: agent, fileStem: reply };
}

function parseHeadToHeadPoints(raw: unknown): HeadToHeadPoint[] {
  const bad = new Error('Field "points" must be a list of texts, each with two probabilities from 0 to 1.');
  if (!Array.isArray(raw)) throw bad;
  return raw.map((p: unknown) => {
    if (typeof p !== "object" || p === null || Array.isArray(p)) throw bad;
    const point = p as Json;
    const firstOver = point.first_over;
    const secondOver = point.second_over;
    if (typeof point.text !== "string" || !isProbability(firstOver) || !isProbability(secondOver)) throw bad;
    return { text: point.text, firstOver, secondOver };
  });
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

type AgentBadgeFile = Pick<HeldReading, "profileSlug" | "collectionSlug" | "credentialSlug" | "id">;

/** By collection, credential, agent, then id. */
function byBadgeAgentId(a: AgentBadgeFile, b: AgentBadgeFile): number {
  return (
    compare(a.collectionSlug, b.collectionSlug) ||
    compare(a.credentialSlug, b.credentialSlug) ||
    compare(a.profileSlug, b.profileSlug) ||
    compare(a.id, b.id)
  );
}

/**
 * Lays each re-judge over the result it names, in place so the results keep their order
 * (jev-in-compare KTD1). A result's re-judges apply oldest first by id: each sets the verdict,
 * note and missed points, and adds the verdict it replaced to `earlierVerdicts`. Everything
 * else stays the result's own: stem, time, reply, setup, context, handoff, version and reading.
 * A re-judge naming no result of its agent on its badge changes nothing.
 */
function layRejudges(results: Assessment[], rejudges: Rejudge[]): void {
  const at = new Map(results.map((a, i) => [assessmentPath(a.profileSlug, a.collectionSlug, a.credentialSlug, a.fileStem), i]));
  for (const r of [...rejudges].sort(byBadgeAgentId)) {
    const i = at.get(assessmentPath(r.profileSlug, r.collectionSlug, r.credentialSlug, r.fileStem));
    if (i === undefined) continue;
    const { missedPoints: _replaced, ...result } = results[i];
    results[i] = {
      ...result,
      result: r.result,
      note: r.note,
      ...(r.missedPoints && r.missedPoints.length > 0 ? { missedPoints: r.missedPoints } : {}),
      earlierVerdicts: [...(result.earlierVerdicts ?? []), result.result],
    };
  }
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
    costOrder: null,
    held: [],
    heldReadings: [],
    headToHeads: [],
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
  const headToHeadFiles: (BadgeFile & { path: string })[] = [];
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
    } else if (parts.length === 5 && parts[2] === "head-to-head" && !isIgnoredName(parts[1]) && !isIgnoredName(parts[3])) {
      const id = stem(parts[4], ".json");
      if (id !== null) headToHeadFiles.push({ collectionSlug: parts[1], credentialSlug: parts[3], id, path });
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

  // Head-to-heads (jev-in-compare KTD4), read as marks are. Whether one is current is decided where it is used.
  for (const { path, ...ids } of headToHeadFiles) {
    const headToHead = await load(path, (t) => parseHeadToHead(t, ids));
    if (headToHead) state.headToHeads.push(headToHead);
  }
  state.headToHeads.sort(byBadgeThenId);

  // The cost order (router KTD9): one file at the root. One that cannot be read lands in
  // errors, reads as no order, and is never written over (R22).
  state.costOrder = await load(COST_ORDER_PATH, parseCostOrder);

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

  // Assessments, and the held replies, re-judges and readings one folder below them
  // (hold-and-compare KTD1, jev-in-compare KTD1 and KTD3).
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

  // Re-judges lay the newest verdict over the result they name, which is never rewritten
  // (jev-in-compare KTD1). One that cannot be read lands in errors and changes nothing.
  const rejudges: Rejudge[] = [];
  for (const path of assessmentFiles) {
    const parts = path.split("/");
    if (parts.length !== 6 || parts[4] !== REJUDGED_DIR || parts.slice(1, 4).some(isIgnoredName)) continue;
    const id = stem(parts[5], ".md");
    if (id === null) continue;
    const ids: RejudgeIds = { profileSlug: parts[1], collectionSlug: parts[2], credentialSlug: parts[3], id };
    const r = await load(path, (t) => parseRejudge(t, ids));
    if (r) rejudges.push(r);
  }
  layRejudges(state.assessments, rejudges);

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

  // Readings taken after a reply was held (jev-in-compare KTD3). Each loads whether its reply is
  // still held, judged or gone: which reading a held reply shows is decided where it is used.
  for (const path of assessmentFiles) {
    const parts = path.split("/");
    if (parts.length !== 6 || parts[4] !== READINGS_DIR || parts.slice(1, 4).some(isIgnoredName)) continue;
    const id = stem(parts[5], ".json");
    if (id === null) continue;
    const ids: HeldReadingIds = { profileSlug: parts[1], collectionSlug: parts[2], credentialSlug: parts[3], id };
    const reading = await load(path, (t) => parseHeldReading(t, ids));
    if (reading) state.heldReadings.push(reading);
  }
  state.heldReadings.sort(byBadgeAgentId);

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
