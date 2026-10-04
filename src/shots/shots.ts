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

/**
 * The sample folder a shot opens over (src/shots/seed.ts): a first run's empty folder, the
 * full one, or the full one with enough judged readings on Check an answer key for Jev's
 * track record and fitted cut-offs.
 */
export type SeedVariant = "empty" | "full" | "judged";

/**
 * Jev Mode for a shot: off with no key, or on with FakeJev's sample key hint (AE4). How to
 * pages use "off", except the pictures of Jev making a call.
 */
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
 * `pasteImage` pastes one of the sample pictures in src/shots/ (SAMPLE_IMAGES) at the end of
 * the rich editor, as a copied screenshot arrives, so the shot runs the real image paste.
 * `focusEnd` puts the cursor at the end of a rich editor, as a person clicking after its
 * text would, so a later Video key click adds there.
 * `waitFor` waits until a target appears, such as a beat that lands after a timer.
 * `scroll` brings a target to the middle of the window, as far as the page scrolls, for a
 * screen taller than the window (U6).
 */
export type Step =
  | { click: Target }
  | { fill: Target; value: string }
  | { paste: string; into?: Target }
  | { pasteImage: SampleImage; into?: Target }
  | { focusEnd: Target }
  | { waitFor: Target }
  | { scroll: Target };

/** The sample pictures a `pasteImage` step can paste, each a PNG in src/shots/ under that name. */
export const SAMPLE_IMAGES = ["pasted-sample"] as const;
export type SampleImage = (typeof SAMPLE_IMAGES)[number];

/** What must be on screen once the page is ready: exact text, or a CSS selector that matches. */
export type Expect = { text: string } | { selector: string };

/** Capture only this element's box, grown by `pad` CSS pixels on every side, instead of the window. */
export interface Clip {
  selector: string;
  pad?: number;
}

/**
 * The device scale every shot is taken at (KTD7): two image pixels per CSS pixel.
 * scripts/shots.mjs shoots at it, and site/src/components/Shot.astro divides by it to size
 * the picture on the page.
 */
export const SHOT_SCALE = 2;

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
  /**
   * What Jev answers every ask, as a chance by question id: `p1`… for rubric points,
   * `overall`, `t1`… for learning targets. An id left out gets FakeJev's default, 0.5,
   * which reads as can't call. Only with Jev Mode on.
   */
  jevAnswers?: Readonly<Record<string, number>>;
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
/** The bake-off on Check an answer key: each agent's reply held without a verdict. */
const CLAUDE_HELD = { profileSlug: CLAUDE, fileStem: "20260929T101500Z" };
const CODEX_HELD = { profileSlug: CODEX, fileStem: "20260929T114000Z" };

/** What Claude Code sends back when it takes Say how sure you are again, with Jev Mode on. */
const HOW_SURE_REPLY = `1. Answer: 5. Confidence: 95%
2. Answer: More than one answer. The largest can be anything from 9 to 13. Confidence: 85%
3. Answer: 48. Confidence: 80%`;

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
    // After Met the screen waits; making the agent the go-to goes home, so the last step
    // waits for a holder, which only home shows.
    id: "first-test-home",
    page: "getting-started/first-test",
    route: { view: "deck", deck: "agent", firstTest: true },
    seed: "empty",
    jev: "off",
    expect: { selector: ".holder" },
    steps: [
      ...FIRST_TEST_TO_JUDGE,
      { click: { button: "Met" } },
      { click: { button: "Make Claude Code, opus, high the go-to" } },
      { waitFor: { selector: ".holder" } },
    ],
  },
  {
    // What needs you sits beside Agents, so every shelf shows above the doors pinned to the
    // window's foot.
    id: "home",
    page: "ideas/your-record",
    route: { view: "home" },
    seed: "full",
    jev: "off",
    expect: { text: "Badges" },
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
  {
    // Say how sure you are has two judged replies, one with a note, so the line under Ask Jev
    // says what goes with the ask. The picture is the rubric's side of the judge card.
    id: "jev-sends",
    page: "help/jev-mode",
    route: { view: "deck", deck: "test", profileSlug: CLAUDE, credentialKey: HOW_SURE },
    seed: "full",
    jev: "on",
    expect: { selector: ".meet-jev .jev-note" },
    steps: [
      { click: { button: "Copy" } },
      { waitFor: { text: "What came back" } },
      { paste: HOW_SURE_REPLY },
      { click: { button: "Next" } },
      { waitFor: { selector: ".meet-jev .jev-note" } },
    ],
    clip: { selector: ".meet-text-rubric", pad: 8 },
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
    // One target added, and a second being typed: the target from the old tester's sheet,
    // whose "by" clause the app offers to move.
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
      { fill: { label: "New learning target" }, value: "I can choose dinners the whole household will eat" },
      { click: { button: "Add another" } },
      { waitFor: { text: "I can choose dinners the whole household will eat" } },
      { fill: { label: "New learning target" }, value: "I can plan a week of dinners by checking what's already in the fridge" },
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
    // Nobody holds Write a release note, so the screen after Met offers to make Claude Code
    // its go-to.
    id: "go-to-offer",
    page: "how-to/choose-a-go-to",
    route: RELEASE_TEST,
    seed: "full",
    jev: "off",
    expect: { text: "Make Claude Code the go-to" },
    steps: [
      ...RELEASE_TO_REPLY,
      { click: { button: "Next" } },
      { waitFor: { text: "Did it meet it" } },
      { click: { button: "Met" } },
      { waitFor: { text: "Make Claude Code the go-to" } },
    ],
  },
  {
    // Codex holds Check an answer key and nobody has made it the go-to. The holders show
    // once the matrix is built, so the picture waits for the offer.
    id: "go-to-badge",
    page: "how-to/choose-a-go-to",
    route: { view: "item", item: "badge", credentialKey: ANSWER_KEY },
    seed: "full",
    jev: "off",
    expect: { text: "Make go-to" },
    steps: [{ waitFor: { text: "Make go-to" } }],
    clip: { selector: 'section[aria-labelledby="badge-holders"]', pad: 24 },
  },
  {
    // Claude Code is Say how sure you are's go-to. Saving a changed rubric opens the badge's
    // page, and closing it shows home's Badges with the go-to's line flagged. The sample
    // folder stays unflagged, so no other picture changes.
    id: "go-to-flagged",
    page: "how-to/choose-a-go-to",
    route: { view: "deck", deck: "edit-credential", credentialKey: HOW_SURE, part: "rubric" },
    seed: "full",
    jev: "off",
    expect: { text: "Go-to: Claude Code · task changed" },
    steps: [
      { paste: "Each confidence comes with a reason. " },
      { click: { button: "Next" } },
      { waitFor: { text: "Holders will re-test" } },
      { click: { button: "Save" } },
      { waitFor: { selector: 'section[aria-labelledby="badge-holders"]' } },
      { click: { button: "Close" } },
      { waitFor: { text: "Go-to: Claude Code · task changed" } },
    ],
    clip: { selector: 'section[aria-labelledby="home-badges"]', pad: 8 },
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
    // After Not yet, the test asks which of the rubric's points the reply missed, none pressed.
    id: "missed-points",
    page: "how-to/judge-a-reply",
    route: RELEASE_TEST,
    seed: "full",
    jev: "off",
    expect: { text: "Which points did it miss" },
    steps: [
      ...RELEASE_TO_REPLY,
      { click: { button: "Next" } },
      { waitFor: { text: "Did it meet it" } },
      { click: { button: "Not yet" } },
      { waitFor: { text: "Which points did it miss" } },
    ],
  },
  {
    // Claude Code takes Write a release note and its reply is held: the screen after holding.
    id: "held",
    page: "how-to/run-a-bake-off",
    route: RELEASE_TEST,
    seed: "full",
    jev: "off",
    expect: { text: "Reply held" },
    steps: [
      ...RELEASE_TO_REPLY,
      { click: { button: "Next" } },
      { waitFor: { text: "Did it meet it" } },
      { click: { button: "Hold to compare" } },
      { waitFor: { text: "Test another agent" } },
    ],
  },
  {
    // The bake-off on Check an answer key, as What needs you opens it, with Codex's Met take
    // there as a third in the strip: both held replies open, each with Met and Not yet.
    id: "compare-held",
    page: "how-to/run-a-bake-off",
    route: {
      view: "item",
      item: "compare",
      credentialKey: ANSWER_KEY,
      takes: [CLAUDE_HELD, CODEX_HELD, CODEX_ANSWER_KEY],
      picks: [CLAUDE_HELD, CODEX_HELD, CODEX_ANSWER_KEY],
    },
    seed: "full",
    jev: "off",
    expect: { selector: ".compare-strip" },
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
    // A screenshot of the merged changes pasted at the end of Write a release note's task.
    // Ready once the picture has been saved and read back into the box.
    id: "paste-image",
    page: "how-to/paste-an-image",
    route: { view: "deck", deck: "edit-credential", credentialKey: RELEASE_NOTE, part: "task" },
    seed: "full",
    jev: "off",
    expect: { selector: ".rich-input .rich-image img[src^='data:image/png']" },
    steps: [{ pasteImage: "pasted-sample" }, { waitFor: { selector: ".rich-input .rich-image img[src^='data:image/png']" } }],
  },
  {
    // A short clip added at the end of Write a release note's task with the Video key. The
    // sample's picker adds src/shots/sample-clip.webm, which Chromium plays. Ready once the
    // player shows a frame.
    id: "add-video",
    page: "how-to/add-a-video",
    route: { view: "deck", deck: "edit-credential", credentialKey: RELEASE_NOTE, part: "task" },
    seed: "full",
    jev: "off",
    expect: { selector: ".rich-input .rich-video video[src^='blob:']" },
    steps: [
      { focusEnd: { selector: ".rich-input" } },
      { click: { button: "Video" } },
      { waitFor: { selector: ".rich-input .rich-video video[src^='blob:']" } },
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
    // The badges the agent has tried show only once the matrix is built, and their list
    // renders empty before that, so the picture waits for a badge in it.
    id: "agent-page",
    page: "how-to/fill-in-an-agent",
    route: { view: "item", item: "agent", profileSlug: CLAUDE },
    seed: "full",
    jev: "off",
    expect: { text: "Parameters" },
    steps: [{ waitFor: { selector: ".detail-earned li" } }],
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
  "deck:test": ["test-hand", "test-reply", "judge", "go-to-offer", "missed-points", "held", "jev-ask", "jev-cleanup", "jev-sends"],
  "deck:edit-credential": ["edit-retest", "go-to-flagged", "paste-image", "add-video"],
  "deck:edit-agent": ["agent-params"],
  "deck:handoffs": ["handoffs-box"],
  "deck:edit-handoff": ["handoff-edit"],
  "deck:trash": ["trash-badge", "trash-agent"],
  "deck:jev": ["jev-off", "jev-on"],
  "item:badge": ["badge-replies", "badge-page", "go-to-badge"],
  "item:agent": ["agent-page"],
  // A handoff opens as its own item only once two or more have results; the sample's has none.
  "item:handoff": NOT_PICTURED,
  "item:reply": ["reply-view", "jev-reading"],
  "item:compare": ["compare", "compare-held"],
};
