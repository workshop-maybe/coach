// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FolderGate } from "./FolderGate";

afterEach(cleanup);

describe("FolderGate", () => {
  it("with no data folder, shows only the choose-folder screen", async () => {
    const children = vi.fn((folder: string) => <p>shell for {folder}</p>);
    render(
      <FolderGate getFolder={async () => null} pickFolder={async () => null}>
        {children}
      </FolderGate>,
    );
    expect(await screen.findByRole("button", { name: "Choose folder" })).toBeTruthy();
    expect(screen.getByText(/Pick a folder for your credentials, agents and results/)).toBeTruthy();
    expect(screen.queryByText(/shell for/)).toBeNull();
    expect(children).not.toHaveBeenCalled();
  });

  it("choosing a folder renders the children with it", async () => {
    const pickFolder = vi.fn(async () => "/home/me/andamio");
    render(
      <FolderGate getFolder={async () => null} pickFolder={pickFolder}>
        {(folder) => <p>shell for {folder}</p>}
      </FolderGate>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Choose folder" }));
    expect(await screen.findByText("shell for /home/me/andamio")).toBeTruthy();
    expect(pickFolder).toHaveBeenCalledTimes(1);
  });

  it("a cancelled picker stays on the choose-folder screen", async () => {
    render(
      <FolderGate getFolder={async () => null} pickFolder={async () => null}>
        {(folder) => <p>shell for {folder}</p>}
      </FolderGate>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Choose folder" }));
    expect(screen.getByRole("button", { name: "Choose folder" })).toBeTruthy();
    expect(screen.queryByText(/shell for/)).toBeNull();
  });

  it("with a remembered folder, renders the children and no choose screen", async () => {
    render(
      <FolderGate getFolder={async () => "/data"} pickFolder={async () => null}>
        {(folder) => <p>shell for {folder}</p>}
      </FolderGate>,
    );
    expect(await screen.findByText("shell for /data")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Choose folder" })).toBeNull();
  });

  it("changeFolder swaps to the newly picked folder and keeps the old one on cancel", async () => {
    const picks = ["/second", null];
    render(
      <FolderGate getFolder={async () => "/first"} pickFolder={async () => picks.shift() ?? null}>
        {(folder, changeFolder) => (
          <div>
            <p>shell for {folder}</p>
            <button onClick={() => void changeFolder()}>Change</button>
          </div>
        )}
      </FolderGate>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Change" }));
    expect(await screen.findByText("shell for /second")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(await screen.findByText("shell for /second")).toBeTruthy();
  });
});
