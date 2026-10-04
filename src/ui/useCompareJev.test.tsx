// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { serializeCredentialMd } from "../domain/credential-md";
import { credentialPath, headToHeadDir, readingsDir } from "../domain/folder";
import { assignmentVersion } from "../domain/hash";
import { JEV_MODEL, type HeadToHeadRequest, type JevAnswers, type JevRequest, type SecondOpinionRequest } from "../domain/jevRequest";
import { BADGE_CHANGED } from "../domain/operations";
import { credentialKey, type AgentProfile, type Credential, type HeldReply, type JevReading } from "../domain/types";
import { FAKE_ON, FakeJev } from "../jev/fakeJev";
import { JevError } from "../jev/jev";
import type { MemoryStorage } from "../storage/memory";
import { JevProvider, useJev } from "./jevContext";
import { takeOf } from "./replyRoute";
import { useTakeWrites } from "./takeActions";
import { FOLDER, heldReply, opus, storageWith } from "./testFolder";
import { useCompareJev } from "./useCompareJev";
import { FolderProvider, useFolder } from "./useFolderState";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TARGET = "I can find bugs in a diff.";
const badge: Credential = {
  slug: "review",
  collectionSlug: "eng",
  name: "Code review",
  learningTargets: [TARGET],
  task: "Review the attached diff.",
  rubric: "- Finds the bug.\n- Suggests a fix.",
  extraSections: [],
};
const KEY = credentialKey(badge);
const codex: AgentProfile = { ...opus, slug: "codex", name: "Codex", model: "codex" };
const gemini: AgentProfile = { ...opus, slug: "gemini", name: "Gemini", model: "gemini" };

/** One answer that carries every id a reading or a head-to-head on this badge asks for. */
const ALL: JevAnswers = {
  answers: { p1: 0.7, p2: 0.7, t1: 0.7, overall: 0.7, a1: 0.9, a2: 0.5, b1: 0.1, b2: 0.5 },
  model: JEV_MODEL,
};

async function reading(): Promise<JevReading> {
  return {
    model: JEV_MODEL,
    assignmentVersion: await assignmentVersion(badge.task, badge.rubric),
    askedAt: "2026-09-02T08:00:00.000Z",
    seen: "before",
    overall: 0.6,
    points: [
      { text: "Finds the bug.", probability: 0.6 },
      { text: "Suggests a fix.", probability: 0.6 },
    ],
    targets: [{ text: TARGET, probability: 0.6 }],
    examplesSent: 0,
  };
}

/** Three held replies on the badge, in strip order: Opus, Codex, Gemini. Those named in `read` were read in the test. */
async function threeHeld(read: AgentProfile[] = [opus]) {
  const jev = await reading();
  const held: HeldReply[] = [];
  for (const [i, profile] of [opus, codex, gemini].entries()) {
    held.push(
      await heldReply(profile, badge, {
        fileStem: `2026090${i + 2}T090000Z`,
        heldAt: `2026-09-0${i + 2}T09:00:00.000Z`,
        handBack: `${profile.name}'s reply.`,
        ...(read.includes(profile) ? { jev } : {}),
      }),
    );
  }
  const storage = storageWith({ credentials: [badge], profiles: [opus, codex, gemini], held });
  return { storage, held };
}

/** The hook as the compare view will call it: the takes in strip order, the version once worked out, and the view's write gate. */
function useHarness(held: readonly HeldReply[]) {
  const { state } = useFolder();
  const writes = useTakeWrites();
  const usable = useJev().usable;
  const credential = state?.credentials.find((c) => credentialKey(c) === KEY);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setVersion(null);
    if (credential) void assignmentVersion(credential.task, credential.rubric).then((v) => live && setVersion(v));
    return () => {
      live = false;
    };
  }, [credential?.task, credential?.rubric]); // eslint-disable-line react-hooks/exhaustive-deps
  const takes = state
    ? held.flatMap((ref) => {
        const found = takeOf(state, KEY, ref);
        return found ? [{ id: `${ref.profileSlug}/${ref.fileStem}`, take: found.take, name: found.profile.name }] : [];
      })
    : [];
  const compare = useCompareJev({ key: KEY, credential, version, takes, exclusive: writes.exclusive });
  return { compare, writes, usable };
}

async function mount(storage: MemoryStorage, fake: FakeJev, held: readonly HeldReply[]) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <JevProvider jev={fake}>
      <FolderProvider storage={storage} folder={FOLDER}>
        {children}
      </FolderProvider>
    </JevProvider>
  );
  const hook = renderHook(() => useHarness(held), { wrapper });
  await waitFor(() => expect(hook.result.current.compare.canAsk).toBe(true));
  return hook;
}

/** Runs the plan to its end, or to the failure that stops it. */
async function runAll(hook: Awaited<ReturnType<typeof mount>>) {
  await act(() => hook.result.current.compare.run());
}

/** An ask that waits until the test answers it. */
function waiting(fake: FakeJev) {
  let answer!: (a: JevAnswers) => void;
  fake.queue("ask", new Promise<JevAnswers>((resolve) => (answer = resolve)));
  return answer;
}

const filesIn = (storage: MemoryStorage, dir: string) => Object.keys(storage.files()).filter((p) => p.startsWith(`${dir}/`));
const readingFiles = (storage: MemoryStorage) => [opus, codex, gemini].flatMap((p) => filesIn(storage, readingsDir(p.slug, "eng", "review")));
const pairFiles = (storage: MemoryStorage) => filesIn(storage, headToHeadDir("eng", "review"));
const replyOf = (r: JevRequest) => (r as SecondOpinionRequest).state.reply;
const repliesOf = (r: JevRequest) => [(r as HeadToHeadRequest).state.reply_1, (r as HeadToHeadRequest).state.reply_2];

describe("useCompareJev (KTD8, KTD9)", () => {
  it("says what it will send, then sends readings first in strip order, then pairs, saving each answer before the next ask", async () => {
    const { storage, held } = await threeHeld();
    const fake = new FakeJev(FAKE_ON);
    const events: string[] = [];
    const write = storage.writeText.bind(storage);
    vi.spyOn(storage, "writeText").mockImplementation(async (root, path, contents) => {
      events.push(path.includes("/readings/") ? "save reading" : path.includes("/head-to-head/") ? "save pair" : `save ${path}`);
      await write(root, path, contents);
    });
    const ask = fake.ask.bind(fake);
    vi.spyOn(fake, "ask").mockImplementation(async (request) => {
      events.push(`ask ${request.kind}`);
      return ask(request);
    });
    const hook = await mount(storage, fake, held);
    expect(hook.result.current.compare.countLine).toBe("Sends 5 requests: 2 readings and 3 head-to-heads");
    expect(hook.result.current.compare.tooLongLines).toEqual([]);

    await runAll(hook);

    expect(events).toEqual([
      "ask secondOpinion",
      "save reading",
      "ask secondOpinion",
      "save reading",
      "ask headToHead",
      "save pair",
      "ask headToHead",
      "save pair",
      "ask headToHead",
      "save pair",
    ]);
    expect(fake.asks.slice(0, 2).map(replyOf)).toEqual(["Codex's reply.", "Gemini's reply."]);
    expect(fake.asks.slice(2).map(repliesOf)).toEqual([
      ["Opus agent's reply.", "Codex's reply."],
      ["Opus agent's reply.", "Gemini's reply."],
      ["Codex's reply.", "Gemini's reply."],
    ]);
    expect(readingFiles(storage)).toHaveLength(2);
    expect(pairFiles(storage)).toHaveLength(3);
    const done = hook.result.current.compare;
    expect(done).toMatchObject({ running: false, progress: null, failure: null, canAsk: false, countLine: null });
  });

  it("a rateLimited failure on the third request stops with its line and keeps the first two files; asking again sends only the rest", async () => {
    const { storage, held } = await threeHeld();
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", ALL);
    fake.queue("ask", ALL);
    fake.queue("ask", new JevError("rateLimited"));
    const hook = await mount(storage, fake, held);

    await runAll(hook);

    expect(fake.asks).toHaveLength(3);
    expect(hook.result.current.compare.failure).toBe("Jev has had too many asks. Try again in a moment.");
    expect(readingFiles(storage)).toHaveLength(2);
    expect(pairFiles(storage)).toHaveLength(0);
    expect(hook.result.current.compare.canAsk).toBe(true);
    expect(hook.result.current.compare.countLine).toBe("Sends 3 requests: 3 head-to-heads");

    await runAll(hook);

    expect(fake.asks.slice(3).map((r) => r.kind)).toEqual(["headToHead", "headToHead", "headToHead"]);
    expect(hook.result.current.compare.failure).toBeNull();
    expect(pairFiles(storage)).toHaveLength(3);
  });

  it("a keyMissing failure keeps its line after Jev Mode reads as unusable, and the action stays hidden", async () => {
    const { storage, held } = await threeHeld();
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", new JevError("keyMissing"));
    const hook = await mount(storage, fake, held);

    await runAll(hook);

    await waitFor(() => expect(hook.result.current.usable).toBe(false));
    expect(hook.result.current.compare.failure).toBe("Jev has no key. Add one in Jev Mode in the top bar, on home.");
    expect(hook.result.current.compare.canAsk).toBe(false);
    expect(hook.result.current.compare.countLine).toBeNull();
    expect(fake.asks).toHaveLength(1);
    expect(readingFiles(storage)).toEqual([]);
  });

  it("a failure a retry can't fix hides the action while Jev Mode stays on", async () => {
    const { storage, held } = await threeHeld();
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", new JevError("keyRefused"));
    const hook = await mount(storage, fake, held);

    await runAll(hook);

    expect(hook.result.current.usable).toBe(true);
    expect(hook.result.current.compare.failure).toBe("TypeSafe refused the key. Change it in Jev Mode in the top bar, on home.");
    expect(hook.result.current.compare.canAsk).toBe(false);
  });

  it("a request TypeSafe refused as invalid stops the run with the app's-bug line and hides the action", async () => {
    const { storage, held } = await threeHeld();
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", new JevError("invalidRequest"));
    const hook = await mount(storage, fake, held);

    await runAll(hook);

    expect(hook.result.current.usable).toBe(true);
    expect(fake.asks).toHaveLength(1);
    expect(hook.result.current.compare.failure).toBe("Jev couldn't read the app's request. That's a bug in the app.");
    expect(hook.result.current.compare.canAsk).toBe(false);
  });

  it("a pair refused as too long is named, the items after it are still sent, and asking again in the same compare doesn't resend it", async () => {
    const { storage, held } = await threeHeld([opus, codex, gemini]);
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", ALL);
    fake.queue("ask", new JevError("tooLong"));
    fake.queue("ask", new JevError("rateLimited"));
    const hook = await mount(storage, fake, held);
    expect(hook.result.current.compare.countLine).toBe("Sends 3 requests: 3 head-to-heads");

    await runAll(hook);

    expect(fake.asks).toHaveLength(3);
    expect(hook.result.current.compare.tooLongLines).toEqual(["Opus agent and Gemini are too long for Jev together"]);
    expect(hook.result.current.compare.failure).toBe("Jev has had too many asks. Try again in a moment.");
    expect(hook.result.current.compare.countLine).toBe("Sends 1 request: 1 head-to-head");

    await runAll(hook);

    expect(fake.asks.slice(3).map(repliesOf)).toEqual([["Codex's reply.", "Gemini's reply."]]);
    expect(pairFiles(storage)).toHaveLength(2);
    expect(hook.result.current.compare.canAsk).toBe(false);
    expect(hook.result.current.compare.tooLongLines).toEqual(["Opus agent and Gemini are too long for Jev together"]);
  });

  it("an answer missing an id saves nothing and shows Jev couldn't answer.", async () => {
    const { storage, held } = await threeHeld();
    const fake = new FakeJev(FAKE_ON);
    fake.queue("ask", { answers: { p1: 0.7, overall: 0.7 }, model: JEV_MODEL });
    const hook = await mount(storage, fake, held);

    await runAll(hook);

    expect(hook.result.current.compare.failure).toBe("Jev couldn't answer.");
    expect(fake.asks).toHaveLength(1);
    expect(readingFiles(storage)).toEqual([]);
    expect(hook.result.current.compare.canAsk).toBe(true);
  });

  it("a save that fails shows the folder's error, not a Jev line, and asks nothing more", async () => {
    const { storage, held } = await threeHeld();
    const fake = new FakeJev(FAKE_ON);
    vi.spyOn(storage, "writeText").mockRejectedValueOnce(new Error("The disk is full."));
    const hook = await mount(storage, fake, held);

    await runAll(hook);

    expect(hook.result.current.compare.failure).toBe("The disk is full.");
    expect(hook.result.current.writes.error).toBeNull();
    expect(hook.result.current.writes.saving).toBe(false);
    expect(fake.asks).toHaveLength(1);
    expect(readingFiles(storage)).toEqual([]);
  });

  it("each save goes through the compare's write gate, so its verdicts wait while a Jev answer saves", async () => {
    const { storage, held } = await threeHeld([opus, codex, gemini]);
    const fake = new FakeJev(FAKE_ON);
    const write = storage.writeText.bind(storage);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(storage, "writeText").mockImplementationOnce(async (root, path, contents) => {
      await gate;
      await write(root, path, contents);
    });
    const hook = await mount(storage, fake, held);

    act(() => void hook.result.current.compare.run());
    await waitFor(() => expect(hook.result.current.writes.saving).toBe(true));
    expect(hook.result.current.writes.savingNow.current).toBe(true);

    await act(async () => release());
    await waitFor(() => expect(hook.result.current.compare.running).toBe(false));
    expect(hook.result.current.writes.saving).toBe(false);
    expect(pairFiles(storage)).toHaveLength(3);
  });

  it("the rubric changed on disk mid-run stops it before the next ask, with the changed-badge line", async () => {
    const { storage, held } = await threeHeld();
    const fake = new FakeJev(FAKE_ON);
    const answer = waiting(fake);
    const hook = await mount(storage, fake, held);

    act(() => void hook.result.current.compare.run());
    await waitFor(() => expect(fake.asks).toHaveLength(1));
    storage.seed({ [credentialPath("eng", "review")]: serializeCredentialMd({ ...badge, rubric: `${badge.rubric}\n- Explains why.` }) });
    await act(async () => answer(ALL));

    await waitFor(() => expect(hook.result.current.compare.running).toBe(false));
    expect(hook.result.current.compare.failure).toBe(BADGE_CHANGED);
    expect(fake.asks).toHaveLength(1);
  });

  it("shows progress while it runs, and leaving mid-run sends nothing more and saves no late answer", async () => {
    const { storage, held } = await threeHeld();
    const fake = new FakeJev(FAKE_ON);
    const answer = waiting(fake);
    const hook = await mount(storage, fake, held);

    act(() => void hook.result.current.compare.run());
    await waitFor(() => expect(fake.asks).toHaveLength(1));
    expect(hook.result.current.compare.running).toBe(true);
    expect(hook.result.current.compare.progress).toEqual({ done: 0, total: 5 });

    hook.unmount();
    await act(async () => answer(ALL));
    await new Promise((r) => setTimeout(r, 0));

    expect(fake.asks).toHaveLength(1);
    expect(readingFiles(storage)).toEqual([]);
  });
});
