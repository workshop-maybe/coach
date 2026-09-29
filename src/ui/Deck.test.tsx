// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Deck, type Beat } from "./Deck";
import { ChangedOnDiskError } from "../storage/storage";

afterEach(cleanup);

interface Harness {
  onClose?: () => void;
  onFinish?: (opts: { keepMine: boolean }) => Promise<void>;
  onUseTheirs?: () => void;
}

/** A two-beat deck: a name, then a task. The parent owns the answers, as every flow does. */
function TwoBeats({ onClose = () => {}, onFinish = async () => {}, onUseTheirs }: Harness) {
  const [name, setName] = useState("");
  const [task, setTask] = useState("");
  const beats: Beat[] = [
    {
      id: "name",
      title: "Name it",
      forward: "Next",
      valid: name.trim() !== "",
      settled: name,
      body: <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />,
    },
    {
      id: "task",
      title: "The task",
      forward: "Make the badge",
      valid: task.trim() !== "",
      settled: task,
      body: <textarea aria-label="Task" value={task} onChange={(e) => setTask(e.target.value)} />,
    },
  ];
  return <Deck label="Create a credential" beats={beats} onClose={onClose} onFinish={onFinish} onUseTheirs={onUseTheirs} />;
}

describe("Deck", () => {
  it("shows only the current beat", () => {
    render(<TwoBeats />);
    expect(screen.getByRole("heading", { name: "Name it" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "The task" })).toBeNull();
    expect(screen.queryByLabelText("Task")).toBeNull();
  });

  it("keeps the forward action disabled until the beat's answer is valid", async () => {
    render(<TwoBeats />);
    const next = screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Name"), "Code review");
    expect(next.disabled).toBe(false);
  });

  it("settles an answer above the next card, and moves focus to the new card", async () => {
    render(<TwoBeats />);
    await userEvent.type(screen.getByLabelText("Name"), "Code review");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    const heading = screen.getByRole("heading", { name: "The task" });
    expect(document.activeElement).toBe(heading);
    const settled = screen.getByRole("list", { name: "Answered" });
    expect(within(settled).getByText("Code review")).toBeTruthy();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("Back returns to the previous beat with its answer intact", async () => {
    render(<TwoBeats />);
    await userEvent.type(screen.getByLabelText("Name"), "Code review");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Code review");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Name it" }));
  });

  it("Enter in a one-line answer moves forward when the answer is valid", async () => {
    render(<TwoBeats />);
    await userEvent.type(screen.getByLabelText("Name"), "Code review{Enter}");
    expect(screen.getByRole("heading", { name: "The task" })).toBeTruthy();
  });

  it("Back on the first beat, the corner control and Escape all close without finishing", async () => {
    const onClose = vi.fn();
    const onFinish = vi.fn(async () => {});
    render(<TwoBeats onClose={onClose} onFinish={onFinish} />);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("runs nothing until the final forward action", async () => {
    const onFinish = vi.fn(async () => {});
    render(<TwoBeats onFinish={onFinish} />);
    await userEvent.type(screen.getByLabelText("Name"), "Code review");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onFinish).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Task"), "Review the diff");
    await userEvent.click(screen.getByRole("button", { name: "Make the badge" }));
    expect(onFinish).toHaveBeenCalledWith({ keepMine: false });
  });

  it("a failed save keeps the card, says what went wrong in one line, and retries", async () => {
    const onFinish = vi.fn().mockRejectedValueOnce(new Error("Disk full")).mockResolvedValueOnce(undefined);
    render(<TwoBeats onFinish={onFinish} />);
    await userEvent.type(screen.getByLabelText("Name"), "Code review{Enter}");
    await userEvent.type(screen.getByLabelText("Task"), "Review the diff");
    await userEvent.click(screen.getByRole("button", { name: "Make the badge" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Disk full");
    expect((screen.getByLabelText("Task") as HTMLTextAreaElement).value).toBe("Review the diff");
    await userEvent.click(screen.getByRole("button", { name: "Make the badge" }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("a conflict replaces the card with Use theirs or Keep mine", async () => {
    const onFinish = vi.fn().mockRejectedValueOnce(new ChangedOnDiskError("x.md")).mockResolvedValueOnce(undefined);
    const onUseTheirs = vi.fn();
    render(<TwoBeats onFinish={onFinish} onUseTheirs={onUseTheirs} />);
    await userEvent.type(screen.getByLabelText("Name"), "Code review{Enter}");
    await userEvent.type(screen.getByLabelText("Task"), "Review the diff");
    await userEvent.click(screen.getByRole("button", { name: "Make the badge" }));

    expect(await screen.findByRole("heading", { name: "Changed on disk" })).toBeTruthy();
    expect(screen.queryByLabelText("Task")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    expect(onFinish).toHaveBeenLastCalledWith({ keepMine: true });
    expect(onUseTheirs).not.toHaveBeenCalled();
  });

  it("Use theirs hands the choice back to the flow", async () => {
    const onFinish = vi.fn().mockRejectedValueOnce(new ChangedOnDiskError("x.md"));
    const onUseTheirs = vi.fn();
    render(<TwoBeats onFinish={onFinish} onUseTheirs={onUseTheirs} />);
    await userEvent.type(screen.getByLabelText("Name"), "Code review{Enter}");
    await userEvent.type(screen.getByLabelText("Task"), "Review the diff");
    await userEvent.click(screen.getByRole("button", { name: "Make the badge" }));
    await userEvent.click(await screen.findByRole("button", { name: "Use theirs" }));
    expect(onUseTheirs).toHaveBeenCalledTimes(1);
  });

  it("a beat can advance itself, for a card whose answer is one tap", async () => {
    function Pick() {
      const beats: Beat[] = [
        { id: "who", title: "Who takes it", body: ({ advance }) => <button type="button" onClick={advance}>Opus</button> },
        { id: "copy", title: "Hand it over", forward: "Copy", body: <p>Prompt</p> },
      ];
      return <Deck label="Test" beats={beats} onClose={() => {}} onFinish={async () => {}} />;
    }
    render(<Pick />);
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Opus" }));
    expect(screen.getByRole("heading", { name: "Hand it over" })).toBeTruthy();
  });

  it("can open on a later beat", () => {
    function Resume() {
      const beats: Beat[] = [
        { id: "a", title: "First", forward: "Next", body: null, settled: "Opus" },
        { id: "b", title: "What came back", forward: "Next", body: null },
      ];
      return <Deck label="Test" beats={beats} startAt={1} onClose={() => {}} onFinish={async () => {}} />;
    }
    render(<Resume />);
    expect(screen.getByRole("heading", { name: "What came back" })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Answered" })).getByText("Opus")).toBeTruthy();
  });
});
