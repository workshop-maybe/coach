// jev-in-compare U1, KTD14: Jev's reading as the folder saves it. A held reply keeps it
// seen before any verdict (hold-and-compare KTD9); a result keeps it seen before or after
// the pick, and one seen after says whether the saved verdict differs (R13). The input is
// what any caller holds about a reading, so the test deck and compare build the same file.

import type { JevReadingParts } from "./secondOpinion";
import type { AssessmentResult, JevReading } from "./types";

/** A reading in hand, with what it was asked about. */
export interface SavedReadingInput {
  /** Jev's answers: overall, one per rubric point and one per learning target asked. */
  parts: JevReadingParts;
  /** The model that answered (growing context KTD3). */
  model: string;
  /** The assignment version the reading was taken against. */
  assignmentVersion: string;
  /** Full ISO 8601 time of the ask. */
  askedAt: string;
  /** How many distinct earlier replies the request quoted (growing context KTD6). */
  examplesSent: number;
  /** The pick when the reading arrived, or null when it came before one (R13). */
  verdictWhenSeen: AssessmentResult | null;
}

/**
 * What every saved reading keeps (growing context KTD14): the model that answered, the
 * targets when any were asked, and how many earlier replies went, zero included, so a
 * reading taken before asks quoted any stays distinguishable.
 */
function readingFields(reading: Omit<SavedReadingInput, "verdictWhenSeen">): Omit<JevReading, "seen" | "verdictWhenSeen" | "verdictChanged"> {
  const { overall, points, targets } = reading.parts;
  return {
    model: reading.model,
    assignmentVersion: reading.assignmentVersion,
    askedAt: reading.askedAt,
    overall,
    points,
    ...(targets.length > 0 ? { targets } : {}),
    examplesSent: reading.examplesSent,
  };
}

/** The reading as a held reply keeps it: seen before the verdict, which is given later (hold-and-compare KTD9). */
export function readingBeforeVerdict(reading: Omit<SavedReadingInput, "verdictWhenSeen">): JevReading {
  return { ...readingFields(reading), seen: "before" };
}

/** The reading as the result keeps it. One seen after a pick says whether the saved verdict differs (R13). */
export function savedReading(reading: SavedReadingInput, verdict: AssessmentResult): JevReading {
  const base = readingFields(reading);
  return reading.verdictWhenSeen === null
    ? { ...base, seen: "before" }
    : { ...base, seen: "after", verdictWhenSeen: reading.verdictWhenSeen, verdictChanged: verdict !== reading.verdictWhenSeen };
}
