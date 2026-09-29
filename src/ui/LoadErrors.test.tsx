// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { LoadErrors } from "./LoadErrors";
import { AppShell } from "./AppShell";
import { FolderProvider } from "./useFolderState";
import { MemoryStorage } from "../storage/memory";
import { MARKER_PATH, profilePath, serializeProfile } from "../domain/folder";

afterEach(cleanup);

describe("LoadErrors", () => {
  it("renders nothing when there are no errors", () => {
    const { container } = render(<LoadErrors errors={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("names each unreadable file with its message", () => {
    render(
      <LoadErrors
        errors={[
          { path: "agents/broken.json", message: "Unexpected end of JSON input" },
          { path: "collections/eng/credentials/x.md", message: "Missing name" },
        ]}
      />,
    );
    const banner = screen.getByRole("alert");
    expect(within(banner).getByText("agents/broken.json")).toBeTruthy();
    expect(within(banner).getByText(/Unexpected end of JSON input/)).toBeTruthy();
    expect(within(banner).getByText("collections/eng/credentials/x.md")).toBeTruthy();
    expect(within(banner).getByText(/Missing name/)).toBeTruthy();
  });

  it("with load errors, the shell shows the banner and still renders the rest of the app", async () => {
    const broken = '{ "name": "Broken", ';
    const storage = new MemoryStorage({
      [MARKER_PATH]: '{ "format": 1 }\n',
      [profilePath("ok")]: serializeProfile({
        slug: "ok",
        name: "OK agent",
        harness: "",
        model: "",
        effort: "",
        repo: "",
        notes: "",
        params: {},
      }),
      [profilePath("broken")]: broken,
    });
    render(
      <FolderProvider storage={storage} folder="/data">
        <AppShell onChangeFolder={() => {}} />
      </FolderProvider>,
    );
    const banner = await screen.findByRole("alert");
    expect(within(banner).getByText("agents/broken.json")).toBeTruthy();
    expect(screen.getByRole("navigation")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collections" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Agents" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Matrix" })).toBeTruthy();
    expect(screen.getByText("/data")).toBeTruthy();
    expect(storage.file(profilePath("broken"))).toBe(broken);
  });
});
