// A local check on learning-target text. Ported from coach knowledge/slt-patterns
// (quality-issues.yaml, successful-rewrites.yaml): a target says what its holder can do,
// and a list of items, a quantity or a "by doing X" clause is how you will judge it,
// so it belongs in the rubric. The check never blocks. It offers to move the detail.
//
// Two skills joined by "and" is fuzzy (coach asks "two steps of one workflow, or two
// independent skills?"), so it is only asked, never moved, and only for a second skill
// that explains or describes, the case coach's rewrites show.

export interface TargetMove {
  kind: "move";
  issue: "list" | "quantity" | "how";
  /** The target without the detail. */
  target: string;
  /** The detail, as a line for the rubric. */
  rubricLine: string;
}

export type TargetCheck = TargetMove | { kind: "ask"; issue: "two-skills" } | null;

/** Items a list is made of: a comma, an arrow, ">" or "+" between them. */
const LIST_MARK = /,|→|->|>|\+/;
/** Words that introduce an inline list. */
const INTRO_WORDS = /\s(for|using|with|in|including|across|via|like|such as)\s/gi;
const AT_LEAST = /\bat least (one|a|an|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(\S+)/i;
/** Vowel-letter words that take "a": a unit, a user, a one-off. */
const A_BEFORE_VOWEL = /^(uni|use|usu|uti|ure|eu|one|once)/i;
/** Words after "by" that end in -ing and are not verbs. */
const ING_NOUNS = "thing|string|spring|ring|king|nothing|something|anything|everything|morning|evening";
const HOW_CLAUSE = new RegExp(`,?\\s+(by\\s+(?!(?:${ING_NOUNS})\\b)[a-z]{2,}ing\\b.*)$`, "i");

export function checkTarget(text: string): TargetCheck {
  const t = text.trim();
  if (t === "") return null;
  return howClause(t) ?? colonList(t) ?? parenList(t) ?? inlineList(t) ?? quantity(t) ?? twoSkills(t);
}

/** Appends a line to a Markdown rubric as a list item, once. */
export function appendToRubric(rubric: string, line: string): string {
  const r = rubric.trimEnd();
  if (r === "") return `- ${line}`;
  if (r.split("\n").some((l) => l.trim() === `- ${line}` || l.trim() === `* ${line}`)) return r;
  const lastLine = r.slice(r.lastIndexOf("\n") + 1);
  return /^\s*[-*] /.test(lastLine) ? `${r}\n- ${line}` : `${r}\n\n- ${line}`;
}

// ---------------------------------------------------------------------------

function move(issue: TargetMove["issue"], target: string, detail: string): TargetCheck {
  const cleanTarget = target
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/,([.!?])$/, "$1")
    .trim();
  // A target left with fewer than three words lost its meaning, not its detail.
  if (cleanTarget.split(/\s+/).length < 3) return null;
  const line = detail.trim().replace(/[.,;:!?]+$/, "");
  return { kind: "move", issue, target: cleanTarget, rubricLine: line.charAt(0).toUpperCase() + line.slice(1) };
}

/** Splits trailing sentence punctuation off, so a removal can put it back. */
function splitEnd(t: string): [string, string] {
  const m = /([.!?]*)$/.exec(t);
  const end = m ? m[1] : "";
  return [t.slice(0, t.length - end.length), end];
}

/** "... by identifying X": the assessment method, to the end of the sentence. */
function howClause(t: string): TargetCheck {
  const [body, end] = splitEnd(t);
  const m = HOW_CLAUSE.exec(body);
  if (!m) return null;
  return move("how", body.slice(0, m.index) + end, m[1]);
}

/** "...: X > Y > Z", with any "using the formula" that leads into it. */
function colonList(t: string): TargetCheck {
  const [body, end] = splitEnd(t);
  const i = body.indexOf(":");
  if (i < 0) return null;
  const list = body.slice(i + 1);
  if (!LIST_MARK.test(list)) return null;
  const lead = /\s+((?:using|with|via|following)\s+(?:the|a|an|this|my)\s+\w+)$/i.exec(body.slice(0, i));
  const start = lead ? lead.index : i;
  const detail = lead ? `${lead[1]}:${list}` : list;
  return move("list", body.slice(0, start) + end, detail);
}

/** "(X, Y, Z)" anywhere in the target. */
function parenList(t: string): TargetCheck {
  const m = /\s*\(([^()]*)\)/.exec(t);
  if (!m || !LIST_MARK.test(m[1])) return null;
  return move("list", t.slice(0, m.index) + t.slice(m.index + m[0].length), m[1]);
}

/** "... using X, Y, and Z" at the end of the target: three or more short items. */
function inlineList(t: string): TargetCheck {
  const [body, end] = splitEnd(t);
  const comma = body.indexOf(",");
  if (comma < 0) return null;
  // The list starts at the last introducing word before its first comma.
  let start = -1;
  for (const m of body.slice(0, comma).matchAll(INTRO_WORDS)) start = m.index;
  if (start < 0) return null;
  const phrase = body.slice(start).trim();
  const items = phrase
    .replace(/^\S+(\s+as)?\s+/i, "")
    .split(/,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/i)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (items.length < 3 || items.some((s) => s.split(/\s+/).length > 5)) return null;
  return move("list", body.slice(0, start) + end, phrase);
}

/** "at least N": the count belongs in the rubric. */
function quantity(t: string): TargetCheck {
  const m = AT_LEAST.exec(t);
  if (!m) return null;
  const single = /^(one|a|an)$/i.test(m[1]);
  const vowel = /^[aeiou]/i.test(m[2]) && !A_BEFORE_VOWEL.test(m[2]);
  const article = single ? (vowel ? "an " : "a ") : "";
  const target = t.slice(0, m.index) + article + t.slice(m.index + m[0].length - m[2].length);
  return move("quantity", target, t.slice(m.index));
}

/** A second skill that explains or describes, joined by "and". */
function twoSkills(t: string): TargetCheck {
  return /\sand\s+(explain|describe|how|why)\b/i.test(t) ? { kind: "ask", issue: "two-skills" } : null;
}
