/// <reference types="node" />
// The guide's content check (U5, KTD8, R3, R11, R12, R19). Every page under
// site/src/content/guide is read as source, with the screenshot manifest in
// src/shots/shots.ts, and the check fails on:
//
// - a <UI> label that no longer matches a string literal, template literal or JSX text in
//   src/ui, src/domain, src/jev or src/intro. Source is read through the TypeScript parser, so a label
//   that lives only in a comment never counts, and test files and test stubs are skipped.
//   A templated label escapes its placeholder's braces (`Pull \{agent\}'s handoff`) and
//   matches any `${…}` (or JSX `{…}`) in that place;
// - a <Shot> whose id is not in the manifest, has no picture, or has no alt text;
// - a manifest shot that no page shows, or whose `page` does not show it, and a picture in
//   site/public/shots with no manifest entry;
// - a link to a guide page or a file that does not exist, or a relative link;
// - a heading, the title included, that ends in a period;
// - the word "machine" anywhere in a page (whole word, any case);
// - a page missing its title, part, order or description.
//
// Each problem is one line naming the page (or the shot or file) and what is wrong, so a
// failing run reads as a to-do list.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { SHOTS } from "../../src/shots/shots";
import { filesUnder } from "../../src/test/files";
import { PART_IDS, pageHref } from "../src/parts";
import { guidePages } from "./guidePages";

const ROOT = join(__dirname, "..", "..");
const SITE = join(ROOT, "site");
const PUBLIC = join(SITE, "public");
const SHOTS_DIR = join(PUBLIC, "shots");
/** Where the app's labels live (KTD8). */
const LABEL_DIRS = ["src/ui", "src/domain", "src/jev", "src/intro"];

// ---------------------------------------------------------------------------
// Labels in the app's source

/** Stands for a placeholder: `${…}` in a template, `{…}` in JSX, `\{name\}` in a page. */
const SLOT = "\uE000";

/** One label as compared: whitespace runs as one space, trimmed. */
const canon = (text: string) => text.replace(/\s+/g, " ").trim();

/** A label as a reader sees it in a problem line. */
const shown = (key: string) => key.replaceAll(SLOT, "{…}");

/** Test files and test stand-ins, whose strings never make a label pass. */
export function isTestSource(path: string, text: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/.test(path) || /stub\.[cm]?[jt]sx?$/i.test(path) || /from\s+["'](?:vitest|@testing-library\/[^"']+)["']/.test(text);
}

/**
 * Every piece of text one source file could show: its string literals, template literals
 * (each `${…}` a placeholder) and JSX text, plus each run of JSX text and `{…}` children
 * read as one templated label. Comments are not literals, so nothing in one counts.
 */
export function sourceLabels(path: string, text: string): string[] {
  const kind = /\.tsx$/.test(path) ? ts.ScriptKind.TSX : /\.ts$/.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JSX;
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kind);
  const out: string[] = [];
  const add = (label: string) => {
    const key = canon(label);
    if (key !== "") out.push(key);
  };

  const childRuns = (children: ts.NodeArray<ts.JsxChild>) => {
    let run = "";
    let slots = 0;
    let words = false;
    const flush = () => {
      if (words && slots > 0) add(run);
      run = "";
      slots = 0;
      words = false;
    };
    for (const child of children) {
      if (ts.isJsxText(child)) {
        run += child.text;
        if (!child.containsOnlyTriviaWhiteSpaces) words = true;
      } else if (ts.isJsxExpression(child)) {
        // A JSX comment, {/* … */}, holds no expression and shows nothing.
        if (!child.expression) continue;
        if (ts.isStringLiteral(child.expression) || ts.isNoSubstitutionTemplateLiteral(child.expression)) run += child.expression.text;
        else {
          run += SLOT;
          slots++;
        }
      } else flush();
    }
    flush();
  };

  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text);
    else if (ts.isTemplateExpression(node)) add(node.head.text + node.templateSpans.map((s) => SLOT + s.literal.text).join(""));
    else if (ts.isJsxText(node)) add(node.text);
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) childRuns(node.children);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/** The labels a set of source files can show, skipping test files. */
export function labelSet(files: readonly { path: string; text: string }[]): Set<string> {
  const labels = new Set<string>();
  for (const f of files) {
    if (!/\.[cm]?[jt]sx?$/.test(f.path) || isTestSource(f.path, f.text)) continue;
    for (const label of sourceLabels(f.path, f.text)) labels.add(label);
  }
  return labels;
}

/** The app's source in the label folders, as the check reads it. */
function appSources(): { path: string; text: string }[] {
  return LABEL_DIRS.flatMap((dir) => filesUnder(join(ROOT, dir))).map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, "utf8") }));
}

// ---------------------------------------------------------------------------
// Pages

export interface Page {
  /** The entry id, as the collection names it: how-to/export. */
  id: string;
  /** The page's MDX source. */
  text: string;
}

/** What a page is checked against. */
export interface Context {
  /** Labels the app's source can show. */
  labels: ReadonlySet<string>;
  /** Shot ids in the manifest. */
  shots: ReadonlySet<string>;
  /** Whether a file exists under site/public, by its address ("/shots/home.png"). */
  hasPublic(address: string): boolean;
  /** Every page's entry id. */
  pages: ReadonlySet<string>;
}

/** The page's frontmatter and body. A page without frontmatter has `data` null; frontmatter YAML can't read has `invalid`. */
function splitPage(text: string): { data: Record<string, unknown> | null; invalid?: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: null, body: text };
  const body = text.slice(m[0].length);
  try {
    const data: unknown = parseYaml(m[1]);
    return { data: data && typeof data === "object" ? (data as Record<string, unknown>) : {}, body };
  } catch (e) {
    return { data: {}, invalid: (e instanceof Error ? e.message : String(e)).split("\n")[0], body };
  }
}

/** The body with fenced code blocks blanked out, line for line, so headings inside them are not headings. */
function withoutFences(body: string): string {
  let fenced = false;
  return body
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return "";
      }
      return fenced ? "" : line;
    })
    .join("\n");
}

/** A <UI> label from a page, with each escaped `\{name\}` as a placeholder. */
export function pageLabel(raw: string): string {
  return canon(raw.replace(/\\\{[^{}\\]*\\\}/g, SLOT));
}

/** Everything wrong with one page, as lines naming the page. */
export function pageProblems(page: Page, ctx: Context): string[] {
  const out: string[] = [];
  const say = (what: string) => out.push(`${page.id}: ${what}`);
  const { data, invalid, body } = splitPage(page.text);

  // Frontmatter: the collection's schema, and the title is the page's h1 (R12).
  if (!data) say("has no frontmatter");
  else if (invalid) say(`has frontmatter YAML can't read (quote a value with a colon in it): ${invalid}`);
  else {
    const { title, part, order, description } = data;
    if (typeof title !== "string" || title.trim() === "") say("has no title");
    else if (/\.\s*$/.test(title)) say(`title "${title}" ends in a period`);
    if (typeof part !== "string" || !(PART_IDS as readonly string[]).includes(part)) say(`has no part (one of ${PART_IDS.join(", ")})`);
    else if (!page.id.startsWith(`${part}/`)) say(`is filed under ${page.id.split("/")[0]}/ but its part is ${part}`);
    if (typeof order !== "number" || !Number.isInteger(order)) say("has no order (a whole number)");
    if (typeof description !== "string" || description.trim() === "") say("has no description");
  }

  // Headings (R12).
  const prose = withoutFences(body);
  for (const m of prose.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) if (/\.$/.test(m[1])) say(`heading "${m[1]}" ends in a period`);
  for (const m of prose.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/g)) if (/\.\s*$/.test(m[1])) say(`heading "${canon(m[1])}" ends in a period`);

  // The word (R12). Plurals count too.
  for (const m of page.text.matchAll(/\bmachines?\b/gi)) say(`says "${m[0]}"`);

  // Labels (KTD8, R11).
  for (const m of body.matchAll(/<UI(\s[^>]*)?>([\s\S]*?)<\/UI>/g)) {
    const raw = m[2];
    if (/[<>]/.test(raw)) say(`<UI>${canon(raw)}</UI> holds markup; a label is plain text`);
    else if (/(^|[^\\])[{}]/.test(raw.replace(/\\\{[^{}\\]*\\\}/g, ""))) say(`<UI>${canon(raw)}</UI> has an unescaped brace; write a placeholder as \\{name\\}`);
    else if (pageLabel(raw) === "") say("has an empty <UI>");
    else if (!ctx.labels.has(pageLabel(raw))) say(`<UI>${canon(raw)}</UI> matches no label in ${LABEL_DIRS.join(", ")}`);
  }
  for (const _ of body.matchAll(/<UI\s*\/>/g)) say("has an empty <UI>");

  // Shots (R19).
  for (const m of body.matchAll(/<Shot\b([^>]*?)\/?>/g)) {
    const attrs = m[1];
    const id = /\bid\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
    const alt = /\balt\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
    if (!id) {
      say("has a <Shot> with no id");
      continue;
    }
    if (!ctx.shots.has(id)) say(`<Shot id="${id}"> is not in src/shots/shots.ts`);
    else if (!ctx.hasPublic(`/shots/${id}.png`)) say(`<Shot id="${id}"> has no picture; run npm run site:shots -- --only ${id}`);
    if (!alt || alt.trim() === "") say(`<Shot id="${id}"> has no alt text`);
  }

  // Links and images (R13).
  const targets = [
    ...[...body.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)].map((m) => m[1]),
    ...[...body.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]),
  ];
  for (const target of targets) {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue;
    if (!target.startsWith("/")) {
      say(`links to "${target}" relatively; link a page as /part/page/`);
      continue;
    }
    const address = target.replace(/[?#].*$/, "");
    if (address === "/") continue;
    const page = /^\/(.+)\/$/.exec(address)?.[1];
    if (page && ctx.pages.has(page)) continue;
    if (ctx.hasPublic(address)) continue;
    say(`links to ${target}, which is no page or file in the guide (pages are linked as ${pageHref("part/page")})`);
  }
  return out;
}

/** What is wrong between the manifest, the pages and the pictures, as lines naming each shot or file. */
export function shotProblems(shots: readonly { id: string; page: string }[], pages: readonly Page[], pictures: readonly string[]): string[] {
  const out: string[] = [];
  const shows = (page: Page | undefined, id: string) => !!page && new RegExp(`<Shot\\b[^>]*\\bid\\s*=\\s*"${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(page.text);
  for (const shot of shots) {
    if (!pages.some((p) => shows(p, shot.id))) out.push(`shot ${shot.id}: no page shows it`);
    else if (!shows(pages.find((p) => p.id === shot.page), shot.id)) out.push(`shot ${shot.id}: its page, ${shot.page}, does not show it`);
  }
  const ids = new Set(shots.map((s) => s.id));
  for (const file of pictures) {
    if (!ids.has(file.replace(/\.png$/, ""))) out.push(`site/public/shots/${file}: no entry in src/shots/shots.ts`);
  }
  return out;
}

function pictures(): string[] {
  return existsSync(SHOTS_DIR) ? readdirSync(SHOTS_DIR).filter((f) => !f.startsWith(".")) : [];
}

/** The app's labels, read and parsed once per run: both the fixture and the real-page checks use them. */
let appLabels: Set<string> | undefined;
const labelsInApp = () => (appLabels ??= labelSet(appSources()));

function realContext(pages: readonly Page[]): Context {
  return {
    labels: labelsInApp(),
    shots: new Set(SHOTS.map((s) => s.id)),
    hasPublic: (address) => existsSync(join(PUBLIC, ...address.split("/").filter(Boolean))),
    pages: new Set(pages.map((p) => p.id)),
  };
}

// ---------------------------------------------------------------------------
// The checker itself, on fixture pages

const FRONT = (title = "A page", extra = "") => `---\ntitle: ${title}\npart: getting-started\norder: 1\ndescription: What it is for.\n${extra}---\n`;

describe("the content check, on fixture pages", () => {
  const labels = labelsInApp();
  const ctx: Context = {
    labels,
    shots: new Set(["home", "first-run"]),
    hasPublic: (address) => ["/shots/home.png", "/shots/first-run.png"].includes(address),
    pages: new Set(["getting-started/fixture", "ideas/agents"]),
  };
  const check = (body: string, front = FRONT()) => pageProblems({ id: "getting-started/fixture", text: front + body }, ctx);

  it("passes a page citing a label the app shows (AE1)", () => {
    expect(check("Click <UI>Make the agent</UI>.\n")).toEqual([]);
  });

  it("fails a label the app does not show, naming the page and the label", () => {
    expect(check("Click <UI>Make the robot</UI>.\n")).toEqual([
      "getting-started/fixture: <UI>Make the robot</UI> matches no label in src/ui, src/domain, src/jev, src/intro",
    ]);
  });

  it("passes a templated label against its template literal in Home.tsx", () => {
    const home = readFileSync(join(ROOT, "src/ui/Home.tsx"), "utf8");
    expect(sourceLabels("src/ui/Home.tsx", home)).toContain(`Pull ${SLOT}'s handoff`);
    expect(check("Click <UI>Pull \\{agent\\}'s handoff</UI>.\n")).toEqual([]);
  });

  it("passes a label that is JSX text in Home.tsx", () => {
    const home = readFileSync(join(ROOT, "src/ui/Home.tsx"), "utf8");
    expect(sourceLabels("src/ui/Home.tsx", home)).toContain("What needs you");
    expect(check("Look under <UI>What needs you</UI>.\n")).toEqual([]);
  });

  it("reads JSX text around an expression as one templated label", () => {
    expect(sourceLabels("x.tsx", "const a = <h2>{profile.name} holds it</h2>;")).toContain(`${SLOT} holds it`);
    expect(sourceLabels("x.tsx", 'const a = <p>{a} holds the {b ?? "other"} handoff</p>;')).toContain(`${SLOT} holds the ${SLOT} handoff`);
  });

  it("fails a label that survives only in a source comment or a test file", () => {
    const only = labelSet([
      { path: "src/ui/Fake.tsx", text: '// Make the robot\n/* Hand over the robot */\nexport const x = <p>{/* Robot card */}</p>;\nexport const ok = "Keep me";' },
      { path: "src/ui/Fake.test.tsx", text: 'it("x", () => screen.getByText("Make the robot"));' },
      { path: "src/ui/fakeFixture.tsx", text: 'import { render } from "@testing-library/react";\nexport const label = "Hand over the robot";' },
      { path: "src/ui/robotStub.tsx", text: 'export const label = "Robot card";' },
    ]);
    expect([...only]).toEqual(["Keep me"]);
    const strict: Context = { ...ctx, labels: only };
    const problems = pageProblems({ id: "getting-started/fixture", text: FRONT() + "<UI>Make the robot</UI> <UI>Hand over the robot</UI> <UI>Robot card</UI> <UI>Keep me</UI>\n" }, strict);
    expect(problems).toEqual([
      "getting-started/fixture: <UI>Make the robot</UI> matches no label in src/ui, src/domain, src/jev, src/intro",
      "getting-started/fixture: <UI>Hand over the robot</UI> matches no label in src/ui, src/domain, src/jev, src/intro",
      "getting-started/fixture: <UI>Robot card</UI> matches no label in src/ui, src/domain, src/jev, src/intro",
    ]);
  });

  it("fails an unescaped brace or markup inside a label", () => {
    expect(check("<UI>Pull {agent}'s handoff</UI>\n")).toEqual([
      "getting-started/fixture: <UI>Pull {agent}'s handoff</UI> has an unescaped brace; write a placeholder as \\{name\\}",
    ]);
    expect(check("<UI>Make <b>the</b> agent</UI>\n")).toEqual(["getting-started/fixture: <UI>Make <b>the</b> agent</UI> holds markup; a label is plain text"]);
  });

  it("fails a shot that is not in the manifest, and one with no alt text", () => {
    expect(check('<Shot id="missing" alt="Something" />\n')).toEqual(['getting-started/fixture: <Shot id="missing"> is not in src/shots/shots.ts']);
    expect(check('<Shot id="home" />\n')).toEqual(['getting-started/fixture: <Shot id="home"> has no alt text']);
    expect(check('<Shot id="home" alt="Home, with two agents" />\n')).toEqual([]);
  });

  it("fails a shot in the manifest whose picture is missing", () => {
    const noPicture: Context = { ...ctx, hasPublic: () => false };
    expect(pageProblems({ id: "getting-started/fixture", text: FRONT() + '<Shot id="home" alt="Home" />\n' }, noPicture)).toEqual([
      'getting-started/fixture: <Shot id="home"> has no picture; run npm run site:shots -- --only home',
    ]);
  });

  it("fails a manifest shot no page shows, a shot its own page does not show, and a picture with no manifest entry", () => {
    const pages: Page[] = [
      { id: "getting-started/fixture", text: FRONT() + '<Shot id="home" alt="Home" />\n' },
      { id: "ideas/agents", text: FRONT() + '<Shot id="first-run" alt="The folder" />\n' },
    ];
    const shots = [
      { id: "home", page: "getting-started/fixture" },
      { id: "first-run", page: "getting-started/fixture" },
      { id: "jev-on", page: "help/jev-mode" },
    ];
    expect(shotProblems(shots, pages, ["home.png", "first-run.png", "jev-on.png", "stray.png"])).toEqual([
      "shot first-run: its page, getting-started/fixture, does not show it",
      "shot jev-on: no page shows it",
      "site/public/shots/stray.png: no entry in src/shots/shots.ts",
    ]);
  });

  it("fails a link to a guide page that does not exist, and a relative link", () => {
    expect(check("See [agents](/ideas/agents/) and [home](/) and [the picture](/shots/home.png).\n")).toEqual([]);
    expect(check("See [judging](/ideas/judging/).\n")).toEqual([
      "getting-started/fixture: links to /ideas/judging/, which is no page or file in the guide (pages are linked as /part/page/)",
    ]);
    expect(check('See <a href="/ideas/agent/">agents</a>.\n')).toEqual([
      "getting-started/fixture: links to /ideas/agent/, which is no page or file in the guide (pages are linked as /part/page/)",
    ]);
    expect(check("See [agents](../ideas/agents/).\n")).toEqual(['getting-started/fixture: links to "../ideas/agents/" relatively; link a page as /part/page/']);
    expect(check("Write to [James](mailto:james@andamio.io) or read [TypeSafe](https://typesafe.ai).\n")).toEqual([]);
  });

  it("fails a heading that ends in a period, the title included", () => {
    expect(check("## Before you start.\n")).toEqual(['getting-started/fixture: heading "Before you start." ends in a period']);
    expect(check("Text.\n", FRONT("Install the app."))).toEqual(['getting-started/fixture: title "Install the app." ends in a period']);
    expect(check("```\n# a comment in code.\n```\n## Before you start\n")).toEqual([]);
  });

  it('fails the word "machine" in any case, as a whole word', () => {
    expect(check("Each agent is a Machine with settings.\n")).toEqual(['getting-started/fixture: says "Machine"']);
    expect(check("Two MACHINES.\n")).toEqual(['getting-started/fixture: says "MACHINES"']);
    expect(check("Machinery is fine.\n")).toEqual([]);
  });

  it("fails a page missing its title, part or order", () => {
    expect(pageProblems({ id: "getting-started/fixture", text: "---\ndescription: What it is for.\n---\nText.\n" }, ctx)).toEqual([
      "getting-started/fixture: has no title",
      "getting-started/fixture: has no part (one of getting-started, ideas, how-to, help, jev)",
      "getting-started/fixture: has no order (a whole number)",
    ]);
    expect(pageProblems({ id: "getting-started/fixture", text: "Text.\n" }, ctx)).toEqual(["getting-started/fixture: has no frontmatter"]);
    const [unread] = pageProblems({ id: "getting-started/fixture", text: FRONT("A page", "summary: two parts: a name and a task\n") + "Text.\n" }, ctx);
    expect(unread).toMatch(/^getting-started\/fixture: has frontmatter YAML can't read/);
    expect(check("Text.\n", "---\ntitle: A page\npart: ideas\norder: 1.5\n---\n")).toEqual([
      "getting-started/fixture: is filed under getting-started/ but its part is ideas",
      "getting-started/fixture: has no order (a whole number)",
      "getting-started/fixture: has no description",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The guide as it is

describe("the guide's pages", () => {
  const pages = guidePages();
  const ctx = realContext(pages);

  it("finds the guide's pages and the app's labels", () => {
    expect(pages.length).toBeGreaterThan(0);
    expect(ctx.labels.has("Make the agent")).toBe(true);
  });

  it("cite only labels the app shows, link only what exists, and keep the guide's tone", () => {
    expect(pages.flatMap((p) => pageProblems(p, ctx)).map(shown)).toEqual([]);
  });

  it("show every manifest shot, and every picture has a manifest entry", () => {
    expect(shotProblems(SHOTS, pages, pictures())).toEqual([]);
  });
});
