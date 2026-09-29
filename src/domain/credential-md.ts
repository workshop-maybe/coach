// Credential Markdown (KTD4): `# name`, then `## Learning targets` (numbered list),
// `## Task` and `## Rubric`. Any other H2 section, and any text between the title and
// the first H2, is kept verbatim so hand edits survive an app save.

import type { Credential, ExtraSection, Slug } from "./types";

const H1 = /^#\s+(.*?)\s*#*\s*$/;
const H2 = /^##\s+(.*?)\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^\s*(?:\d+[.)]|[-*+])\s+(.*)$/;

type Known = "learning targets" | "task" | "rubric";
const KNOWN = new Set<string>(["learning targets", "task", "rubric"]);

/** Extra-section heading that marks text between the title and the first H2. */
export const PREAMBLE = "";

/** Drops blank edge lines and trailing whitespace; keeps inner text as written. */
function trimBlock(lines: string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end).join("\n").replace(/\s+$/, "");
}

function parseTargets(lines: string[]): string[] {
  const targets: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    const item = LIST_ITEM.exec(line);
    if (item) targets.push(item[1].trim());
    else if (targets.length > 0) targets[targets.length - 1] += ` ${line.trim()}`;
    else targets.push(line.trim());
  }
  return targets.filter((t) => t !== "");
}

export function parseCredentialMd(text: string, ids: { slug: Slug; collectionSlug: Slug }): Credential {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  let name: string | null = null;
  const preamble: string[] = [];
  const sections: { heading: string; lines: string[] }[] = [];
  let fence: string | null = null;
  const current = () => sections[sections.length - 1]?.lines ?? preamble;

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);
    if (fence !== null) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      current().push(line);
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      current().push(line);
      continue;
    }
    const h2 = H2.exec(line);
    if (h2) {
      sections.push({ heading: h2[1], lines: [] });
      continue;
    }
    if (sections.length === 0) {
      const h1 = H1.exec(line);
      if (h1 && name === null) name = h1[1];
      else preamble.push(line);
      continue;
    }
    sections[sections.length - 1].lines.push(line);
  }

  if (name === null || name === "") {
    throw new Error("Credential file has no H1 title (expected a first line like `# Credential name`).");
  }

  const credential: Credential = {
    ...ids,
    name,
    learningTargets: [],
    task: "",
    rubric: "",
    extraSections: [],
  };
  const seen = new Set<Known>();
  const extras: ExtraSection[] = [];
  const intro = trimBlock(preamble);
  if (intro !== "") extras.push({ heading: PREAMBLE, body: intro });

  for (const section of sections) {
    const key = section.heading.trim().toLowerCase();
    if (KNOWN.has(key) && !seen.has(key as Known)) {
      seen.add(key as Known);
      if (key === "learning targets") credential.learningTargets = parseTargets(section.lines);
      else if (key === "task") credential.task = trimBlock(section.lines);
      else credential.rubric = trimBlock(section.lines);
    } else {
      extras.push({ heading: section.heading, body: trimBlock(section.lines) });
    }
  }
  credential.extraSections = extras;
  return credential;
}

export function serializeCredentialMd(credential: Credential): string {
  const blocks: string[] = [`# ${credential.name.trim()}`];
  const intro = credential.extraSections.find((e) => e.heading === PREAMBLE);
  if (intro && intro.body.trim() !== "") blocks.push(trimBlock(intro.body.replace(/\r\n?/g, "\n").split("\n")));
  blocks.push("## Learning targets");
  const targets = credential.learningTargets
    .map((t) => t.replace(/\s*\n\s*/g, " ").trim())
    .filter((t) => t !== "");
  if (targets.length > 0) blocks.push(targets.map((t, i) => `${i + 1}. ${t}`).join("\n"));

  const section = (heading: string, body: string) => {
    blocks.push(`## ${heading}`);
    const trimmed = trimBlock(body.replace(/\r\n?/g, "\n").split("\n"));
    if (trimmed !== "") blocks.push(trimmed);
  };
  section("Task", credential.task);
  section("Rubric", credential.rubric);
  for (const extra of credential.extraSections) {
    if (extra.heading !== PREAMBLE) section(extra.heading.trim(), extra.body);
  }

  return `${blocks.join("\n\n")}\n`;
}
