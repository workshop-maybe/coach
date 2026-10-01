// Domain types for Andamio Desktop. Every entity's id is its filename slug (KTD3):
// set once at creation and never changed, so renaming never breaks references.

import type { BadgeSettings } from "../badge/settings";

export type Slug = string;

/** A named group of credentials. Exports as an Andamio course. */
export interface Collection {
  slug: Slug;
  name: string;
  description: string;
  /** Credential slugs in display order. */
  order: Slug[];
  /** Stable Andamio module code per credential slug (KTD7). Never reused. */
  codes: Record<Slug, number>;
  /** Badge settings for every credential in the collection (KTD3). */
  badge?: BadgeSettings;
  /** Per-credential badge overrides, keyed by credential slug (KTD3). */
  badgeOverrides?: Record<Slug, BadgeSettings>;
  /** A malformed `badge` value, written back unchanged on every save. */
  badgeRaw?: unknown;
  /** A `badgeOverrides` value that is not an object, written back unchanged. */
  badgeOverridesRaw?: unknown;
  /** Malformed `badgeOverrides` entries by slug, written back unchanged. */
  badgeOverrideEntriesRaw?: Record<Slug, unknown>;
}

/** An extra H2 section kept verbatim so hand edits survive a save (KTD4). */
export interface ExtraSection {
  heading: string;
  body: string;
}

/** Learning targets plus one assignment. Exports as an Andamio module. */
export interface Credential {
  slug: Slug;
  collectionSlug: Slug;
  name: string;
  learningTargets: string[];
  /** What the agent is asked to do. Goes into the test prompt. */
  task: string;
  /** What good looks like. Never goes into the test prompt (R11). */
  rubric: string;
  extraSections: ExtraSection[];
}

/** The fields that lock once a profile has a result (R6). */
export interface AgentSetup {
  harness: string;
  model: string;
  effort: string;
}

export interface AgentProfile extends AgentSetup {
  slug: Slug;
  name: string;
  repo: string;
  notes: string;
  params: Record<string, string>;
}

/** Recorded as `memory` when the harness's memory could not be read. */
export const MEMORY_NOT_READ = "not-read";

/** What the native side reports about this machine and the agent's memory (R1). */
export interface ContextReading {
  /** Stable per machine, kept outside the data folder. Comparisons use this. */
  machineId: string;
  /** The name people know the machine by. For display only. */
  machine: string;
  /** A 12-hex fingerprint of the memory and instruction files, or MEMORY_NOT_READ. */
  memory: string;
}

/** The context a test started with, taken when its prompt was copied (KTD5). */
export interface TestContext extends ContextReading {
  /** Full ISO 8601 time of the copy. Earlier-or-later compares on this. */
  capturedAt: string;
}

export type AssessmentResult = "met" | "not_met";

export interface Assessment {
  profileSlug: Slug;
  collectionSlug: Slug;
  credentialSlug: Slug;
  /** Filename stem, a Windows-safe UTC stamp such as 20260929T084900Z. */
  fileStem: string;
  result: AssessmentResult;
  /** Full ISO 8601 time. "Latest" sorts on this. */
  recordedAt: string;
  /** Assignment version at record time (KTD5). */
  assignmentVersion: string;
  /** Profile setup at record time (R16). */
  setup: AgentSetup;
  note: string;
  /** The agent's reply, pasted verbatim. Never parsed (KTD8). */
  handBack: string;
  /** The context the test started with. Absent when none was captured. */
  context?: TestContext;
  /** The handoff that ran: its id and the filled text as copied (KTD4). Absent means the skeleton. */
  handoff?: HandoffTemplate;
}

/** A handoff's identity and template text. The skeleton's id is SKELETON_ID (KTD3). */
export interface HandoffTemplate {
  /** The file stem, or "skeleton". */
  id: string;
  /** The template, verbatim from its file. */
  text: string;
}

/** One of a badge's handoffs, read from collections/<collection>/handoffs/<credential>/<stem>.md (KTD1). */
export interface Handoff extends HandoffTemplate {
  collectionSlug: Slug;
  credentialSlug: Slug;
}

/** A file the app could not read. The app reports it and never rewrites it (R22). */
export interface LoadError {
  path: string;
  message: string;
}

/** Everything loaded from the data folder. */
export interface FolderState {
  collections: Collection[];
  credentials: Credential[];
  profiles: AgentProfile[];
  assessments: Assessment[];
  /** The edited skeleton's text, or null when the folder has none and the built-in one applies (KTD1). */
  skeleton: string | null;
  /** Every badge's handoffs, by collection, credential, then id (creation order). */
  handoffs: Handoff[];
  errors: LoadError[];
  /** Readable files with settings that fall back to defaults (KTD3). Never gate anything. */
  warnings: LoadError[];
  /** Raw text each entity was read from, keyed by folder-relative path (KTD6). */
  raw: Record<string, string>;
}

/** Stable key for a credential across collections. */
export function credentialKey(c: { collectionSlug: Slug; slug: Slug } | { collectionSlug: Slug; credentialSlug: Slug }): string {
  const slug = "slug" in c ? c.slug : c.credentialSlug;
  return `${c.collectionSlug}/${slug}`;
}

/** Inverse of credentialKey: splits `collection/slug` at the first slash. */
export function parseCredentialKey(key: string): { collectionSlug: Slug; slug: Slug } {
  const i = key.indexOf("/");
  return { collectionSlug: key.slice(0, i), slug: key.slice(i + 1) };
}
