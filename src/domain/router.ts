// The router (router plan): a job pasted as it would be handed to an agent, matched to the
// badge it is like, and rated for how hard it is. This module holds the text a routing ask
// sends and the job's first line a routing record keeps.

import { IMAGE, IMAGE_DATA, IMAGE_DEFINITION, INVISIBLE } from "./jevExamples";
import { LINE_BREAK } from "./jevRequest";
import { reasonLine } from "./reasonLine";

/**
 * Text as a routing ask sends it (KTD6): every line break read as `\n`, invisible and format
 * characters dropped line by line, image and video Markdown and their data URIs removed, and
 * a line left blank only by that removal dropped. Nothing else changes, so the user's words
 * and their order go as written. Trimmed.
 */
export function routeText(text: string): string {
  const kept: string[] = [];
  for (const raw of text.split(LINE_BREAK)) {
    const line = raw.replace(INVISIBLE, "");
    if (IMAGE_DEFINITION.test(line)) continue;
    const shown = line.replace(IMAGE, "").replace(IMAGE_DATA, "");
    if (shown !== line && shown.trim() === "") continue;
    kept.push(shown);
  }
  return kept.join("\n").trim();
}

/**
 * The job's first line as a routing record keeps it (KTD10): the first line with words once
 * pictures and invisible characters are gone, one line of at most 200 code points with any
 * leading heading marks dropped. Empty when the job has no words.
 */
export function jobFirstLine(job: string): string {
  const line = routeText(job)
    .split("\n")
    .find((l) => l.trim() !== "");
  return line === undefined ? "" : reasonLine(line);
}
