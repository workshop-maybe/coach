// The guide's five parts and the order its pages read in (U2, R4–R7, R13). Plain
// TypeScript with no Astro imports, so the collection schema, the navigation and the
// guide's vitest checks (U3) all read the same list.

/** The site's name: the home page's title, and the end of every other page's tab title. */
export const SITE_NAME = "Coach guide";

/** The parts, in the order navigation lists them. */
export const PART_IDS = ["getting-started", "ideas", "how-to", "help", "jev"] as const;

export type PartId = (typeof PART_IDS)[number];

/** What navigation calls each part. */
export const PART_LABELS: Record<PartId, string> = {
  "getting-started": "Getting started",
  ideas: "Ideas",
  "how-to": "How to",
  help: "Jev Mode, data and help",
  jev: "Jev under the hood",
};

/** The feedback page's entry id, which the footer links on every page (R8). */
export const FEEDBACK_ID = "help/feedback";

/** What navigation needs from a page: its entry id and its frontmatter. */
export interface PageSummary {
  id: string;
  title: string;
  part: PartId;
  order: number;
}

/** A page's address: its entry id as a folder, so a page at how-to/export is /how-to/export/. */
export function pageHref(id: string): string {
  return `/${id}/`;
}

/** Pages in reading order: by part, then by `order`, then by title. */
export function inReadingOrder<T extends PageSummary>(pages: readonly T[]): T[] {
  return [...pages].sort(
    (a, b) =>
      PART_IDS.indexOf(a.part) - PART_IDS.indexOf(b.part) || a.order - b.order || a.title.localeCompare(b.title),
  );
}

/** Each part with its pages in order, leaving out a part with no pages yet. */
export function byPart<T extends PageSummary>(pages: readonly T[]): { part: PartId; label: string; pages: T[] }[] {
  const ordered = inReadingOrder(pages);
  return PART_IDS.map((part) => ({ part, label: PART_LABELS[part], pages: ordered.filter((p) => p.part === part) })).filter(
    (group) => group.pages.length > 0,
  );
}

/** The page after this one in its own part, if there is one. */
export function nextInPart<T extends PageSummary>(pages: readonly T[], id: string): T | undefined {
  const ordered = inReadingOrder(pages);
  const at = ordered.findIndex((p) => p.id === id);
  const next = at < 0 ? undefined : ordered[at + 1];
  return next && next.part === ordered[at].part ? next : undefined;
}
