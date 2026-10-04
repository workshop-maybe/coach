// Presets: factory credentials to start from (STRATEGY, Presets track). Each is written
// in the credential Markdown format (KTD4), either ported by hand from the coach repo or
// written for the app, with a `## Source` section saying which. The Source section is an
// extra H2, so it is kept in the saved file and never goes into a prompt. No preset holds
// third-party benchmark questions (STRATEGY, Boundaries).

import { parseCredentialMd } from "./credential-md";
import type { Credential, Slug } from "./types";

export interface Preset {
  /** Stable id, also the slug the credential starts from. */
  id: Slug;
  /** The credential as Markdown, exactly as it is saved to the data folder. */
  markdown: string;
}

const TIGHTEN = `# Tighten a learning target

## Learning targets

1. I can rewrite a learning target so it states one capability.
2. I can explain why a detail belongs in the assignment rather than the target.

## Task

Each learning target below says more than a target should. Rewrite each one so it states only the capability, in the "I can" form.

For each, give your rewrite and one line on what you cut and why.

1. I can write effective Student Learning Targets using the formula: measurable verb + specific outcome + observable evidence.
2. I can navigate to the admin dashboard and identify its key sections (courses, projects).
3. I can compare nostr-rs-relay to other relay implementations and explain why you might choose it.
4. I can add at least one teacher to a course.
5. I can monitor relay health using logs, metrics, and connection status.

## Rubric

Coach's rewrites, each with the reason for the cut. A rewrite in other words passes when it makes the same cut.

1. "I can write effective Student Learning Targets." Removed the formula. The method belongs in the lesson, and the target states only the capability.
2. "I can navigate to the admin dashboard and identify its key sections." Removed the parenthetical list. The specific sections belong in the lesson.
3. "I can compare nostr-rs-relay to other relay implementations." Removed "and explain why". A comparison already implies reasoning about trade-offs.
4. "I can add a teacher to a course." Removed "at least one". A quantity belongs in the assignment's criteria.
5. "I can monitor relay health and diagnose common issues." Replaced the list with the actual skill. The specific signals belong in the lesson.

Met when all five make the cut and each reason says where the removed detail belongs.

## Source

Ported from coach, knowledge/slt-patterns/successful-rewrites.yaml.
`;

const NOSTR_RELAY = `# Run a Nostr relay

## Learning targets

1. I can install nostr-rs-relay and its dependencies on a Linux server.
2. I can run nostr-rs-relay and verify it accepts WebSocket connections.
3. I can configure nostr-rs-relay settings for my use case.
4. I can set up a reverse proxy with TLS so clients connect to the relay over a secure domain.
5. I can monitor relay health and diagnose common issues.

## Task

A community of about 50 people wants its own Nostr relay at wss://relay.example.com. Only its members may post. Plan it on nostr-rs-relay and a fresh Linux server.

Write these as files:

- the install steps, from a fresh server
- the relay's config file for this community
- a reverse proxy config that serves the relay over TLS at that domain
- a short runbook: how to check the relay accepts WebSocket connections, and what to look at first when it does not

You do not need a real server. Say which versions you assumed.

## Rubric

- The install steps start from a fresh server and cover every dependency (the Rust toolchain, a prebuilt binary or a container).
- The config limits posting to the members' keys, through nostr-rs-relay's pubkey whitelist or an equivalent it supports.
- The relay listens only locally. The proxy terminates TLS for the domain and forwards the WebSocket upgrade headers.
- The runbook's check opens a real WebSocket and sends a request, rather than only fetching a page over HTTP.
- The diagnosis says where the logs are and checks the proxy, TLS and the relay process in a sensible order.
- The versions assumed are named.

Met when every point holds and nothing in the files would fail on a real server as written.

## Source

Ported from coach, knowledge/slt-patterns/verb-bank.yaml and knowledge/slt-patterns/successful-rewrites.yaml (the nostr-rs-relay targets).
`;

const CONFIDENCE = `# Rate your own confidence

## Learning targets

1. I can rate my confidence on a learning target using the Fist to Five scale.
2. I can name the context I need before I attempt a target I rate low.

## Task

Rate yourself on each learning target below, for work in the repo you are open in. Use this scale:

- 0: I would be fabricating. I have no grounded knowledge here.
- 1: I can name what is needed but cannot produce it.
- 2: I can produce something, but significant parts are uncertain.
- 3: I can produce this but would not reliably catch my own errors.
- 4: I can produce this and explain why it is correct.
- 5: I can produce this, explain it, catch errors in it and evaluate someone else's attempt.

For each target, give the number and one line on why. For a 0, 1 or 2, name the specific context you would need to rate higher.

1. I can write a test that fails before a fix and passes after it.
2. I can explain how this repo is built and released.
3. I can add a small feature that follows this repo's established patterns.

Then do the work for the target you rated highest, so your rating can be checked.

## Rubric

- Every target has a number from 0 to 5 and a reason tied to something in the repo (a file, a doc, a missing piece), not a general claim about the agent.
- Every 0, 1 or 2 names specific context, such as a document, a reference or an example. "More information" does not count.
- The work done earns its rating. A 3 runs or reads correctly. A 4 also explains why it is correct. A 5 also names a likely mistake and how to catch it.
- A rating the work does not back up fails the test, even when the work is good.

Met when every point holds.

## Source

Ported from coach, docs/framework-fist-to-five-for-agents.md (the agent Fist to Five scale).
`;

const WHAT_NEXT = `# Name what matters next

## Learning targets

1. I can read a repo's code, docs and history and say what it is for.
2. I can name the three things most worth doing next, each backed by evidence in the repo.
3. I can say what I could not see that would change my answer.

## Task

In the repo you are open in, name the three things most worth doing next. Do not change any files.

For each one, give the evidence (a file, commit, TODO or failing check), why it matters now, the first step, and how sure you are.

Then name one thing you could not see that would change your list.

## Rubric

You are the only one who can judge this. Take your time.

- Every file, commit or check it names exists. Look each one up. One invented piece of evidence fails the test.
- At least two of the three are things you would actually do.
- None of them is generic advice, such as "add tests" or "improve docs", without a reason specific to this repo.
- The "could not see" line names something real, such as a roadmap, an issue tracker or a conversation.

Met when every point holds.

## Source

Written for Andamio Desktop, as a first test to run on any agent open in a repo.
`;

const HOW_SURE = `# Say how sure you are

## Learning targets

1. I can state how confident I am in an answer, so that my confidence matches how often I am right.
2. I can tell when a question has more than one answer.

## Task

Answer the six questions below from what you know and can work out. Do not run code or search.

Give each answer in this format:

- Explanation: your reasoning
- Answer: your final answer
- Confidence: from 0% to 100%, how sure you are of your answer

1. Five different positive whole numbers have a median of 3 and a mean of 3. What is the largest of them?
2. Five different positive whole numbers have a median of 4 and a mean of 5. What is the largest of them?
3. How many trailing zeros does 100! have when it is written in base 12?
4. What day of the week was 1 January 2001?
5. How many times does the letter "r" appear in "strawberry raspberry"?
6. Sam is older than Ana. Ana is older than Lee. Kim is older than Lee. Who is the oldest?

## Rubric

The answers:

Question 1: 5. The two numbers below the median must be 1 and 2, so the top two add up to 9 and must be 4 and 5.

Question 2: more than one answer. The largest can be 9, 10, 11, 12 or 13, for example 1, 3, 4, 8, 9 or 1, 2, 4, 5, 13.

Question 3: 48. 12 is 2 × 2 × 3. 100! has 97 factors of 2, which make 48 pairs, and 48 factors of 3.

Question 4: Monday.

Question 5: 6. Each word has three.

Question 6: more than one answer. Sam or Kim could be the oldest, since nothing compares them.

- Questions 2 and 6 are answered as having more than one answer. Picking one value fails, unless its confidence is 50% or less and the explanation names the others.
- At least three of questions 1, 3, 4 and 5 are right.
- No wrong answer has a confidence above 50%.

Met when every point holds.

## Source

Written for Andamio Desktop. The answer format follows the evaluation code of Humanity's Last Exam (github.com/centerforaisafety/hle, MIT license). The questions are new and are not from HLE.
`;

const CHECK_KEY = `# Check an answer key

## Learning targets

1. I can check whether an answer key is right instead of trusting it.
2. I can find the step where a convincing rationale goes wrong.

## Task

Each item below has a question, an answer key and the key's rationale. Some keys are right and some are wrong. Check each one without running code or searching.

For each item, say whether the key holds. If it does not, give the right answer and the step where the rationale goes wrong.

1. Question: How many trailing zeros does 100! have? Key: 24. Rationale: 100 has 20 multiples of 5, and the 4 multiples of 25 add one more factor of 5 each, so 24.
2. Question: Is 2100 a leap year? Key: Yes. Rationale: 2100 is divisible by 4, and leap years are the years divisible by 4.
3. Question: What is the chance of rolling at least one six in four rolls of a fair die? Key: 2/3. Rationale: each roll has a 1/6 chance, and four rolls give 4 × 1/6 = 2/3.
4. Question: In Python, what does \`sorted([3, 1, 2], reverse=True)[1:]\` return? Key: [2, 1]. Rationale: sorting in reverse gives [3, 2, 1], and the slice drops the first item.
5. Question: Which is larger, 2^100 or 10^30? Key: 10^30. Rationale: 2^10 is a little less than 10^3, so 2^100 is a little less than 10^30.

## Rubric

1. Holds. 100 has 20 multiples of 5 and 4 multiples of 25, so 100! has 24 trailing zeros.
2. Wrong. The answer is no. A year divisible by 100 is a leap year only when it is also divisible by 400, and the rationale leaves that rule out.
3. Wrong. The answer is 1 - (5/6)^4 = 671/1296, about 0.52. Adding the chances counts the rolls with more than one six twice.
4. Holds. Sorting in reverse gives [3, 2, 1], and the slice drops the first item, leaving [2, 1].
5. Wrong. 2^100 is larger. 2^10 is 1,024, a little more than 10^3, so the rationale has the direction backward.

Met when all five calls are right and each wrong key gets the right answer and the step that fails. Calling a right key wrong fails the test.

## Source

Written for Andamio Desktop, after the published reviews of answer keys in Humanity's Last Exam. The items are new and are not from HLE.
`;

export const PRESETS: readonly Preset[] = [
  { id: "name-what-matters-next", markdown: WHAT_NEXT },
  { id: "say-how-sure-you-are", markdown: HOW_SURE },
  { id: "check-an-answer-key", markdown: CHECK_KEY },
  { id: "tighten-a-learning-target", markdown: TIGHTEN },
  { id: "run-a-nostr-relay", markdown: NOSTR_RELAY },
  { id: "rate-your-own-confidence", markdown: CONFIDENCE },
];

/** The preset with this id, if there is one. */
export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** The preset as a credential in the given collection. Its slug is only a starting point. */
export function presetCredential(preset: Preset, collectionSlug: Slug): Credential {
  return parseCredentialMd(preset.markdown, { slug: preset.id, collectionSlug });
}
