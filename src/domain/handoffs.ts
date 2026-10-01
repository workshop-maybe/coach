// Handoffs: the prompt that hands a badge's assignment to the agent being tested (R1).
// A handoff is a template that wraps the assignment through three slots and is filled
// from the badge each time it is copied, so it carries the current name, learning
// targets and task (R12). There is no rubric slot, and any other `{{…}}` stays literal
// (KTD2). The built-in skeleton is the test prompt as it read before handoffs.

import { newestFirst } from "./matrix";
import { credentialKey, type Credential, type FolderState, type Handoff, type HandoffTemplate, type Slug } from "./types";

export const SLOTS = {
  name: "{{name}}",
  learningTargets: "{{learning_targets}}",
  task: "{{task}}",
} as const;

const NO_TARGETS = "(No learning targets written yet.)";
const NO_TASK = "(No task written yet.)";

const TEST_INTRO =
  "This is a test. Do the task below as well as you can, and I will review your results. " +
  "Work on your own. Do not ask me questions before you start. If something is unclear, " +
  "make a reasonable choice and say what you chose in your hand-back.";

const TEST_HANDBACK = [
  "---",
  "",
  "## Handback",
  "",
  "End your reply with this section, filled in. I will read it when I review your work.",
  "",
  "- **What I did:**",
  "- **What I found:**",
  "- **What is still open:**",
].join("\n");

/** The default skeleton every badge starts from (R1). */
export const BUILT_IN_HANDOFF =
  [
    `# Test: ${SLOTS.name}`,
    TEST_INTRO,
    `## Learning targets\n\n${SLOTS.learningTargets}`,
    `## Task\n\n${SLOTS.task}`,
    TEST_HANDBACK,
  ].join("\n\n") + "\n";

/** The learning targets as a numbered list, or a placeholder when none are written. */
export function learningTargetsText(credential: Credential): string {
  const targets = credential.learningTargets.filter((t) => t.trim() !== "");
  if (targets.length === 0) return NO_TARGETS;
  return targets.map((t, i) => `${i + 1}. ${t}`).join("\n");
}

/** The task as written, or a placeholder when it is blank. */
export function taskText(credential: Credential): string {
  return credential.task.trim() === "" ? NO_TASK : credential.task;
}

const SLOT_PATTERN = /\{\{(name|learning_targets|task)\}\}/g;

/**
 * Fills a handoff template from the credential. One pass, so slot-like text inside the
 * credential's own name, targets or task is put in as written and never filled again.
 */
export function fillHandoff(template: string, credential: Credential): string {
  const values: Record<string, string> = {
    name: credential.name,
    learning_targets: learningTargetsText(credential),
    task: taskText(credential),
  };
  return template.replace(SLOT_PATTERN, (_match, slot: string) => values[slot]);
}

export type HandoffProblem =
  | { kind: "missing-slot"; slot: typeof SLOTS.task }
  | { kind: "has-rubric" };

/**
 * The save check (KTD2, R7). A template must hold `{{task}}`. A badge's template must
 * not hold that badge's rubric verbatim, after trimming; a blank rubric never fails.
 * Returns the problem, or null when the template can be saved.
 */
export function checkHandoff(template: string, rubric?: string): HandoffProblem | null {
  if (!template.includes(SLOTS.task)) return { kind: "missing-slot", slot: SLOTS.task };
  const hidden = rubric?.trim() ?? "";
  if (hidden !== "" && template.includes(hidden)) return { kind: "has-rubric" };
  return null;
}

// ---------------------------------------------------------------------------
// Handoffs in the folder (KTD3). A badge handoff's id is its file stem. The skeleton
// is one identity, `skeleton`, whether it is the built-in text or an edited one.

export const SKELETON_ID = "skeleton";

/** The skeleton in force: the edited one, or the built-in one when the folder has none (R2). */
export function skeletonOf(state: FolderState): HandoffTemplate {
  return { id: SKELETON_ID, text: state.skeleton ?? BUILT_IN_HANDOFF };
}

/** A badge's own handoffs, oldest first, so the last one is the newest. */
export function handoffsFor(state: FolderState, key: string): Handoff[] {
  return state.handoffs.filter((h) => credentialKey(h) === key);
}

/** The badge's newest handoff by stem, or the skeleton when it has none (R6). */
export function defaultHandoff(state: FolderState, key: string): HandoffTemplate {
  const own = handoffsFor(state, key);
  const newest = own[own.length - 1];
  return newest ? { id: newest.id, text: newest.text } : skeletonOf(state);
}

/** True when any result for the badge names the handoff (KTD5). The skeleton never locks. */
export function isHandoffLocked(state: FolderState, key: string, id: string): boolean {
  if (id === SKELETON_ID) return false;
  return state.assessments.some((a) => credentialKey(a) === key && a.handoff?.id === id);
}

/**
 * The handoff on the agent's latest result for the badge when that result is Met, or
 * null. A result with no handoff counts as the skeleton (Assumptions).
 */
export function winnerFor(state: FolderState, profileSlug: Slug, key: string): string | null {
  const latest = state.assessments
    .filter((a) => a.profileSlug === profileSlug && credentialKey(a) === key)
    .sort(newestFirst)[0];
  if (!latest || latest.result !== "met") return null;
  return latest.handoff?.id ?? SKELETON_ID;
}
