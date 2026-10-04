// @vitest-environment jsdom
// The screenshot manifest and the harness page that renders it (U3, U6, KTD6, KTD7, R19):
// every shot is well formed and names things the sample folder holds, every route kind
// is pictured or marked as not pictured, and the harness reports ready only for a shot
// it found and finished, never for an unknown id or a step that failed.
import { afterEach, describe, expect, it } from "vitest";
import { loadFolder } from "../domain/folder";
import { credentialKey, type FolderState } from "../domain/types";
import type { Route } from "../ui/routes";
import { PART_IDS } from "../../site/src/parts";
import { startShot } from "./harness";
import { sampleFolder, sampleStorage } from "./seed";
import { COVERAGE, NOT_PICTURED, SAMPLE_IMAGES, SHOTS, routeKind, type Shot } from "./shots";

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const DECK_KINDS = ["credential", "agent", "test", "edit-credential", "edit-agent", "handoffs", "edit-handoff", "trash", "jev"];
const ITEM_KINDS = ["badge", "agent", "handoff", "reply", "compare"];
const CREDENTIAL_PARTS = ["name", "targets", "task", "rubric", "look"];
const AGENT_PARTS = ["name", "repo", "notes", "params"];

/** Why a route is not a Route the shell can open over this folder, or [] when it is. */
function routeProblems(route: Route | "gate", state: FolderState): string[] {
  if (route === "gate") return [];
  const r = route as unknown as Record<string, unknown>;
  const out: string[] = [];
  const keys = new Set(state.credentials.map(credentialKey));
  const agents = new Set(state.profiles.map((p) => p.slug));
  const needKey = () => (typeof r.credentialKey === "string" && keys.has(r.credentialKey) ? null : out.push(`no badge ${String(r.credentialKey)}`));
  const needAgent = (slug = r.profileSlug) => (typeof slug === "string" && agents.has(slug) ? null : out.push(`no agent ${String(slug)}`));
  const optKey = () => r.credentialKey !== undefined && needKey();
  const optAgent = () => r.profileSlug !== undefined && needAgent();
  const needTake = (take: unknown) => {
    const t = take as { profileSlug?: unknown; fileStem?: unknown } | undefined;
    const found = state.assessments.some((a) => a.profileSlug === t?.profileSlug && a.fileStem === t?.fileStem && credentialKey(a) === r.credentialKey);
    if (!found) out.push(`no take ${JSON.stringify(take)} on ${String(r.credentialKey)}`);
  };

  if (r.view === "home") return out;
  if (r.view === "deck") {
    if (!DECK_KINDS.includes(r.deck as string)) return [`unknown deck ${String(r.deck)}`];
    switch (r.deck) {
      case "test":
        optKey();
        optAgent();
        break;
      case "edit-credential":
        needKey();
        if (!CREDENTIAL_PARTS.includes(r.part as string)) out.push(`unknown part ${String(r.part)}`);
        break;
      case "edit-agent":
        needAgent();
        if (!AGENT_PARTS.includes(r.part as string)) out.push(`unknown part ${String(r.part)}`);
        break;
      case "handoffs":
        needKey();
        break;
      case "edit-handoff":
        needKey();
        if (typeof r.handoff !== "string" || r.handoff === "") out.push("no handoff target");
        break;
      case "trash": {
        const item = r.item as { kind?: unknown; profileSlug?: unknown; credentialKey?: unknown } | undefined;
        if (item?.kind === "agent") needAgent(item.profileSlug);
        else if (item?.kind === "badge") {
          if (typeof item.credentialKey !== "string" || !keys.has(item.credentialKey)) out.push(`no badge ${String(item.credentialKey)}`);
        } else out.push("trash names no agent or badge");
        break;
      }
    }
    return out;
  }
  if (r.view === "item") {
    if (!ITEM_KINDS.includes(r.item as string)) return [`unknown item ${String(r.item)}`];
    switch (r.item) {
      case "badge":
        needKey();
        break;
      case "agent":
        needAgent();
        break;
      case "handoff":
        needKey();
        if (!state.handoffs.some((h) => credentialKey(h) === r.credentialKey && h.id === r.handoffId)) out.push(`no handoff ${String(r.handoffId)}`);
        break;
      case "reply":
        needKey();
        needTake(r.take);
        break;
      case "compare":
        needKey();
        if (!Array.isArray(r.takes) || r.takes.length !== 2) out.push("a compare needs two takes");
        else r.takes.forEach(needTake);
        break;
    }
    return out;
  }
  return [`unknown view ${String(r.view)}`];
}

const folders: Record<Shot["seed"], Promise<FolderState>> = {
  empty: sampleFolder("empty").then((s) => loadFolder(sampleStorage(s))),
  full: sampleFolder("full").then((s) => loadFolder(sampleStorage(s))),
};

describe("the shot manifest", () => {
  it("has unique kebab-case ids", () => {
    const ids = SHOTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(KEBAB);
  });

  it("names a guide page in one of the four parts for every shot", () => {
    for (const shot of SHOTS) {
      const [part, ...rest] = shot.page.split("/");
      expect(PART_IDS as readonly string[], shot.id).toContain(part);
      expect(rest.join("/"), shot.id).toMatch(/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/);
    }
  });

  it("gives every shot a route the shell can open over its sample folder", async () => {
    for (const shot of SHOTS) {
      expect(routeProblems(shot.route, await folders[shot.seed]), shot.id).toEqual([]);
    }
  });

  it("gives every shot an expect, a seed and a Jev state", () => {
    for (const shot of SHOTS) {
      const want = "text" in shot.expect ? shot.expect.text : shot.expect.selector;
      expect(typeof want === "string" && want.trim() !== "", shot.id).toBe(true);
      expect(["empty", "full"], shot.id).toContain(shot.seed);
      expect(["off", "on"], shot.id).toContain(shot.jev);
    }
  });

  it("gives every clip a selector and every step a target", () => {
    for (const shot of SHOTS) {
      if (shot.clip) expect(shot.clip.selector.trim(), shot.id).not.toBe("");
      for (const step of shot.steps ?? []) {
        const target =
          "click" in step
            ? step.click
            : "fill" in step
              ? step.fill
              : "waitFor" in step
                ? step.waitFor
                : "scroll" in step
                  ? step.scroll
                  : "focusEnd" in step
                    ? step.focusEnd
                    : (step.into ?? { selector: ".rich-input" });
        if ("pasteImage" in step) expect(SAMPLE_IMAGES, `${shot.id}: ${step.pasteImage}`).toContain(step.pasteImage);
        expect(Object.values(target).every((v) => typeof v === "string" && v !== ""), `${shot.id}: ${JSON.stringify(step)}`).toBe(true);
      }
    }
  });
});

describe("the coverage map", () => {
  it("has an entry for the gate, home and every deck and item kind", () => {
    const kinds = ["gate", "home", ...DECK_KINDS.map((k) => `deck:${k}`), ...ITEM_KINDS.map((k) => `item:${k}`)];
    expect(Object.keys(COVERAGE).sort()).toEqual(kinds.sort());
  });

  it("pictures every route kind or marks it as not pictured", () => {
    for (const [kind, shots] of Object.entries(COVERAGE)) {
      if (shots === NOT_PICTURED) continue;
      expect(shots.length, kind).toBeGreaterThan(0);
    }
  });

  it("lists only manifest shots, each under its own route kind", () => {
    for (const [kind, shots] of Object.entries(COVERAGE)) {
      if (shots === NOT_PICTURED) continue;
      for (const id of shots) {
        const shot = SHOTS.find((s) => s.id === id);
        expect(shot, `${kind}: ${id}`).toBeDefined();
        expect(routeKind(shot!.route), id).toBe(kind);
      }
    }
  });

  it("lists every manifest shot", () => {
    for (const shot of SHOTS) {
      const listed = COVERAGE[routeKind(shot.route)];
      expect(listed === NOT_PICTURED ? [] : listed, shot.id).toContain(shot.id);
    }
  });

  it("names a route kind as the shell does", () => {
    expect(routeKind("gate")).toBe("gate");
    expect(routeKind({ view: "home" })).toBe("home");
    expect(routeKind({ view: "deck", deck: "jev" })).toBe("deck:jev");
    expect(routeKind({ view: "item", item: "badge", credentialKey: "c/x" })).toBe("item:badge");
  });
});

describe("the harness page", () => {
  const html = document.documentElement;

  afterEach(() => {
    html.removeAttribute("data-shot");
    html.removeAttribute("data-shot-error");
    html.removeAttribute("data-window");
    document.body.innerHTML = "";
  });

  function mountPoint(): HTMLElement {
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);
    return root;
  }

  it("renders an error for an id missing from the manifest and never reports ready", async () => {
    const root = mountPoint();
    const stop = await startShot(root, "?shot=no-such-shot");
    expect(root.textContent).toContain('No shot named "no-such-shot"');
    expect(html.getAttribute("data-shot-error")).toContain("no-such-shot");
    await new Promise((r) => setTimeout(r, 400));
    expect(html.hasAttribute("data-shot")).toBe(false);
    stop();
  });

  it("renders an error when no shot is asked for", async () => {
    const root = mountPoint();
    const stop = await startShot(root, "");
    expect(html.getAttribute("data-shot-error")).toMatch(/\?shot=/);
    expect(html.hasAttribute("data-shot")).toBe(false);
    stop();
  });

  it("runs a shot's steps over the real app and reports ready once settled, with square corners", async () => {
    const shot: Shot = {
      id: "jev-new-key",
      page: "help/jev-mode",
      route: { view: "deck", deck: "jev" },
      seed: "full",
      jev: "on",
      expect: { text: "A new key" },
      steps: [{ click: { button: "Use a new key" } }, { waitFor: { text: "A new key" } }],
    };
    const root = mountPoint();
    const stop = await startShot(root, "?shot=jev-new-key", [shot]);
    expect(html.getAttribute("data-shot-error")).toBeNull();
    expect(html.getAttribute("data-shot")).toBe("ready");
    expect(html.getAttribute("data-window")).toBe("maximized");
    expect(root.textContent).toContain("A new key");
    stop();
  }, 15000);

  it("scrolls a step's target to the middle of the window before reporting ready", async () => {
    // jsdom has no scrolling, so the step's call is what can be seen.
    const calls: { el: Element; options: unknown }[] = [];
    const had = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    Element.prototype.scrollIntoView = function (this: Element, options?: unknown) {
      calls.push({ el: this, options });
    } as Element["scrollIntoView"];
    try {
      const shot: Shot = {
        id: "home-badges",
        page: "ideas/your-record",
        route: { view: "home" },
        seed: "full",
        jev: "off",
        expect: { text: "Badges" },
        steps: [{ scroll: { selector: 'section[aria-labelledby="home-badges"]' } }],
      };
      const root = mountPoint();
      const stop = await startShot(root, "?shot=home-badges", [shot]);
      expect(html.getAttribute("data-shot-error")).toBeNull();
      expect(html.getAttribute("data-shot")).toBe("ready");
      expect(calls).toHaveLength(1);
      expect(calls[0].el.getAttribute("aria-labelledby")).toBe("home-badges");
      expect(calls[0].options).toEqual({ block: "center", inline: "nearest" });
      stop();
    } finally {
      if (had) Object.defineProperty(Element.prototype, "scrollIntoView", had);
      else delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  }, 15000);

  it("fails a shot whose step finds nothing, naming the step, and never reports ready", async () => {
    const shot: Shot = {
      id: "broken-step",
      page: "help/jev-mode",
      route: { view: "deck", deck: "jev" },
      seed: "empty",
      jev: "off",
      expect: { text: "Your TypeSafe key" },
      steps: [{ click: { button: "No such button" } }],
    };
    const root = mountPoint();
    const stop = await startShot(root, "?shot=broken-step", [shot], { stepTimeout: 300 });
    expect(html.getAttribute("data-shot-error")).toContain('No such button');
    expect(html.hasAttribute("data-shot")).toBe(false);
    stop();
  }, 15000);
});
