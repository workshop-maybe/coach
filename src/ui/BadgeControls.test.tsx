// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BadgeControls, type BadgeControlsProps } from "./BadgeControls";
import { AppShell, type Route } from "./AppShell";
import { FolderProvider } from "./useFolderState";
import { MemoryStorage } from "../storage/memory";
import { MARKER_PATH, collectionPath, credentialPath, loadFolder, serializeCollection, serializeMarker } from "../domain/folder";
import { serializeCredentialMd } from "../domain/credential-md";
import type { BadgeSettings } from "../badge/settings";
import type { Collection, Credential } from "../domain/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

// ---------------------------------------------------------------------------
// The controls on their own

const HUES = { ring: "#EE6C3A", innerRing: "#5BB8D4" };

function Harness(props: Partial<BadgeControlsProps> & { initial?: BadgeSettings; seen: BadgeSettings[] }) {
  const { initial = {}, seen, ...rest } = props;
  const [value, setValue] = useState<BadgeSettings>(initial);
  return (
    <BadgeControls
      mode="collection"
      collectionSettings={{}}
      ringHues={HUES}
      titleDefaults={{ main: "Code review", eyebrow: "Engineering" }}
      onPickArt={() => {}}
      {...rest}
      value={value}
      onChange={(next) => {
        seen.push(next);
        setValue(next);
      }}
    />
  );
}

const last = (seen: BadgeSettings[]) => seen[seen.length - 1];

describe("BadgeControls", () => {
  it("offers the ten palettes plus the collection default", async () => {
    const seen: BadgeSettings[] = [];
    render(<Harness seen={seen} />);
    const select = screen.getByLabelText("Palette") as HTMLSelectElement;
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toHaveLength(11);
    expect(options[0]).toBe("Default for this collection");
    expect(options).toContain("Wine Crimson");
    await userEvent.selectOptions(select, "Teal Ice");
    expect(last(seen)).toEqual({ palette: "07-teal-ice" });
    await userEvent.selectOptions(select, "Default for this collection");
    expect(last(seen)).toEqual({});
  });

  it("a hex field accepts only six-digit values and otherwise keeps the last valid one", async () => {
    const seen: BadgeSettings[] = [];
    render(<Harness seen={seen} />);
    const hex = screen.getByLabelText("Outer ring hex") as HTMLInputElement;
    expect(hex.value).toBe("#EE6C3A");
    const user = userEvent.setup();
    await user.clear(hex);
    await user.type(hex, "#12");
    expect(seen).toEqual([]);
    fireEvent.blur(hex);
    expect(hex.value).toBe("#EE6C3A");
    await user.clear(hex);
    await user.type(hex, "#112233");
    // Editing one color copies the other from the value in effect.
    expect(last(seen)).toEqual({ colors: { ring: "#112233", innerRing: "#5BB8D4" } });
  });

  it("the color swatch sets a ring color, a preset keeps custom colors, and Reset colors removes them", async () => {
    const seen: BadgeSettings[] = [];
    render(<Harness seen={seen} />);
    fireEvent.change(screen.getByLabelText("Inner ring color"), { target: { value: "#00ff00" } });
    expect(last(seen)).toEqual({ colors: { ring: "#EE6C3A", innerRing: "#00FF00" } });
    await userEvent.selectOptions(screen.getByLabelText("Palette"), "Pine Gold");
    expect(last(seen)).toEqual({ palette: "04-pine-gold", colors: { ring: "#EE6C3A", innerRing: "#00FF00" } });
    await userEvent.click(screen.getByRole("button", { name: "Reset colors" }));
    expect(last(seen)).toEqual({ palette: "04-pine-gold" });
    expect(screen.queryByRole("button", { name: "Reset colors" })).toBeNull();
  });

  it("title fields show defaults as placeholders and store an empty field as absent", async () => {
    const seen: BadgeSettings[] = [];
    render(<Harness seen={seen} />);
    const main = screen.getByLabelText("Title") as HTMLInputElement;
    expect(main.placeholder).toBe("Code review");
    expect((screen.getByLabelText("Text above the title") as HTMLInputElement).placeholder).toBe("Engineering");
    const user = userEvent.setup();
    await user.type(main, "X");
    expect(last(seen)).toEqual({ title: { main: "X" } });
    await user.clear(main);
    expect(last(seen)).toEqual({});
  });

  it("collection mode has no inherit states and can pick or remove art", async () => {
    const seen: BadgeSettings[] = [];
    const onPickArt = vi.fn();
    render(<Harness seen={seen} onPickArt={onPickArt} initial={{ art: "collections/eng/badge/art-1.png" }} />);
    expect(screen.queryByText("Using collection setting")).toBeNull();
    expect(screen.queryByRole("button", { name: "Use collection setting" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Choose image…" }));
    expect(onPickArt).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Remove art" }));
    expect(last(seen)).toEqual({});
  });

  it("shows the art-missing note when told", () => {
    render(<Harness seen={[]} artMissing />);
    expect(screen.getByText("Art file missing")).toBeTruthy();
  });

  describe("credential mode", () => {
    const collectionSettings: BadgeSettings = {
      palette: "04-pine-gold",
      colors: { ring: "#111111", innerRing: "#222222" },
      art: "collections/eng/badge/art-1.png",
      title: { eyebrow: "Team" },
    };

    it("inherited controls say so, and the first edit copies the inherited values", async () => {
      const seen: BadgeSettings[] = [];
      render(<Harness seen={seen} mode="credential" collectionSettings={collectionSettings} ringHues={{ ring: "#111111", innerRing: "#222222" }} />);
      expect(screen.getAllByText("Using collection setting")).toHaveLength(3);
      expect((screen.getByLabelText("Palette") as HTMLSelectElement).value).toBe("04-pine-gold");
      expect((screen.getByLabelText("Text above the title") as HTMLInputElement).value).toBe("Team");

      fireEvent.change(screen.getByLabelText("Outer ring color"), { target: { value: "#abcdef" } });
      expect(last(seen)).toEqual({ palette: "04-pine-gold", colors: { ring: "#ABCDEF", innerRing: "#222222" } });
      const colors = screen.getByRole("group", { name: "Colors" });
      expect(within(colors).queryByText("Using collection setting")).toBeNull();

      await userEvent.type(screen.getByLabelText("Title"), "Y");
      expect(last(seen).title).toEqual({ main: "Y", eyebrow: "Team" });
    });

    it("Use collection setting clears one control's override", async () => {
      const seen: BadgeSettings[] = [];
      render(
        <Harness
          seen={seen}
          mode="credential"
          collectionSettings={collectionSettings}
          initial={{ palette: "07-teal-ice", title: { main: "Mine" } }}
        />,
      );
      const colors = screen.getByRole("group", { name: "Colors" });
      await userEvent.click(within(colors).getByRole("button", { name: "Use collection setting" }));
      expect(last(seen)).toEqual({ title: { main: "Mine" } });
      expect(within(colors).getByText("Using collection setting")).toBeTruthy();
    });

    it("art can be set to No art, then back to the collection's", async () => {
      const seen: BadgeSettings[] = [];
      render(<Harness seen={seen} mode="credential" collectionSettings={collectionSettings} />);
      const art = screen.getByRole("group", { name: "Art" });
      await userEvent.click(within(art).getByRole("button", { name: "No art" }));
      expect(last(seen)).toEqual({ art: null });
      expect(within(art).queryByRole("button", { name: "No art" })).toBeNull();
      await userEvent.click(within(art).getByRole("button", { name: "Use collection setting" }));
      expect(last(seen)).toEqual({});
    });
  });
});

// ---------------------------------------------------------------------------
// In the app

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

const baseCollection: Collection = {
  slug: "eng",
  name: "Engineering",
  description: "",
  order: ["review", "testing", "docs"],
  codes: { review: 1, testing: 2, docs: 3 },
};

function cred(slug: string, name: string): Credential {
  return { slug, collectionSlug: "eng", name, learningTargets: [], task: "", rubric: "", extraSections: [] };
}

function fixture(collection: Collection = baseCollection): MemoryStorage {
  return new MemoryStorage({
    [MARKER_PATH]: serializeMarker(),
    [collectionPath("eng")]: serializeCollection(collection),
    [credentialPath("eng", "review")]: serializeCredentialMd(cred("review", "Code review")),
    [credentialPath("eng", "testing")]: serializeCredentialMd(cred("testing", "Testing")),
    [credentialPath("eng", "docs")]: serializeCredentialMd(cred("docs", "Docs")),
  });
}

function renderApp(storage: MemoryStorage, initialRoute: Route) {
  return render(
    <FolderProvider storage={storage} folder="/data">
      <AppShell onChangeFolder={() => {}} initialRoute={initialRoute} />
    </FolderProvider>,
  );
}

const openReview: Route = { view: "collections", collectionSlug: "eng", credentialKey: "eng/review" };
const openCollection: Route = { view: "collections", collectionSlug: "eng" };
const PREFIX = "data:image/svg+xml;charset=utf-8,";

async function badgeSvg(name: string, container: HTMLElement = document.body): Promise<string> {
  const img = await waitFor(() => {
    const el = within(container).getByRole("img", { name: `Badge for ${name}` });
    expect(el.tagName).toBe("IMG");
    return el;
  });
  return decodeURIComponent(img.getAttribute("src")!.slice(PREFIX.length));
}

function savedCollection(storage: MemoryStorage) {
  return JSON.parse(storage.file(collectionPath("eng"))!);
}

describe("Badge section in the credential editor", () => {
  it("changing the palette updates the preview and writes nothing (Covers AE6.)", async () => {
    const storage = fixture();
    renderApp(storage, openReview);
    const before = await badgeSvg("Code review");
    await userEvent.selectOptions(screen.getByLabelText("Palette"), "Wine Crimson");
    await waitFor(async () => expect(await badgeSvg("Code review")).not.toBe(before));
    expect(await badgeSvg("Code review")).toContain("#F0524D");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(storage.writes).toEqual([]);
  });

  it("saving an override writes badgeOverrides for that credential only", async () => {
    const storage = fixture();
    renderApp(storage, openReview);
    await screen.findByLabelText("Palette");
    await userEvent.selectOptions(screen.getByLabelText("Palette"), "Teal Ice");
    await userEvent.click(screen.getByRole("button", { name: "Save badge" }));
    await waitFor(() => expect(storage.writes).toEqual([{ root: "data", path: collectionPath("eng") }]));
    const saved = savedCollection(storage);
    expect(saved.badgeOverrides).toEqual({ review: { palette: "07-teal-ice" } });
    expect(saved.badge).toBeUndefined();
    expect(saved.name).toBe("Engineering");
  });

  it("Use collection setting clears the override (Covers AE3.)", async () => {
    const storage = fixture({ ...baseCollection, badge: { palette: "04-pine-gold" }, badgeOverrides: { review: { palette: "07-teal-ice" } } });
    renderApp(storage, openReview);
    expect(await badgeSvg("Code review")).toContain("#5FD0E8");
    const colors = screen.getByRole("group", { name: "Colors" });
    await userEvent.click(within(colors).getByRole("button", { name: "Use collection setting" }));
    await userEvent.click(screen.getByRole("button", { name: "Save badge" }));
    await screen.findByText("Saved.");
    expect(savedCollection(storage).badgeOverrides?.review).toBeUndefined();
    await waitFor(async () => expect(await badgeSvg("Code review")).toContain("#E9B23C"));
  });

  it("picking art, then Revert, leaves the saved art unchanged and writes no setting", async () => {
    const storage = fixture();
    storage.queueArt(PNG);
    renderApp(storage, openReview);
    const art = await screen.findByRole("group", { name: "Art" });
    await userEvent.click(within(art).getByRole("button", { name: "Choose image…" }));
    await within(art).findByText(/review-[0-9a-f]{8}\.png/);
    await waitFor(async () => expect(await badgeSvg("Code review")).toContain(PNG));
    await userEvent.click(screen.getByRole("button", { name: "Revert badge" }));
    await waitFor(async () => expect(await badgeSvg("Code review")).not.toContain(PNG));
    expect(storage.writes.map((w) => w.path)).toEqual([expect.stringMatching(/^collections\/eng\/badge\/review-[0-9a-f]{8}\.png$/)]);
    expect(savedCollection(storage).badgeOverrides).toBeUndefined();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("a missing art file shows a note", async () => {
    const storage = fixture({ ...baseCollection, badge: { art: "collections/eng/badge/art-00000000.png" } });
    renderApp(storage, openReview);
    expect(await screen.findByText("Art file missing")).toBeTruthy();
  });

  it("Save badge as SVG writes the saved badge to the export root", async () => {
    vi.mocked(invoke).mockResolvedValue("/exports");
    const storage = fixture();
    renderApp(storage, openReview);
    const button = await screen.findByRole("button", { name: "Save badge as SVG" });
    await userEvent.selectOptions(screen.getByLabelText("Palette"), "Teal Ice");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Revert badge" }));
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(button);
    await waitFor(() => expect(storage.file("review.svg", "export")).toBeTruthy());
    expect(invoke).toHaveBeenCalledWith("pick_export_folder");
    expect(storage.file("review.svg", "export")!.startsWith("<svg")).toBe(true);
    expect(await screen.findByText(/review\.svg/)).toBeTruthy();
  });

  it("a badge save leaves the credential text draft alone", async () => {
    const storage = fixture();
    renderApp(storage, openReview);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Task"), "Draft task");
    await user.selectOptions(screen.getByLabelText("Palette"), "Teal Ice");
    await user.click(screen.getByRole("button", { name: "Save badge" }));
    await screen.findByText("Saved.");
    expect((screen.getByLabelText("Task") as HTMLTextAreaElement).value).toBe("Draft task");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(storage.file(credentialPath("eng", "review"))).not.toContain("Draft task");
  });
});

describe("Badges in the collection view", () => {
  it("shows one thumbnail per credential, with an accessible name", async () => {
    renderApp(fixture(), openCollection);
    const list = await screen.findByRole("list", { name: "Credentials" });
    await waitFor(() => {
      const imgs = within(list).getAllByRole("img");
      expect(imgs.map((i) => i.getAttribute("alt"))).toEqual(["Badge for Code review", "Badge for Testing", "Badge for Docs"]);
      for (const i of imgs) expect(i.getAttribute("width")).toBe("64");
    });
  });

  it("previews a sample badge when the collection is empty", async () => {
    const empty: Collection = { ...baseCollection, order: [], codes: {} };
    renderApp(new MemoryStorage({ [MARKER_PATH]: serializeMarker(), [collectionPath("eng")]: serializeCollection(empty) }), openCollection);
    const panel = await screen.findByRole("region", { name: "Badge" });
    expect(await badgeSvg("Sample credential", panel)).toContain("Sample credential");
  });

  it("switching the collection palette changes every badge but the overriding one (Covers AE2.)", async () => {
    const storage = fixture({ ...baseCollection, badge: { palette: "04-pine-gold" }, badgeOverrides: { review: { palette: "07-teal-ice" } } });
    renderApp(storage, openCollection);
    const panel = await screen.findByRole("region", { name: "Badge" });
    await userEvent.selectOptions(within(panel).getByLabelText("Palette"), "Wine Crimson");
    expect(within(panel).getByText(/Code review/)).toBeTruthy();
    await userEvent.click(within(panel).getByRole("button", { name: "Save badge settings" }));
    await within(panel).findByText("Saved.");
    const saved = savedCollection(storage);
    expect(saved.badge).toEqual({ palette: "05-wine-crimson" });
    expect(saved.badgeOverrides).toEqual({ review: { palette: "07-teal-ice" } });

    const list = screen.getByRole("list", { name: "Credentials" });
    await waitFor(async () => expect(await badgeSvg("Testing", list)).toContain("#F0524D"));
    expect(await badgeSvg("Docs", list)).toContain("#F0524D");
    const review = await badgeSvg("Code review", list);
    expect(review).toContain("#5FD0E8");
    expect(review).not.toContain("#F0524D");
  });

  it("with a dirty name edit, saving the badge settings leaves the name draft saveable without a conflict", async () => {
    const storage = fixture();
    renderApp(storage, openCollection);
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Collection name");
    await user.clear(name);
    await user.type(name, "Engineering team");
    const panel = screen.getByRole("region", { name: "Badge" });
    await user.selectOptions(within(panel).getByLabelText("Palette"), "Teal Ice");
    await user.click(within(panel).getByRole("button", { name: "Save badge settings" }));
    await within(panel).findByText("Saved.");
    expect((screen.getByLabelText("Collection name") as HTMLInputElement).value).toBe("Engineering team");

    await user.click(screen.getByRole("button", { name: "Save collection" }));
    await waitFor(() => expect(savedCollection(storage).name).toBe("Engineering team"));
    expect(savedCollection(storage).badge).toEqual({ palette: "07-teal-ice" });
    expect(screen.queryByText("Changed on disk: reload or keep editing")).toBeNull();
  });

  it("a name save leaves a dirty badge draft saveable without a conflict", async () => {
    const storage = fixture();
    renderApp(storage, openCollection);
    const user = userEvent.setup();
    const panel = await screen.findByRole("region", { name: "Badge" });
    await user.selectOptions(within(panel).getByLabelText("Palette"), "Teal Ice");
    const name = screen.getByLabelText("Collection name");
    await user.clear(name);
    await user.type(name, "Engineering team");
    await user.click(screen.getByRole("button", { name: "Save collection" }));
    await waitFor(() => expect(savedCollection(storage).name).toBe("Engineering team"));
    await act(async () => {
      await user.click(within(panel).getByRole("button", { name: "Save badge settings" }));
    });
    await waitFor(() => expect(savedCollection(storage).badge).toEqual({ palette: "07-teal-ice" }));
    expect(savedCollection(storage).name).toBe("Engineering team");
    expect(screen.queryByText("Changed on disk: reload or keep editing")).toBeNull();
  });

  it("a reorder keeps a dirty badge draft saveable", async () => {
    const storage = fixture();
    renderApp(storage, openCollection);
    const user = userEvent.setup();
    const panel = await screen.findByRole("region", { name: "Badge" });
    await user.selectOptions(within(panel).getByLabelText("Palette"), "Teal Ice");
    await user.click(screen.getByRole("button", { name: "Move Docs up" }));
    await screen.findByRole("button", { name: "Move Docs down" });
    await user.click(within(panel).getByRole("button", { name: "Save badge settings" }));
    await waitFor(() => expect(savedCollection(storage).badge).toEqual({ palette: "07-teal-ice" }));
    expect((await loadFolder(storage)).collections[0].order).toEqual(["review", "docs", "testing"]);
  });
});
