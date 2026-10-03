// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState, type ReactNode } from "react";
import { Deck, type Beat } from "./Deck";
import { PaneContext, usePaneClaims } from "./pane";
import { RichText } from "./RichText";
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

// Pane beats and the Escape rules (U8, R7, R19, R20, R21, KTD3, KTD8).

interface PaneHarness extends Harness {
  /** The ids of the beats that are panes. */
  panes?: string[];
  /** The ids of the beats whose first field takes focus. */
  focusBody?: string[];
  unsaved?: boolean;
  startAt?: number;
}

/**
 * A test-shaped deck: pick an agent, paste its reply, judge it. The judge card's notes are
 * an editor (contenteditable, as ProseMirror renders) and its answer is one tap, so it has
 * no forward action.
 */
function TestBeats({ panes = [], focusBody = [], unsaved, startAt, onClose = () => {}, onFinish = async () => {} }: PaneHarness) {
  const [who, setWho] = useState("Opus");
  const [reply, setReply] = useState("");
  const base: Beat[] = [
    {
      id: "who",
      title: "Who takes it",
      forward: "Next",
      settled: who,
      body: <input aria-label="Agent" value={who} onChange={(e) => setWho(e.target.value)} />,
    },
    {
      id: "paste",
      title: "Paste the reply",
      forward: "Judge it",
      valid: reply.trim() !== "",
      settled: "Reply pasted",
      body: (
        <>
          <button type="button" onClick={() => setReply("")}>
            Clear
          </button>
          <input type="checkbox" aria-label="Keep as written" />
          <textarea aria-label="Reply" value={reply} onChange={(e) => setReply(e.target.value)} />
        </>
      ),
    },
    {
      id: "judge",
      title: "Judge it",
      body: ({ advance }) => (
        <>
          <div role="textbox" aria-label="Notes" contentEditable suppressContentEditableWarning />
          <button type="button" onClick={advance}>
            Passed
          </button>
        </>
      ),
    },
  ];
  const beats = base.map((b) => ({ ...b, pane: panes.includes(b.id), focusBody: focusBody.includes(b.id) }));
  return <Deck label="Test an agent" beats={beats} startAt={startAt} unsaved={unsaved} onClose={onClose} onFinish={onFinish} />;
}

/** The shell's half of pane mode, reduced to a word, so a test can see the deck's claim. */
function InShell({ children }: { children?: ReactNode }) {
  const { pane, claims } = usePaneClaims();
  return (
    <PaneContext.Provider value={claims}>
      <output>{pane ? "pane" : "page"}</output>
      {children}
    </PaneContext.Provider>
  );
}

const mode = () => screen.getByRole("status").textContent;
const deck = () => screen.getByRole("region", { name: "Test an agent" });
const heading = (name: string) => screen.getByRole("heading", { name });

describe("Deck pane beats", () => {
  it("a pane beat claims pane mode and renders as a pane; a non-pane beat does not", async () => {
    render(
      <InShell>
        <TestBeats panes={["paste", "judge"]} />
      </InShell>,
    );
    expect(mode()).toBe("page");
    expect(deck().classList.contains("pane")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(heading("Paste the reply")).toBeTruthy();
    expect(mode()).toBe("pane");
    expect(deck().classList.contains("pane")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(mode()).toBe("page");
    expect(deck().classList.contains("pane")).toBe(false);
  });

  it("claims from the first render when the deck opens on a pane beat", () => {
    render(
      <InShell>
        <TestBeats panes={["paste"]} startAt={1} />
      </InShell>,
    );
    expect(mode()).toBe("pane");
  });

  it("the conflict card does not claim pane mode", async () => {
    const onFinish = vi.fn().mockRejectedValueOnce(new ChangedOnDiskError("x.md"));
    render(
      <InShell>
        <TestBeats panes={["judge"]} startAt={2} onFinish={onFinish} />
      </InShell>,
    );
    expect(mode()).toBe("pane");
    await userEvent.click(screen.getByRole("button", { name: "Passed" }));
    expect(await screen.findByRole("heading", { name: "Changed on disk" })).toBeTruthy();
    expect(mode()).toBe("page");
    expect(deck().classList.contains("pane")).toBe(false);
  });

  it("releases pane mode when the deck unmounts", () => {
    const { rerender } = render(
      <InShell>
        <TestBeats panes={["paste"]} startAt={1} />
      </InShell>,
    );
    expect(mode()).toBe("pane");
    rerender(<InShell />);
    expect(mode()).toBe("page");
  });

  it("keeps the settled answers above a pane beat", () => {
    render(<TestBeats panes={["paste"]} startAt={1} />);
    expect(within(screen.getByRole("list", { name: "Answered" })).getByText("Opus")).toBeTruthy();
  });

  it("a deck that marks no pane beats renders and claims as before", async () => {
    render(
      <InShell>
        <TestBeats />
      </InShell>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(mode()).toBe("page");
    expect(deck().className).toBe("deck");
  });
});

describe("Deck focus on arrival", () => {
  it("a beat that asks for body focus puts focus on its first field, not the heading", async () => {
    render(<TestBeats focusBody={["paste"]} />);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(heading("Paste the reply")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Reply"));
  });

  it("a deck opening on a body-focus beat focuses its field", () => {
    render(<TestBeats focusBody={["paste"]} startAt={1} />);
    expect(document.activeElement).toBe(screen.getByLabelText("Reply"));
  });

  it("a body-focus beat whose field is an editor focuses the editor", () => {
    render(<TestBeats focusBody={["judge"]} startAt={2} />);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Notes" }));
  });

  it("Back to a body-focus beat focuses its field again", async () => {
    render(<TestBeats focusBody={["who"]} />);
    expect(document.activeElement).toBe(screen.getByLabelText("Agent"));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(document.activeElement).toBe(heading("Paste the reply"));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Agent"));
  });

  it("a body-focus beat with no field falls back to the heading", () => {
    function NoField() {
      const beats: Beat[] = [{ id: "a", title: "Nothing to type", forward: "Next", focusBody: true, body: <p>Read this</p> }];
      return <Deck label="Test" beats={beats} onClose={() => {}} onFinish={async () => {}} />;
    }
    render(<NoField />);
    expect(document.activeElement).toBe(heading("Nothing to type"));
  });
});

// The real editor in a deck (U6, R19, R21). In development, React mounts a newly shown
// editor twice under StrictMode, and the second mount moves Tiptap's DOM after the deck has
// focused it, so the deck takes focus back once the editor has settled. ProseMirror marks
// every Escape as handled, so the editor leaves Escape to the deck. The flow suites replace
// RichText with a textarea, so this is where the real editor meets the deck's focus and keys.
describe("Deck with the real editor, under StrictMode", () => {
  function WithEditor({ startAt }: { startAt?: number }) {
    const [reply, setReply] = useState("");
    const beats: Beat[] = [
      { id: "who", title: "Who takes it", forward: "Next", body: <p>Opus</p> },
      {
        id: "paste",
        title: "Paste the reply",
        forward: "Judge it",
        valid: reply.trim() !== "",
        pane: true,
        focusBody: true,
        body: <RichText aria-label="Reply" value={reply} onChange={setReply} placeholder="Paste the reply" />,
      },
    ];
    return <Deck label="Test an agent" beats={beats} startAt={startAt} onClose={() => {}} onFinish={async () => {}} />;
  }

  /** Lets Tiptap's own deferred work (its destroy check runs on a timer) and a few frames pass. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

  it("arriving at an editor beat leaves focus in the editor", async () => {
    render(
      <StrictMode>
        <WithEditor />
      </StrictMode>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    const editor = screen.getByRole("textbox", { name: "Reply" });
    await waitFor(() => expect(document.activeElement).toBe(editor));
    await settle();
    expect(document.activeElement).toBe(editor);
  });

  it("Escape in the editor moves focus to the forward action, and the next Escape goes back a card", async () => {
    render(
      <StrictMode>
        <WithEditor startAt={1} />
      </StrictMode>,
    );
    const editor = screen.getByRole("textbox", { name: "Reply" });
    await waitFor(() => expect(document.activeElement).toBe(editor));
    const ed = (editor as HTMLElement & { editor?: { commands: { insertContent(text: string): boolean } } }).editor!;
    act(() => {
      ed.commands.insertContent("Looks good");
    });
    // With the key code a browser sends, which is what ProseMirror reads.
    fireEvent.keyDown(editor, { key: "Escape", code: "Escape", keyCode: 27 });
    expect(heading("Paste the reply")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Judge it" }));
    await userEvent.keyboard("{Escape}");
    expect(heading("Who takes it")).toBeTruthy();
  });

  it("a deck that opens on an editor beat leaves focus in the editor", async () => {
    render(
      <StrictMode>
        <WithEditor startAt={1} />
      </StrictMode>,
    );
    const editor = screen.getByRole("textbox", { name: "Reply" });
    await waitFor(() => expect(document.activeElement).toBe(editor));
    await settle();
    expect(document.activeElement).toBe(editor);
  });
});

describe("Escape in a deck", () => {
  it("in a text field on a pane beat, Escape keeps the deck open and moves focus to the forward action", async () => {
    const onClose = vi.fn();
    render(<TestBeats panes={["paste"]} startAt={1} onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Reply"), "Looks good");
    await userEvent.keyboard("{Escape}");
    expect(heading("Paste the reply")).toBeTruthy();
    expect((screen.getByLabelText("Reply") as HTMLTextAreaElement).value).toBe("Looks good");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Judge it" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("with the forward action disabled, that Escape moves focus to the heading", async () => {
    const onClose = vi.fn();
    render(<TestBeats panes={["paste"]} startAt={1} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText("Reply"));
    expect((screen.getByRole("button", { name: "Judge it" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(heading("Paste the reply"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("in an editor on a pane beat with no forward action, Escape moves focus to the heading", () => {
    const onClose = vi.fn();
    render(<TestBeats panes={["judge"]} startAt={2} onClose={onClose} />);
    const notes = screen.getByRole("textbox", { name: "Notes" });
    notes.focus();
    const escape = fireEvent.keyDown(notes, { key: "Escape" });
    expect(escape).toBe(false);
    expect(heading("Judge it")).toBeTruthy();
    expect(document.activeElement).toBe(heading("Judge it"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape on a pane beat that is not first shows the previous beat", async () => {
    const onClose = vi.fn();
    render(<TestBeats panes={["paste"]} startAt={1} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(heading("Who takes it")).toBeTruthy();
    expect(document.activeElement).toBe(heading("Who takes it"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a second Escape after leaving the field goes back a beat", async () => {
    render(<TestBeats panes={["paste"]} startAt={1} />);
    await userEvent.type(screen.getByLabelText("Reply"), "Looks good");
    await userEvent.keyboard("{Escape}");
    expect(heading("Paste the reply")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(heading("Who takes it")).toBeTruthy();
  });

  it("a checkbox is not a text field: Escape on it on a pane beat goes back", async () => {
    render(<TestBeats panes={["paste"]} startAt={1} />);
    await userEvent.click(screen.getByLabelText("Keep as written"));
    await userEvent.keyboard("{Escape}");
    expect(heading("Who takes it")).toBeTruthy();
  });

  it("with unsaved work, Escape on a pane beat still goes back a beat", async () => {
    const onClose = vi.fn();
    render(<TestBeats panes={["paste"]} startAt={1} unsaved onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(heading("Who takes it")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("with unsaved work, Escape on a non-pane beat keeps the deck open", async () => {
    const onClose = vi.fn();
    render(<TestBeats startAt={1} unsaved onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByLabelText("Reply"));
    await userEvent.keyboard("{Escape}");
    expect(heading("Paste the reply")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("with unsaved work, Escape on the first beat keeps the deck open, pane or not", async () => {
    const onClose = vi.fn();
    render(<TestBeats unsaved onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(heading("Who takes it")).toBeTruthy();
    cleanup();
    render(<TestBeats panes={["who"]} unsaved onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(heading("Who takes it")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("with unsaved work, the corner control and Back on the first beat still close", async () => {
    const onClose = vi.fn();
    render(<TestBeats panes={["who"]} unsaved onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("without unsaved work, Escape on a non-pane beat closes the deck, as today", async () => {
    const onClose = vi.fn();
    render(<TestBeats startAt={1} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("without unsaved work, Escape in a text field on a non-pane beat closes the deck, as today", async () => {
    const onClose = vi.fn();
    render(<TestBeats startAt={1} onClose={onClose} />);
    await userEvent.type(screen.getByLabelText("Reply"), "Looks good");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("without unsaved work, Escape on a first beat that is a pane closes the deck, as today", async () => {
    const onClose = vi.fn();
    render(<TestBeats panes={["who"]} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("an Escape another handler already took is ignored", async () => {
    const take = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", take, true);
    try {
      const onClose = vi.fn();
      render(<TestBeats panes={["paste"]} startAt={1} onClose={onClose} />);
      await userEvent.type(screen.getByLabelText("Reply"), "Looks good");
      await userEvent.keyboard("{Escape}");
      expect(document.activeElement).toBe(screen.getByLabelText("Reply"));
      heading("Paste the reply").focus();
      await userEvent.keyboard("{Escape}");
      expect(heading("Paste the reply")).toBeTruthy();
      cleanup();
      render(<TestBeats onClose={onClose} />);
      await userEvent.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", take, true);
    }
  });
});
