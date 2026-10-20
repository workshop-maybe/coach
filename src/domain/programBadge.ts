// Which badges are program badges (KTD3 of docs/plans/2026-10-20-1605-feat-bounded-programs-plan.md).
// It is derived, never stored: a badge in a copy of the Bounded programs built-in whose slug is one
// of the library's job ids. The slug stays fixed when the badge is renamed, and a badge the user
// adds to the copy is an ordinary badge.

import { isQdlJobId, type QdlJobId } from "./quinelings";
import type { Collection, Credential } from "./types";

/** The built-in collection's id, which a copy carries as its `from`. */
export const BOUNDED_PROGRAMS = "bounded-programs";

/** The job a badge asks for, or null when it is not a program badge. */
export function programBadge(credential: Credential, collection: Collection): QdlJobId | null {
  return collection.from === BOUNDED_PROGRAMS && isQdlJobId(credential.slug) ? credential.slug : null;
}
