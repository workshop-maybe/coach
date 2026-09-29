// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { FolderProvider, describeError, useFolder } from "./useFolderState";
import { MemoryStorage } from "../storage/memory";
import { ChangedOnDiskError } from "../storage/storage";
import { MARKER_PATH, credentialPath, saveText } from "../domain/folder";
import { serializeCredentialMd } from "../domain/credential-md";
import type { Credential } from "../domain/types";

afterEach(cleanup);

const cred: Credential = {
  slug: "review",
  collectionSlug: "eng",
  name: "Review",
  learningTargets: ["I can review."],
  task: "Do a review.",
  rubric: "Good review.",
  extraSections: [],
};
const path = credentialPath("eng", "review");

function fixture(): MemoryStorage {
  return new MemoryStorage({
    [MARKER_PATH]: '{ "format": 1 }\n',
    [path]: serializeCredentialMd(cred),
  });
}

/** A stand-in editor: the draft and its opening text live in component state (KTD6). */
function Editor() {
  const { state, storage } = useFolder();
  const [base] = useState(() => state?.raw[path] ?? null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const names = state?.credentials.map((c) => c.name).join(",") ?? "";
  return (
    <div>
      <p>names: {names}</p>
      <textarea aria-label="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button
        onClick={async () => {
          try {
            await saveText(storage, path, draft, base);
            setError(null);
          } catch (e) {
            setError(describeError(e));
          }
        }}
      >
        Save
      </button>
      {error && <p role="status">{error}</p>}
    </div>
  );
}

function Harness({ storage }: { storage: MemoryStorage }) {
  return (
    <FolderProvider storage={storage} folder="/data">
      <Gate />
    </FolderProvider>
  );
}

function Gate() {
  const { state } = useFolder();
  return state ? <Editor /> : <p>loading</p>;
}

describe("describeError", () => {
  it("turns a changed-on-disk error into the reload-or-keep choice", () => {
    expect(describeError(new ChangedOnDiskError("a/b.md"))).toBe("Changed on disk: reload or keep editing");
  });

  it("uses the message of other errors", () => {
    expect(describeError(new Error("disk full"))).toBe("disk full");
    expect(describeError("plain")).toBe("plain");
  });
});

describe("FolderProvider", () => {
  it("loads the folder on mount", async () => {
    render(<Harness storage={fixture()} />);
    expect(await screen.findByText("names: Review")).toBeTruthy();
  });

  it("an outside edit plus a focus reload swaps state but keeps the draft, and the next save reports changed on disk", async () => {
    const storage = fixture();
    render(<Harness storage={storage} />);
    await screen.findByText("names: Review");
    await userEvent.type(screen.getByLabelText("draft"), "my draft");

    storage.seed({ [path]: serializeCredentialMd({ ...cred, name: "Review edited" }) });
    await act(async () => {
      fireEvent.focus(window);
    });
    expect(await screen.findByText("names: Review edited")).toBeTruthy();
    expect((screen.getByLabelText("draft") as HTMLTextAreaElement).value).toBe("my draft");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Changed on disk: reload or keep editing");
    expect((screen.getByLabelText("draft") as HTMLTextAreaElement).value).toBe("my draft");
    expect(storage.writes).toEqual([]);
  });

  it("reload() on demand picks up outside changes", async () => {
    const storage = fixture();
    let reload: () => Promise<void> = async () => {};
    function Grab() {
      reload = useFolder().reload;
      return null;
    }
    render(
      <FolderProvider storage={storage} folder="/data">
        <Grab />
        <Gate />
      </FolderProvider>,
    );
    await screen.findByText("names: Review");
    storage.seed({ [path]: serializeCredentialMd({ ...cred, name: "Renamed" }) });
    await act(() => reload());
    expect(screen.getByText("names: Renamed")).toBeTruthy();
  });

  it("a reload with nothing changed on disk keeps the same state object", async () => {
    const storage = fixture();
    const seen: unknown[] = [];
    let reload: () => Promise<void> = async () => {};
    function Grab() {
      const f = useFolder();
      reload = f.reload;
      if (f.state && seen[seen.length - 1] !== f.state) seen.push(f.state);
      return null;
    }
    render(
      <FolderProvider storage={storage} folder="/data">
        <Grab />
      </FolderProvider>,
    );
    await waitFor(() => expect(seen.length).toBe(1));
    await act(() => reload());
    expect(seen.length).toBe(1);
    storage.seed({ [path]: serializeCredentialMd({ ...cred, name: "Renamed" }) });
    await act(() => reload());
    expect(seen.length).toBe(2);
  });

  it("a reload still in flight when apply() runs never overwrites the applied state", async () => {
    const storage = fixture();
    let release: () => void = () => {};
    let gated = false;
    let released = false;
    let reached = false;
    const slow = Object.create(storage) as MemoryStorage;
    // The gated reload reads the credential before the save lands, then stalls.
    slow.readText = async (root, p) => {
      const text = await storage.readText(root, p);
      if (gated && p === path) {
        reached = true;
        await new Promise<void>((r) => (release = () => { released = true; r(); }));
      }
      return text;
    };
    let ctx: ReturnType<typeof useFolder> | null = null;
    function Grab() {
      ctx = useFolder();
      return <p>names: {ctx.state?.credentials.map((c) => c.name).join(",")}</p>;
    }
    render(
      <FolderProvider storage={slow} folder="/data">
        <Grab />
      </FolderProvider>,
    );
    await screen.findByText("names: Review");
    const before = ctx!.state!;
    gated = true;
    fireEvent.focus(window);
    await waitFor(() => expect(reached).toBe(true));
    // Stands in for a save: new text on disk for that file, and the state the save returned.
    const savedText = serializeCredentialMd({ ...cred, name: "Applied" });
    storage.seed({ [path]: savedText });
    const applied = { ...before, credentials: [{ ...before.credentials[0], name: "Applied" }], raw: { ...before.raw, [path]: savedText } };
    act(() => ctx!.apply(applied));
    await screen.findByText("names: Applied");
    gated = false;
    expect(released).toBe(false);
    await act(async () => release());
    expect(released).toBe(true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByText("names: Applied")).toBeTruthy();
  });

  it("apply() swaps state and setNotice shows a notice", async () => {
    const storage = fixture();
    function Applier() {
      const { state, apply, notice, setNotice } = useFolder();
      return (
        <div>
          <button onClick={() => state && apply({ ...state, credentials: [] })}>Clear</button>
          <button onClick={() => setNotice("Saved")}>Notify</button>
          {notice && <p>notice: {notice}</p>}
        </div>
      );
    }
    render(
      <FolderProvider storage={storage} folder="/data">
        <Applier />
        <Gate />
      </FolderProvider>,
    );
    await screen.findByText("names: Review");
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(screen.getByText("names:")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Notify" }));
    expect(screen.getByText("notice: Saved")).toBeTruthy();
  });

  it("a failed load becomes the notice", async () => {
    const storage = fixture();
    storage.listFiles = async () => {
      throw new Error("folder gone");
    };
    function Show() {
      const { notice, loading } = useFolder();
      return <p>{loading ? "loading" : `notice: ${notice}`}</p>;
    }
    render(
      <FolderProvider storage={storage} folder="/data">
        <Show />
      </FolderProvider>,
    );
    expect(await screen.findByText("notice: folder gone")).toBeTruthy();
  });
});
