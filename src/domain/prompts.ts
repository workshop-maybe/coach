// The five fixed prompts (R8). Each is a pure function of the credential and
// returns text the user copies into an agent. Prompts carry their content
// inline and never point at the data folder or its files (R10). The test
// prompt never includes the rubric (R11).

import type { AgentProfile, Credential } from "./types";

export type PromptJob = "test" | "check" | "review" | "suggest" | "refine";

export interface PromptJobInfo {
  job: PromptJob;
  label: string;
  /** Only the test prompt is tied to a specific agent profile. */
  needsProfile: boolean;
}

export const PROMPT_JOBS: readonly PromptJobInfo[] = [
  { job: "test", label: "Test this agent", needsProfile: true },
  { job: "check", label: "Check my acceptance criteria", needsProfile: false },
  { job: "review", label: "Review this assignment", needsProfile: false },
  { job: "suggest", label: "Suggest assignments for these learning targets", needsProfile: false },
  { job: "refine", label: "Handoff note: refine this assignment", needsProfile: false },
];

const NO_TARGETS = "(No learning targets written yet.)";
const NO_TASK = "(No task written yet.)";
const NO_RUBRIC = "(No rubric written yet.)";

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

const HELPER_INTRO =
  "I am writing a credential: a set of learning targets plus one assignment that shows whether " +
  "someone, a person or an agent, can meet them. The assignment has a task, which the person " +
  "being tested sees, and a rubric, which only I see. You are helping me write it. You are not " +
  "the one being tested.";

const CHECK_JOB = [
  "## What I need",
  "",
  "Check my acceptance criteria. Tell me whether the task and rubric together are a sound, " +
  "checkable test of the learning targets.",
  "",
  "- Does the task give someone a fair chance to show each learning target?",
  "- Could I decide pass or fail from the rubric alone, without guessing?",
  "- Which learning targets does the assignment not test, or test only weakly?",
  "- Could someone pass without meeting the targets, or fail while meeting them?",
  "",
  "Be specific. Quote the parts you mean and suggest concrete changes.",
].join("\n");

const REVIEW_JOB = [
  "## What I need",
  "",
  "Review this assignment. Read it the way the person taking it would, then the way I would " +
  "when grading it.",
  "",
  "- Is the task clear, complete and possible to finish in one sitting?",
  "- Is anything missing that the person would need to start?",
  "- Is the rubric consistent with the task, and does it ask for anything the task never mentions?",
  "- What would you change first?",
  "",
  "Keep your review short and concrete.",
].join("\n");

const SUGGEST_JOB = [
  "## What I need",
  "",
  "Suggest assignments for these learning targets. Give me two or three options. For each one:",
  "",
  "- a short title",
  "- the task, written so it can be handed to someone as is",
  "- a rubric I can use to decide pass or fail",
  "- which learning targets it tests",
  "",
  "Each task must make sense on its own, without the rubric. Prefer work I can check from the " +
  "result over work I have to take on trust.",
].join("\n");

const REFINE_JOB = [
  "## What I need",
  "",
  "Help me refine this assignment so it is a fair, checkable test of the learning targets.",
  "",
  "- Point out where the task is unclear or leaves out something the person would need.",
  "- Point out where the rubric is vague, or asks for things the task does not.",
  "- Propose a revised task and a revised rubric in full, ready to paste.",
  "",
  "The rubric stays hidden from whoever takes the test, so the task must stand on its own.",
].join("\n");

const REFINE_HANDBACK = [
  "---",
  "",
  "## Handback",
  "",
  "Append your report below this line. Do not change anything above it. " +
    "Cover what I did · what I found · what is still open, then give the revised task and rubric.",
].join("\n");

function orPlaceholder(text: string, placeholder: string): string {
  return text.trim() === "" ? placeholder : text;
}

function targetsList(credential: Credential): string {
  const targets = credential.learningTargets.filter((t) => t.trim() !== "");
  if (targets.length === 0) return NO_TARGETS;
  return targets.map((t, i) => `${i + 1}. ${t}`).join("\n");
}

function section(heading: string, body: string): string {
  return `## ${heading}\n\n${body}`;
}

function join(parts: string[]): string {
  return parts.join("\n\n") + "\n";
}

function helperBrief(credential: Credential): string[] {
  return [
    `# ${credential.name}`,
    HELPER_INTRO,
    section("Learning targets", targetsList(credential)),
    section("Task", orPlaceholder(credential.task, NO_TASK)),
    section("Rubric", orPlaceholder(credential.rubric, NO_RUBRIC)),
  ];
}

/**
 * The prompt for the agent being tested. The profile is accepted so the UI can
 * pass it, but none of its details go into the prompt: the tested agent sees
 * only the credential name, learning targets and task.
 */
export function testPrompt(credential: Credential, _profile?: AgentProfile): string {
  return join([
    `# Test: ${credential.name}`,
    TEST_INTRO,
    section("Learning targets", targetsList(credential)),
    section("Task", orPlaceholder(credential.task, NO_TASK)),
    TEST_HANDBACK,
  ]);
}

export function checkCriteriaPrompt(credential: Credential): string {
  return join([...helperBrief(credential), CHECK_JOB]);
}

export function reviewAssignmentPrompt(credential: Credential): string {
  return join([...helperBrief(credential), REVIEW_JOB]);
}

export function suggestAssignmentsPrompt(credential: Credential): string {
  const parts = [`# ${credential.name}`, HELPER_INTRO, section("Learning targets", targetsList(credential))];
  const hasTask = credential.task.trim() !== "";
  const hasRubric = credential.rubric.trim() !== "";
  if (hasTask || hasRubric) {
    parts.push(
      "The assignment I have so far is below. Use it as a starting point or suggest something different.",
      section("Current task", orPlaceholder(credential.task, NO_TASK)),
      section("Current rubric", orPlaceholder(credential.rubric, NO_RUBRIC)),
    );
  } else {
    parts.push("I have not written an assignment yet.");
  }
  parts.push(SUGGEST_JOB);
  return join(parts);
}

/** Handoff note: the brief above a line, and a Handback section below it (R13). */
export function refineHandoffNote(credential: Credential): string {
  return join([...helperBrief(credential), REFINE_JOB, REFINE_HANDBACK]);
}

export function buildPrompt(job: PromptJob, credential: Credential, profile?: AgentProfile): string {
  switch (job) {
    case "test":
      return testPrompt(credential, profile);
    case "check":
      return checkCriteriaPrompt(credential);
    case "review":
      return reviewAssignmentPrompt(credential);
    case "suggest":
      return suggestAssignmentsPrompt(credential);
    case "refine":
      return refineHandoffNote(credential);
  }
}
