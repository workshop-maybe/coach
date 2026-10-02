// Where the app is (KTD1): home, a deck in progress, or one item open.

import type { Slug } from "../domain/types";

/** The parts of a credential that open as one-beat edits (R4). */
export type CredentialPart = "name" | "targets" | "task" | "rubric" | "look";

/** The parts of an agent that open as one-beat edits (R4). Its setup is the player card itself. */
export type AgentPart = "name" | "repo" | "notes" | "params";

/** What a test already has picked, carried through a detour to create the missing side (AE2). */
export interface TestPick {
  profileSlug?: Slug;
  credentialKey?: string;
  /** The handoff to light in the box: the one a handoff edit saved, or the test's own pick (KTD10). */
  handoffId?: string;
}

/** Which handoff an edit opens: a badge handoff's id (its stem), "new", or "skeleton" (KTD3, KTD10). */
export type HandoffTarget = string;

export type DeckRoute =
  | { view: "deck"; deck: "credential"; returnTo?: TestPick }
  /** With `firstTest`, making the agent also makes the first badge and starts its test (R3). */
  | { view: "deck"; deck: "agent"; returnTo?: TestPick; likeSlug?: Slug; firstTest?: true }
  | {
      view: "deck";
      deck: "test";
      profileSlug?: Slug;
      credentialKey?: string;
      /** Resume a copied test at "what came back" (R17). */
      resume?: boolean;
      /** The handoff to light, back from a handoff edit (KTD10). */
      handoffId?: string;
      /** The test held up while this one's plug is pulled; the pull goes back to it (R18, AE5). */
      returnTo?: TestPick;
    }
  | { view: "deck"; deck: "edit-credential"; credentialKey: string; part: CredentialPart }
  | { view: "deck"; deck: "edit-agent"; profileSlug: Slug; part: AgentPart }
  /** The handoff box for one badge (R9). With `returnTo`, it was opened from the test and goes back there. */
  | { view: "deck"; deck: "handoffs"; credentialKey: string; returnTo?: TestPick }
  /** One handoff, a new one or the skeleton, as a one-beat edit (R3, R4, R5). */
  | { view: "deck"; deck: "edit-handoff"; credentialKey: string; handoff: HandoffTarget; returnTo?: TestPick }
  | { view: "deck"; deck: "trash"; item: TrashItem };

/** An agent or a credential on its way to the trash. */
export type TrashItem = { kind: "agent"; profileSlug: Slug } | { kind: "badge"; credentialKey: string };

export type ItemRoute = { view: "item"; item: "badge"; credentialKey: string } | { view: "item"; item: "agent"; profileSlug: Slug };

export type Route = { view: "home" } | DeckRoute | ItemRoute;
