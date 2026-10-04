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
 */
export type Step = { click: Target } | { fill: Target; value: string } | { paste: string; into?: Target } | { waitFor: Target };

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
    id: "home",
    page: "ideas/your-record",
    route: { view: "home" },
    seed: "full",
    jev: "off",
    expect: { text: "What needs you" },
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
  home: ["home-empty", "home"],
  "deck:credential": NOT_PICTURED,
  "deck:agent": ["first-test-agent"],
  "deck:test": NOT_PICTURED,
  "deck:edit-credential": NOT_PICTURED,
  "deck:edit-agent": NOT_PICTURED,
  "deck:handoffs": NOT_PICTURED,
  "deck:edit-handoff": NOT_PICTURED,
  "deck:trash": NOT_PICTURED,
  "deck:jev": ["jev-off", "jev-on"],
  "item:badge": NOT_PICTURED,
  "item:agent": NOT_PICTURED,
  "item:handoff": NOT_PICTURED,
  "item:reply": NOT_PICTURED,
  "item:compare": NOT_PICTURED,
};
