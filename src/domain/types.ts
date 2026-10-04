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
  /** Jev's second opinion on this reply (KTD12). Absent when none was asked or it was dropped. */
  jev?: JevReading;
  /** On a Not met result, the rubric points the user said the reply missed, in rubric order. Absent when none were tapped. */
  missedPoints?: string[];
}

/**
 * A reply the user saved without a verdict, to judge later beside other agents' replies
 * (hold-and-compare KTD1, KTD2). Read from assessments/<agent>/<collection>/<credential>/held/<stem>.md.
 * It is not a result: it holds no badge. Judging it writes a result under the same stem and
 * time, and from then on the folder no longer lists it as held (KTD3, KTD4).
 */
export interface HeldReply {
  profileSlug: Slug;
  collectionSlug: Slug;
  credentialSlug: Slug;
  /** Filename stem, a stamp. The result it becomes takes the same stem. */
  fileStem: string;
  /** Full ISO 8601 time the reply was held. The result it becomes is recorded at this time. */
  heldAt: string;
  /** Assignment version at hold time. */
  assignmentVersion: string;
  /** Profile setup at hold time. */
  setup: AgentSetup;
  /** The agent's reply, pasted verbatim. */
  handBack: string;
  context?: TestContext;
  handoff?: HandoffTemplate;
  /** Jev's reading, taken before the reply was held. Always seen "before" the verdict. */
  jev?: JevReading;
}

/** A handoff's identity and template text. The skeleton's id is SKELETON_ID (KTD3). */
export interface HandoffTemplate {
  /** The file stem, or "skeleton". */
  id: string;
  /** The template, verbatim from its file. */
  text: string;
}

/** One rubric point or learning target as Jev read it. The text is stored so the reading outlives badge edits. */
export interface JevPoint {
  text: string;
  /** From 0 to 1. */
  probability: number;
}

/** Jev's reading of one reply against one assignment version (KTD11, KTD12). */
export interface JevReading {
  model: string;
  /** The assignment version the reading was taken against. */
  assignmentVersion: string;
  /** Full ISO 8601 time of the ask. */
  askedAt: string;
  /** Whether the user saw the reading before or after picking a verdict (R13). */
  seen: "before" | "after";
  /** The verdict picked when the reading arrived. Only when seen "after". */
  verdictWhenSeen?: AssessmentResult;
  /** Whether the saved verdict differs from verdictWhenSeen. Only when seen "after". */
  verdictChanged?: boolean;
  /** The reading for the whole rubric, from 0 to 1. */
  overall: number;
  /** One per rubric point, in rubric order. Empty when the rubric has no list. */
  points: JevPoint[];
  /** One per learning target asked, in order, read as points are. Absent when none was asked. */
  targets?: JevPoint[];
  /** How many distinct earlier replies the ask quoted. Absent on a reading taken before asks quoted any. */
  examplesSent?: number;
}

/** One of a badge's handoffs, read from collections/<collection>/handoffs/<credential>/<stem>.md (KTD1). */
export interface Handoff extends HandoffTemplate {
  collectionSlug: Slug;
  credentialSlug: Slug;
}

/**
 * A go-to mark: the user chose this agent for a badge on one of its Met results. Read from
 * collections/<collection>/marks/<credential>/<id>.json, a new file per mark, so every choice
 * and confirmation stays in the record and no result file ever changes.
 */
export interface Mark {
  collectionSlug: Slug;
  credentialSlug: Slug;
  /** The file stem, a stamp. A badge's marks order by it, the newest last. */
  id: string;
  /** The agent the mark chose. */
  profileSlug: Slug;
  /** The file stem of the result the mark was made on. */
  fileStem: string;
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
  /** Replies still held, by collection, credential, agent, then stem. A judged one is left out. */
  held: HeldReply[];
  /** The edited skeleton's text, or null when the folder has none and the built-in one applies (KTD1). */
  skeleton: string | null;
  /** Every badge's handoffs, by collection, credential, then id (creation order). */
  handoffs: Handoff[];
  /** Every badge's go-to marks, by collection, credential, then id (oldest first). */
  marks: Mark[];
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
