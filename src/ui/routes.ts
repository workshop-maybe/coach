// Where the app is (KTD1): home, a deck in progress, or one item open. The legacy
// views stay routable until U8 retires them, but nothing on home leads to them.

import type { Slug } from "../domain/types";

/** The parts of a credential that open as one-beat edits (R4). */
export type CredentialPart = "name" | "targets" | "task" | "rubric" | "look";

export type DeckRoute =
  | { view: "deck"; deck: "credential" }
  | { view: "deck"; deck: "agent" }
  | {
      view: "deck";
      deck: "test";
      profileSlug?: Slug;
      credentialKey?: string;
      /** Resume a copied test at "what came back" (R17). */
      resume?: boolean;
    }
  | { view: "deck"; deck: "edit-credential"; credentialKey: string; part: CredentialPart };

export type ItemRoute = { view: "item"; item: "badge"; credentialKey: string } | { view: "item"; item: "agent"; profileSlug: Slug };

/** The retired views, kept routable until U8 deletes them. */
export type LegacyRoute =
  | { view: "collections"; collectionSlug?: string; credentialKey?: string }
  | { view: "agents"; profileSlug?: string }
  | { view: "matrix"; cellKey?: string };

export type Route = { view: "home" } | DeckRoute | ItemRoute | LegacyRoute;
