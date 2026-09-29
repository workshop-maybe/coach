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
