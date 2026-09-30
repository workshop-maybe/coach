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
}

export type DeckRoute =
  | { view: "deck"; deck: "credential"; returnTo?: TestPick }
  | { view: "deck"; deck: "agent"; returnTo?: TestPick; likeSlug?: Slug }
  | {
      view: "deck";
      deck: "test";
      profileSlug?: Slug;
      credentialKey?: string;
      /** Resume a copied test at "what came back" (R17). */
      resume?: boolean;
    }
  | { view: "deck"; deck: "edit-credential"; credentialKey: string; part: CredentialPart }
  | { view: "deck"; deck: "edit-agent"; profileSlug: Slug; part: AgentPart }
  | { view: "deck"; deck: "trash"; item: TrashItem };

/** An agent or a credential on its way to the trash. */
export type TrashItem = { kind: "agent"; profileSlug: Slug } | { kind: "badge"; credentialKey: string };

export type ItemRoute = { view: "item"; item: "badge"; credentialKey: string } | { view: "item"; item: "agent"; profileSlug: Slug };

export type Route = { view: "home" } | DeckRoute | ItemRoute;
