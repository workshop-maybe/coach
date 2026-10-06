// Where the app is (KTD1): home, a deck in progress, or one item open.

import type { RouteOutcome } from "../domain/router";
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

/**
 * The router deck's answers, carried through a detour (the cost order, or a badge made from
 * the job) so its card comes back as it was, without asking Jev again (router KTD11). Held in
 * the route only, never in storage.
 */
export interface RouterResume {
  job: string;
  /** What Jev found, when the user asked. */
  outcome?: RouteOutcome;
  /** The badge the user picked from the list, by credential key, or NONE_OF_THESE. */
  picked?: string;
  /** A badge tapped from Jev's "Also like", by credential key. */
  tapped?: string;
}

/** A job the router matched to no badge, carried into the credential deck as its task, with the way back (router KTD14). */
export interface FromJob {
  task: string;
  router: RouterResume;
}

/** A pick of "None of these" on the router's badge list. */
export const NONE_OF_THESE = "none";

/** Which handoff an edit opens: a badge handoff's id (its stem), "new", or "skeleton" (KTD3, KTD10). */
export type HandoffTarget = string;

export type DeckRoute =
  /**
   * With `fromJob`, a badge made from a job: the job as its task, and Close back to the router's card (router KTD14).
   * With `collectionSlug`, the badge is made in that collection instead of where KTD4 lands it.
   */
  | { view: "deck"; deck: "credential"; returnTo?: TestPick; fromJob?: FromJob; collectionSlug?: Slug }
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
  | { view: "deck"; deck: "trash"; item: TrashItem }
  /** Jev Mode: turn it on with a key, turn it off, use a new key or remove it (KTD6). Opened from the top bar. */
  | { view: "deck"; deck: "jev" }
  /** Find an agent for a job (router R1). With `resume`, it opens on its card as it was. */
  | { view: "deck"; deck: "router"; resume?: RouterResume }
  /** The cost order over the agents (router R10, KTD12). With `returnTo`, it goes back to the router's card. */
  | { view: "deck"; deck: "cost-order"; returnTo?: RouterResume }
  /** Add a collection: an empty one or a built-in (collections plan R7). */
  | { view: "deck"; deck: "collection" };

/** An agent or a credential on its way to the trash. */
export type TrashItem = { kind: "agent"; profileSlug: Slug } | { kind: "badge"; credentialKey: string };

/**
 * One take: an agent's result or held reply on a badge, named by the agent and the file stem,
 * since stems can repeat across agents (KTD7). A held reply's result takes its stem, so the
 * same reference names it before and after it is judged (hold-and-compare KTD3).
 */
export interface TakeRef {
  profileSlug: Slug;
  fileStem: string;
}

/**
 * What a badge or handoff route hands its reply list. `lit` names the agent whose reply
 * the view is about (R4, R14). Back from an opened reply, `litTake` names the lit agent's
 * take to focus and `picks` the list's picks, kept (R16, KTD7). Back from the compare,
 * the picks are kept and `focusCompare` gives the Compare button the focus (R17, KTD10).
 */
export interface ReplyListState {
  lit?: Slug;
  /** The file stem of the lit agent's take. */
  litTake?: string;
  picks?: TakeRef[];
  focusCompare?: true;
}

/**
 * One item open: a badge, an agent, one of a badge's handoffs once two or more have run
 * (R12), one take's reply (R15, KTD7), or a compare (R17, KTD10): two or more takes in strip
 * order, two of them open at a time (hold-and-compare KTD10). The reply and the compare
 * carry the list's picks so their way back can keep them.
 */
export type ItemRoute =
  | ({ view: "item"; item: "badge"; credentialKey: string } & ReplyListState)
  | { view: "item"; item: "agent"; profileSlug: Slug }
  | ({ view: "item"; item: "handoff"; credentialKey: string; handoffId: string } & ReplyListState)
  | { view: "item"; item: "reply"; credentialKey: string; take: TakeRef; picks?: TakeRef[] }
  | { view: "item"; item: "compare"; credentialKey: string; takes: TakeRef[]; picks?: TakeRef[] };

/** Home. `litCollection` names a collection just added, whose group lights (collections plan U5). */
export type HomeRoute = { view: "home"; litCollection?: Slug };

export type Route = HomeRoute | DeckRoute | ItemRoute;
