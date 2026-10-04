// The router's recommendation (R7-R11, R13, KTD8), worked out from the folder every time
// the card draws: nothing derived is stored. It walks the folder's own agents, never the
// matrix's rows, since the matrix is rebuilt after each reload and can lag the folder by
// one build; an agent with no cell reads as untested.
//
// An agent holds a badge cleanly when its latest result there is Met with no flags (R7).
// Clean holders rank by the cost order: placed agents by their place, then the unplaced
// ones, tied as most expensive (R11). The pick is the badge's go-to when it holds cleanly,
// else the cheapest clean holder, but only one with a place: a pick between unplaced agents
// would only be alphabetical, so then there is no pick (R10). A job Jev rates unusual or
// high-stakes steps up to the next placed clean holder (R9).

import { goToOf } from "./goTo";
import { cellKey, type Cell, type CellFlag, type Matrix } from "./matrix";
import type { AgentProfile, Assessment, FolderState, PickBasis, Rating, Slug } from "./types";

/** An agent that holds the badge cleanly, with its latest Met result there. */
export interface CleanHolder {
  profile: AgentProfile;
  /** Whether the cost order names it. An unplaced agent counts as most expensive (R11). */
  placed: boolean;
  /** Its latest result on the badge, a Met with no flags. */
  latest: Assessment;
}

/**
 * What became of a step-up (R9). `none`: the job wasn't rated unusual or high-stakes.
 * `stepped-up`: the pick is the next placed clean holder above the base. `nothing-above`:
 * no other clean holder ranks above the pick. `blocked-by-order`: an unplaced clean holder
 * ranks above a placed pick, or ties with an unplaced one, so the cost order can't say
 * which is next.
 */
export type StepUp = "none" | "stepped-up" | "nothing-above" | "blocked-by-order";

export type Recommendation =
  /** Nobody holds the badge cleanly (R13). `flagged` names each agent whose Met is flagged, and why. */
  | { kind: "no-holder"; flagged: { profile: AgentProfile; flags: CellFlag[] }[] }
  /**
   * Clean holders, but no go-to that holds cleanly and no placed one to pick (R10). With
   * `noCostOrder`, no agent in the folder has a place; otherwise these holders have none.
   */
  | { kind: "no-pick"; holders: CleanHolder[]; noCostOrder: boolean }
  | {
      kind: "pick";
      pick: CleanHolder;
      basis: Exclude<PickBasis, "none">;
      step: StepUp;
      /** Placed clean holders ranked below the pick, cheapest first. */
      cheaper: CleanHolder[];
      /** The first placed clean holder ranked above the pick. */
      nextUp: CleanHolder | null;
      /** Every other clean holder, in cost order. */
      alternatives: CleanHolder[];
    };

/** Each placed agent's place in the cost order, counting only agents still in the folder. */
export function costPlaces(state: FolderState): Map<Slug, number> {
  const live = new Set(state.profiles.map((p) => p.slug));
  const places = new Map<Slug, number>();
  for (const slug of state.costOrder ?? []) if (live.has(slug) && !places.has(slug)) places.set(slug, places.size);
  return places;
}

/** The folder's agents cheapest first: placed ones by their place, then the rest by name (R11). */
export function byCost(state: FolderState): AgentProfile[] {
  const places = costPlaces(state);
  const placed = state.profiles.filter((p) => places.has(p.slug)).sort((a, b) => places.get(a.slug)! - places.get(b.slug)!);
  return [...placed, ...state.profiles.filter((p) => !places.has(p.slug))];
}

/** The cell when its latest result is Met with no flags (R7), else null. */
function cleanCell(matrix: Matrix, slug: Slug, key: string): Cell | null {
  const cell = matrix.cells.get(cellKey(slug, key));
  return cell && cell.status === "met" && cell.flags.length === 0 && cell.latest ? cell : null;
}

/** The recommendation for a badge, from the folder and its matrix as they are now (KTD8). */
export function recommend(state: FolderState, matrix: Matrix, key: string, rating: Rating | null): Recommendation {
  const places = costPlaces(state);
  const holders: CleanHolder[] = [];
  for (const profile of byCost(state)) {
    const cell = cleanCell(matrix, profile.slug, key);
    if (cell) holders.push({ profile, placed: places.has(profile.slug), latest: cell.latest! });
  }

  if (holders.length === 0) {
    const flagged = state.profiles.flatMap((profile) => {
      const cell = matrix.cells.get(cellKey(profile.slug, key));
      return cell && cell.status === "met" && cell.flags.length > 0 ? [{ profile, flags: [...cell.flags] }] : [];
    });
    return { kind: "no-holder", flagged };
  }

  const goTo = goToOf(state, key);
  const goToHolder = goTo ? holders.find((h) => h.profile.slug === goTo.profile.slug) : undefined;
  const base = goToHolder ?? (holders[0].placed ? holders[0] : undefined);
  if (!base) return { kind: "no-pick", holders, noCostOrder: places.size === 0 };

  const rank = (h: CleanHolder) => (h.placed ? places.get(h.profile.slug)! : Infinity);
  const above = (h: CleanHolder) => holders.filter((o) => o !== h && rank(o) > rank(h));

  let pick = base;
  let step: StepUp = "none";
  if (rating === "high-stakes") {
    const placedAbove = above(base).filter((h) => h.placed);
    const unplacedAboveOrTied = holders.some((o) => o !== base && !o.placed && (base.placed || rank(o) === rank(base)));
    if (placedAbove.length > 0) {
      pick = placedAbove[0];
      step = "stepped-up";
    } else step = unplacedAboveOrTied ? "blocked-by-order" : "nothing-above";
  }

  return {
    kind: "pick",
    pick,
    basis: goToHolder ? "go-to" : "cheapest",
    step,
    cheaper: holders.filter((h) => h.placed && rank(h) < rank(pick)),
    nextUp: above(pick).find((h) => h.placed) ?? null,
    alternatives: holders.filter((h) => h !== pick),
  };
}
