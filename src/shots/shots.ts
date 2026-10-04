// The screenshot manifest (U3, U4, KTD6, KTD7, R19, R20): every picture in the user guide,
// as data. Each shot names the guide page it illustrates, where the app opens (a route, or
// the first-run gate), the sample folder it opens over, Jev Mode's state, what must be on
// screen for the picture to count (`expect`), an optional clip and optional in-page steps.
// `npm run site:shots` renders each one to site/public/shots/<id>.png through shots.html.
//
// Plain data and types only, with no React or DOM: scripts/shots.mjs loads this file
// through Vite's SSR loader to list the shots.
//
// The coverage map says, for every place the app can open, which shots picture it or that
// none does yet. It is typed over the route kinds in src/ui/routes.ts, so a new deck or
// item kind fails the type check until it is listed one way or the other.

import type { PartId } from "../../site/src/parts";
import type { DeckRoute, ItemRoute, Route } from "../ui/routes";

/** The sample folder a shot opens over (src/shots/seed.ts): a first run's empty folder, or the full one. */
export type SeedVariant = "empty" | "full";

/** Jev Mode for a shot: off with no key, or on with FakeJev's sample key hint (AE4). How to pages use "off". */
export type JevState = "off" | "on";

/**
 * Something on the page. `button`: a button by its accessible name (its aria-label, else
 * its text). `label`: a field by its aria-label, or by its <label>'s text. `text`: the
 * innermost element whose whole text is this. `selector`: a CSS selector. The first match
 * in document order wins.
 */
export type Target = { button: string } | { label: string } | { text: string } | { selector: string };

/**
 * One in-page step, run in order before the page reports ready. Each waits for its target.
 * `click` waits until the target is enabled. `fill` types a whole value into a field.
 * `paste` pastes text into the rich editor (`.rich-input` unless `into` names another).
 * `waitFor` waits until a target appears, such as a beat that lands after a timer.
 * `scroll` brings a target to the middle of the window, as far as the page scrolls, for a
 * screen taller than the window (U6).
 */
export type Step =
  | { click: Target }
  | { fill: Target; value: string }
  | { paste: string; into?: Target }
  | { waitFor: Target }
  | { scroll: Target };

/** What must be on screen once the page is ready: exact text, or a CSS selector that matches. */
export type Expect = { text: string } | { selector: string };

/** Capture only this element's box, grown by `pad` CSS pixels on every side, instead of the window. */
export interface Clip {
  selector: string;
  pad?: number;
}

export interface Shot {
  /** The picture's file name under site/public/shots, kebab-case and unique. */
  id: string;
  /** The guide page it illustrates, as that page's entry id. */
  page: `${PartId}/${string}`;
  /** Where the app opens: a route, or "gate" for the first-run folder screen. */
  route: Route | "gate";
  seed: SeedVariant;
  jev: JevState;
  expect: Expect;
  clip?: Clip;
  steps?: readonly Step[];
}

/**
 * What the first test's agent sends back in Getting started's pictures (U6): an answer to
 * the Name what matters next preset, about an invented repo.
 */
const FIRST_REPLY = `## What matters next

1. **Finish the retry in the sync client.** \`src/sync/client.ts\` has a \`TODO: back off on 429\` above \`pushChanges\`, and two open issues report lost edits. First step: a test that replays a 429. How sure: high.
2. **Remove the old settings screen.** Nothing has linked to \`src/settings/legacy/\` since the commit "route settings through the new panel". First step: delete the folder and run the build. How sure: high.
3. **Write the upgrade notes.** \`migrations/0009_tags.sql\` renames a column people query. First step: draft the notes from the merged changes. How sure: medium.

## What I could not see

Whether a release date is set. A roadmap would change the order.`;

/** Getting started's first test (U6), from making the agent to the reply pasted under "What came back". */
const FIRST_TEST_TO_REPLY: readonly Step[] = [
  { click: { button: "Make the agent" } },
  { waitFor: { text: "Hand it over" } },
  { click: { button: "Copy" } },
  { waitFor: { text: "What came back" } },
  { paste: FIRST_REPLY },
];

/** On from the pasted reply to "Did it meet it", with the reply beside the rubric. */
const FIRST_TEST_TO_JUDGE: readonly Step[] = [...FIRST_TEST_TO_REPLY, { click: { button: "Next" } }, { waitFor: { text: "Did it meet it" } }];

// How to's pictures (U7) name the full sample folder's slugs and stems as src/shots/seed.ts
// writes them (SAMPLE there), spelled out so this file stays plain data.
const CLAUDE = "claude-code-opus-high";
const CODEX = "codex-gpt-6-astra-medium";
const HOW_SURE = "my-credentials/say-how-sure-you-are";
const RELEASE_NOTE = "my-credentials/write-a-release-note";
const CODEX_HOW_SURE = { profileSlug: CODEX, fileStem: "20260925T100500Z" };
const CLAUDE_HOW_SURE = { profileSlug: CLAUDE, fileStem: "20260926T164500Z" };
/** Write a release note's own handoff, A, its default. */
const RELEASE_NOTE_HANDOFF = "20260928T090000Z";

/** How to's test: Claude Code takes Write a release note, which opens at "Hand it over". */
const RELEASE_TEST: Route = { view: "deck", deck: "test", profileSlug: CLAUDE, credentialKey: RELEASE_NOTE };

/** What Claude Code sends back for Write a release note, about the same invented repo as the first test. */
const RELEASE_REPLY = `# Release notes for 0.9

## Before you update

- Sync is now on by default. If you sync through your own server, add its address under Settings, then Sync, before you update.

## What changed

- **Edits no longer go missing when the server is busy.** The app waits and tries again instead of dropping the change.
- **Tags have their own column.** Searching by tag is faster, and every note keeps its tags.
- **The old settings screen is gone.** Everything it held is in the Settings panel.

---

## Handback

- **What I did:** Read the 14 changes merged since 0.8 and grouped them by what a user notices.
- **What I found:** One change renames a column that saved searches use.
- **What is still open:** Whether sync on by default ships in this release.`;

/** From "Hand it over" to the release note pasted under "What came back". */
const RELEASE_TO_REPLY: readonly Step[] = [{ click: { button: "Copy" } }, { waitFor: { text: "What came back" } }, { paste: RELEASE_REPLY }];

// Jev Mode's pictures (U8): the judge card and the reply box with Jev Mode on, and a take
// that keeps a saved reading. Check an answer key's take by Codex is the sample's one
// result with a reading.
const ANSWER_KEY = "my-credentials/check-an-answer-key";
const CODEX_ANSWER_KEY = { profileSlug: CODEX, fileStem: "20260927T112000Z" };

/**
 * A short release note as a terminal shows it: a harness marker, a two-space gutter and
 * lines wrapped at one width mid-sentence, so the paste offers "Clean up with Jev".
 */
const TERMINAL_REPLY = `⏺ Release notes for 0.9.

  Sync is now on by default. If you sync through your own
  server, add its address under Settings, then Sync, before
  you update.

  Edits no longer go missing when the server is busy. The app
  waits and tries again instead of dropping the change. Tags
  have their own column, so searching by tag is faster, and
  every note keeps its tags.`;

export const SHOTS: readonly Shot[] = [
  {
    id: "first-run",
    page: "getting-started/your-folder",
    route: "gate",
    seed: "empty",
    jev: "off",
    expect: { text: "Choose folder" },
  },
  {
    id: "home-empty",
    page: "getting-started/first-test",
    route: { view: "home" },
    seed: "empty",
    jev: "off",
    expect: { text: "Try a first test" },
  },
  {
    id: "first-test-agent",
    page: "getting-started/first-test",
    route: { view: "deck", deck: "agent", firstTest: true },
    seed: "empty",
    jev: "off",
    expect: { text: "Make the agent" },
  },
  {
    id: "first-test-hand",
    page: "getting-started/first-test",
    route: { view: "deck", deck: "agent", firstTest: true },
    seed: "empty",
    jev: "off",
    expect: { text: "Hand it over" },
    steps: [{ click: { button: "Make the agent" } }, { waitFor: { text: "Hand it over" } }],
  },
  {
    id: "first-test-judge",
    page: "getting-started/first-test",
    route: { view: "deck", deck: "agent", firstTest: true },
    seed: "empty",
    jev: "off",
    expect: { text: "Did it meet it" },
    steps: FIRST_TEST_TO_JUDGE,
  },
  {
    // Met plays a 1400 ms landing before home returns, so the last step waits for a
    // holder, which only home shows.
    id: "first-test-home",
    page: "getting-started/first-test",
    route: { view: "deck", deck: "agent", firstTest: true },
    seed: "empty",
    jev: "off",
    expect: { selector: ".holder" },
    steps: [...FIRST_TEST_TO_JUDGE, { click: { button: "Met" } }, { waitFor: { selector: ".holder" } }],
  },
  {
    // Home is taller than the window and its doors stay pinned to the bottom, so the
    // picture scrolls the Badges shelf into view above them.
    id: "home",
    page: "ideas/your-record",
    route: { view: "home" },
    seed: "full",
    jev: "off",
    expect: { text: "Badges" },
    steps: [{ scroll: { selector: 'section[aria-labelledby="home-badges"]' } }],
  },
  {
    id: "jev-off",
    page: "help/jev-mode",
    route: { view: "deck", deck: "jev" },
    seed: "full",
    jev: "off",
    expect: { text: "Your TypeSafe key" },
  },
  {
    id: "jev-on",
    page: "help/jev-mode",
    route: { view: "deck", deck: "jev" },
    seed: "full",
    jev: "on",
    expect: { text: "Your key ends in c0de." },
  },
  {
    // With Jev Mode on, Ask Jev sits under the rubric, and Met and Not yet wait for Save.
    id: "jev-ask",
    page: "help/jev-mode",
    route: RELEASE_TEST,
    seed: "full",
    jev: "on",
    expect: { text: "Ask Jev" },
    steps: [...RELEASE_TO_REPLY, { click: { button: "Next" } }, { waitFor: { text: "Ask Jev" } }],
  },
  {
    id: "jev-cleanup",
    page: "help/jev-mode",
    route: RELEASE_TEST,
    seed: "full",
    jev: "on",
    expect: { text: "Clean up with Jev" },
    steps: [{ click: { button: "Copy" } }, { waitFor: { text: "What came back" } }, { paste: TERMINAL_REPLY }],
  },
  {
    // The saved reading is folded under the reply, so the picture opens it and scrolls to it.
    id: "jev-reading",
    page: "help/jev-mode",
    route: { view: "item", item: "reply", credentialKey: ANSWER_KEY, take: CODEX_ANSWER_KEY },
    seed: "full",
    jev: "on",
    expect: { selector: "details.reply-jev[open]" },
    steps: [{ click: { selector: "details.reply-jev > summary" } }, { scroll: { selector: "details.reply-jev" } }],
  },

  // How to (U7): every picture over the full sample with Jev Mode off (KTD7).
  {
    id: "credential-start",
    page: "how-to/build-a-credential",
    route: { view: "deck", deck: "credential" },
    seed: "full",
    jev: "off",
    expect: { text: "Where to start" },
  },
  {
    // The target from the old tester's sheet, whose "by" clause the app offers to move.
    id: "credential-target",
    page: "how-to/build-a-credential",
    route: { view: "deck", deck: "credential" },
    seed: "full",
    jev: "off",
    expect: { text: "Move to the rubric" },
    steps: [
      { click: { button: "Build your own" } },
      { fill: { label: "Name" }, value: "Plan a week of dinners" },
      { click: { button: "Next" } },
      { fill: { label: "Learning target" }, value: "I can plan a week of dinners by checking what's already in the fridge" },
      { waitFor: { text: "Move to the rubric" } },
    ],
  },
  {
    id: "agent-new",
    page: "how-to/make-an-agent",
    route: { view: "deck", deck: "agent" },
    seed: "full",
    jev: "off",
    expect: { text: "Claude Code, sonnet, medium" },
    steps: [{ click: { button: "Next model" } }, { click: { button: "Previous effort" } }, { waitFor: { text: "Claude Code, sonnet, medium" } }],
  },
  {
    id: "test-hand",
    page: "how-to/hand-off-a-test",
    route: RELEASE_TEST,
    seed: "full",
    jev: "off",
    expect: { text: "A · default" },
  },
  {
    id: "test-reply",
    page: "how-to/hand-off-a-test",
    route: RELEASE_TEST,
    seed: "full",
    jev: "off",
    expect: { text: "Release notes for 0.9" },
    steps: RELEASE_TO_REPLY,
  },
  {
    // Codex holds Name what matters next's handoff, waiting on its reply.
    id: "home-needs",
    page: "how-to/hand-off-a-test",
    route: { view: "home" },
    seed: "full",
    jev: "off",
    expect: { text: "Pull Codex's handoff" },
    clip: { selector: 'section[aria-labelledby="home-needs"]', pad: 24 },
  },
  {
    id: "judge",
    page: "how-to/judge-a-reply",
    route: RELEASE_TEST,
    seed: "full",
    jev: "off",
    expect: { text: "Did it meet it" },
    steps: [...RELEASE_TO_REPLY, { click: { button: "Next" } }, { waitFor: { text: "Did it meet it" } }],
  },
  {
    id: "badge-replies",
    page: "how-to/compare-takes",
    route: { view: "item", item: "badge", credentialKey: HOW_SURE },
    seed: "full",
    jev: "off",
    expect: { text: "Compare" },
    steps: [
      { click: { label: "Pick Codex, Sep 25, 2026" } },
      { click: { label: "Pick Claude Code, Sep 26, 2026" } },
      { waitFor: { text: "Compare" } },
      { scroll: { selector: 'section[aria-labelledby="badge-replies"]' } },
    ],
  },
  {
    id: "reply-view",
    page: "how-to/compare-takes",
    route: { view: "item", item: "reply", credentialKey: HOW_SURE, take: CODEX_HOW_SURE },
    seed: "full",
    jev: "off",
    expect: { text: "Show as stored" },
  },
  {
    id: "compare",
    page: "how-to/compare-takes",
    route: { view: "item", item: "compare", credentialKey: HOW_SURE, takes: [CODEX_HOW_SURE, CLAUDE_HOW_SURE] },
    seed: "full",
    jev: "off",
    expect: { selector: ".compare-panes" },
  },
  {
    id: "badge-page",
    page: "how-to/change-a-badge",
    route: { view: "item", item: "badge", credentialKey: RELEASE_NOTE },
    seed: "full",
    jev: "off",
    expect: { text: "1 handoff" },
  },
  {
    // Claude Code holds Say how sure you are, so a changed rubric warns before it saves.
    // Next stays disabled until the paste has changed the rubric.
    id: "edit-retest",
    page: "how-to/change-a-badge",
    route: { view: "deck", deck: "edit-credential", credentialKey: HOW_SURE, part: "rubric" },
    seed: "full",
    jev: "off",
    expect: { text: "Holders will re-test" },
    steps: [
      { paste: "Each confidence comes with a reason. " },
      { click: { button: "Next" } },
      { waitFor: { text: "Holders will re-test" } },
    ],
  },
  {
    id: "handoffs-box",
    page: "how-to/change-a-badge",
    route: { view: "deck", deck: "handoffs", credentialKey: RELEASE_NOTE },
    seed: "full",
    jev: "off",
    expect: { text: "Write a new handoff" },
  },
  {
    id: "handoff-edit",
    page: "how-to/change-a-badge",
    route: { view: "deck", deck: "edit-handoff", credentialKey: RELEASE_NOTE, handoff: RELEASE_NOTE_HANDOFF },
    seed: "full",
    jev: "off",
    expect: { text: "Handoff A" },
  },
  {
    // A pad under the gap to the close control, so the clip shows only the card.
    id: "trash-badge",
    page: "how-to/change-a-badge",
    route: { view: "deck", deck: "trash", item: { kind: "badge", credentialKey: HOW_SURE } },
    seed: "full",
    jev: "off",
    expect: { text: "Its 2 results go with it." },
    clip: { selector: ".deck-card", pad: 16 },
  },
  {
    // The player card fills the window, so the picture scrolls its parts into view. The
    // card focuses its heading once it mounts, which scrolls back to the top, so the scroll
    // waits for the badges the agent has tried, which show only once the matrix is built.
    id: "agent-page",
    page: "how-to/fill-in-an-agent",
    route: { view: "item", item: "agent", profileSlug: CLAUDE },
    seed: "full",
    jev: "off",
    expect: { text: "Parameters" },
    steps: [{ waitFor: { selector: ".detail-earned" } }, { scroll: { selector: 'ul[aria-label="Parts"]' } }],
  },
  {
    id: "agent-params",
    page: "how-to/fill-in-an-agent",
    route: { view: "deck", deck: "edit-agent", profileSlug: CLAUDE, part: "params" },
    seed: "full",
    jev: "off",
    expect: { text: "max turns = 40" },
    steps: [{ fill: { label: "New parameter" }, value: "max turns = 40" }, { click: { button: "Add another" } }, { waitFor: { text: "max turns = 40" } }],
  },
  {
    // Codex holds a handoff, so the card says it is pulled too.
    id: "trash-agent",
    page: "how-to/fill-in-an-agent",
    route: { view: "deck", deck: "trash", item: { kind: "agent", profileSlug: CODEX } },
    seed: "full",
    jev: "off",
    expect: { text: "Its handoff is pulled with no result." },
    clip: { selector: ".deck-card", pad: 16 },
  },
];

/** Marks a route kind no shot pictures yet. */
export const NOT_PICTURED = "not pictured";

/** Every place the app can open: the gate, home, each deck and each item. */
export type RouteKind = "gate" | "home" | `deck:${DeckRoute["deck"]}` | `item:${ItemRoute["item"]}`;

/** A shot's route kind, as the coverage map keys it. */
export function routeKind(route: Route | "gate"): RouteKind {
  if (route === "gate") return "gate";
  if (route.view === "home") return "home";
  if (route.view === "deck") return `deck:${route.deck}`;
  return `item:${route.item}`;
}

/** For each route kind, the shots that picture it, or NOT_PICTURED. Every shot is listed under its own kind. */
export const COVERAGE: Record<RouteKind, readonly string[] | typeof NOT_PICTURED> = {
  gate: ["first-run"],
  home: ["home-empty", "home", "home-needs"],
  "deck:credential": ["credential-start", "credential-target"],
  "deck:agent": ["first-test-agent", "first-test-hand", "first-test-judge", "first-test-home", "agent-new"],
  "deck:test": ["test-hand", "test-reply", "judge", "jev-ask", "jev-cleanup"],
  "deck:edit-credential": ["edit-retest"],
  "deck:edit-agent": ["agent-params"],
  "deck:handoffs": ["handoffs-box"],
  "deck:edit-handoff": ["handoff-edit"],
  "deck:trash": ["trash-badge", "trash-agent"],
  "deck:jev": ["jev-off", "jev-on"],
  "item:badge": ["badge-replies", "badge-page"],
  "item:agent": ["agent-page"],
  // A handoff opens as its own item only once two or more have results; the sample's has none.
  "item:handoff": NOT_PICTURED,
  "item:reply": ["reply-view", "jev-reading"],
  "item:compare": ["compare"],
};
