// Presets: factory credentials to start from (STRATEGY, Presets track). Each is written
// in the credential Markdown format (KTD4) and ported by hand from the coach repo, with
// a `## Source` section naming the coach file it came from. The Source section is an
// extra H2, so it is kept in the saved file and never goes into a prompt.

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

export const PRESETS: readonly Preset[] = [
  { id: "tighten-a-learning-target", markdown: TIGHTEN },
  { id: "run-a-nostr-relay", markdown: NOSTR_RELAY },
  { id: "rate-your-own-confidence", markdown: CONFIDENCE },
];

/** The preset as a credential in the given collection. Its slug is only a starting point. */
export function presetCredential(preset: Preset, collectionSlug: Slug): Credential {
  return parseCredentialMd(preset.markdown, { slug: preset.id, collectionSlug });
}
