// Test an agent against a credential (U5, R14-R17): who takes it, hand it over, what came
// back, did it meet it. Starting from a badge asks for an agent; starting from an agent
// asks for a badge, and a missing side has a door to create it and come back (AE2).
// Copy leaves the test waiting in "What needs you" (KTD5) until a result is recorded or
// it is dismissed. The exchange plays on the agent's machine (R5-R7, KTD4): the cartridge
// slides into its slot, Copy sends dots across the screen and then a cursor waits, the
// reply's first lines show, and a result ejects the cartridge. Met lights and seats a key.

import { useEffect, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { assignmentVersion } from "../domain/hash";
import { sameSetup } from "../domain/matrix";
import { recordAssessment } from "../domain/operations";
import { testPrompt } from "../domain/prompts";
import { credentialKey, type AgentProfile, type AssessmentResult, type Credential, type Slug, type TestContext } from "../domain/types";
import { Cartridge } from "../cast/Cartridge";
import { Machine } from "../cast/Machine";
import { Outline } from "../cast/Outline";
import { machineKeys, replyScreen, trigPages, type ScreenState } from "../cast/mappings";
import { Deck, type Beat } from "./Deck";
import { useNav } from "./nav";
import { usePendingTests, type PendingTest } from "./pendingTests";
import { RichText } from "./RichText";
import { focusOnMount } from "./shared";
import { describeError, useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";

/** How long the landing plays before home returns. */
export const LANDING_MS = 1400;

/** How long the dots run across the screen after Copy before the cursor waits. */
export const SENDING_MS = 700;

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface TestDeckProps {
  profileSlug?: Slug;
  credentialKey?: string;
  /** Open at "what came back" for a test already copied (R17). */
  resume?: boolean;
}

type Outcome = { kind: "open" } | { kind: "met" } | { kind: "not-yet" };

export function TestDeck(props: TestDeckProps) {
  const { storage, state, folder, apply } = useFolder();
  const { navigate } = useNav();
  const { pending, add, remove } = usePendingTests(folder);
  const [profileSlug, setProfileSlug] = useState(props.profileSlug);
  const [key, setKey] = useState(props.credentialKey);
  // What the route handed in decides which "who takes it" card this round asks.
  const [asks, setAsks] = useState<{ agent: boolean; badge: boolean }>(() => ({
    badge: !props.credentialKey,
    agent: !props.profileSlug || !!props.credentialKey,
  }));
  const [round, setRound] = useState(0);
  const [reply, setReply] = useState("");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "open" });
  const result = useRef<AssessmentResult>("met");
  const [version, setVersion] = useState<string | null>(null);
  // The machine's screen through Copy: dots out, then the cursor waits.
  const [sending, setSending] = useState(false);
  // A failed Copy again, shown on the card as the deck shows its own errors.
  const [copyError, setCopyError] = useState<string | null>(null);
  const matrix = useMatrix(state);

  const profile = state?.profiles.find((p) => p.slug === profileSlug);
  const credential = state?.credentials.find((c) => credentialKey(c) === key);
  const collectionOf = (c: Credential) => state?.collections.find((x) => x.slug === c.collectionSlug);
  const waiting = pending.find((p) => p.profileSlug === profileSlug && p.credentialKey === key);

  // The credential's current assignment version, to tell whether a copied prompt is stale.
  useEffect(() => {
    let live = true;
    setVersion(null);
    if (credential) void assignmentVersion(credential.task, credential.rubric).then((v) => live && setVersion(v));
    return () => {
      live = false;
    };
  }, [credential?.task, credential?.rubric]);

  const home = () => navigate({ view: "home" });
  const goHome = useRef(home);
  goHome.current = home;

  // Met plays the landing, then home returns on its own.
  useEffect(() => {
    if (outcome.kind !== "met") return;
    const t = window.setTimeout(() => goHome.current(), LANDING_MS);
    return () => window.clearTimeout(t);
  }, [outcome.kind]);

  // The dots run a moment, then the cursor waits. Under reduced motion it waits at once.
  useEffect(() => {
    if (!sending) return;
    const t = window.setTimeout(() => setSending(false), reducedMotion() ? 0 : SENDING_MS);
    return () => window.clearTimeout(t);
  }, [sending]);

  if (!state) return null;

  async function copy() {
    if (!credential || !profile) return;
    setSending(true);
    // The context the test starts with (R1). It never blocks or fails the copy (KTD8).
    const capturedAt = new Date().toISOString();
    const reading = storage.readContext(profile.repo, profile.harness).then(
      (r): TestContext => ({ ...r, capturedAt }),
      () => undefined,
    );
    try {
      await writeText(testPrompt(credential, profile));
    } catch (e) {
      setSending(false);
      throw e;
    }
    const context = await reading;
    add({
      profileSlug: profile.slug,
      credentialKey: credentialKey(credential),
      copiedAt: new Date().toISOString(),
      assignmentVersion: version ?? (await assignmentVersion(credential.task, credential.rubric)),
      setup: { harness: profile.harness, model: profile.model, effort: profile.effort },
      ...(context ? { context } : {}),
    });
  }

  async function record() {
    if (!state || !credential || !profile) return;
    const next = await recordAssessment(storage, state, {
      profileSlug: profile.slug,
      collectionSlug: credential.collectionSlug,
      credentialSlug: credential.slug,
      result: result.current,
      note: "",
      handBack: reply,
      ...(waiting?.context ? { context: waiting.context } : {}),
    });
    remove(profile.slug, credentialKey(credential));
    apply(next);
    setOutcome({ kind: result.current === "met" ? "met" : "not-yet" });
  }

  async function copyAgain() {
    setCopyError(null);
    try {
      await copy();
    } catch (e) {
      setCopyError(describeError(e));
    }
  }

  function tryAnother() {
    setProfileSlug(undefined);
    setAsks({ agent: true, badge: false });
    setReply("");
    setOutcome({ kind: "open" });
    setSending(false);
    setRound((r) => r + 1);
  }

  const collection = credential ? collectionOf(credential) : undefined;
  const keys = matrix && profile ? machineKeys(matrix, profile.slug) : [];

  /** The agent's machine with this test's cartridge in its slot, sliding in or ejecting. */
  const loadedMachine = (screen: ScreenState, { phase, seated }: { phase?: "loading" | "ejecting"; seated?: string } = {}) =>
    profile && credential && collection ? (
      <div className="test-stage">
        <Machine
          setup={profile}
          keys={keys}
          page={seated ? pageOf(keys, seated) : 0}
          seated={seated}
          screen={screen}
          loaded={{ collection, credential }}
          headroom
          width={280}
          className={phase && PHASE_CLASS[phase]}
        />
      </div>
    ) : null;

  if (outcome.kind === "met" && credential && collection && profile) {
    const lit = credentialKey(credential);
    return (
      <section className="deck" aria-label="Test an agent">
        <div className="deck-card landing" data-testid="landing">
          <h2 tabIndex={-1} ref={focusOnMount}>
            {profile.name} holds it
          </h2>
          {loadedMachine({ kind: "idle" }, { phase: "ejecting", seated: lit })}
          <div className="deck-actions">
            <button type="button" className="ghost" onClick={home}>
              Home
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (outcome.kind === "not-yet" && profile) {
    return (
      <section className="deck" aria-label="Test an agent">
        <div className="deck-card">
          <h2 tabIndex={-1} ref={focusOnMount}>
            Not yet
          </h2>
          {loadedMachine({ kind: "idle" }, { phase: "ejecting" })}
          <p className="muted">{profile.name} does not hold it</p>
          <div className="deck-actions">
            <button type="button" className="ghost" onClick={home}>
              Done
            </button>
            <button type="button" className="primary" onClick={tryAnother}>
              Try another agent
            </button>
          </div>
        </div>
      </section>
    );
  }

  const beats: Beat[] = [];

  if (asks.badge) {
    beats.push({
      id: "badge",
      title: "Which badge",
      settled: credential?.name,
      body: ({ advance }) => (
        <ul className="choices choices-badges">
          {state.credentials.map((c) => {
            const col = collectionOf(c);
            const k = credentialKey(c);
            return (
              <li key={k}>
                <button
                  type="button"
                  className="choice"
                  aria-pressed={k === key}
                  onClick={() => {
                    setKey(k);
                    advance();
                  }}
                >
                  {col && <Cartridge collection={col} credential={c} width={48} />}
                  <span className="choice-name">{c.name}</span>
                </button>
              </li>
            );
          })}
          <li>
            <button type="button" className="choice choice-door" onClick={() => navigate({ view: "deck", deck: "credential", returnTo: { profileSlug } })}>
              <Outline kind="cartridge" width={40} />
              <span className="choice-name">Create a credential</span>
            </button>
          </li>
        </ul>
      ),
    });
  }

  if (asks.agent) {
    beats.push({
      id: "agent",
      title: "Who takes it",
      settled: profile?.name,
      body: ({ advance }) => (
        <ul className="choices">
          {state.profiles.map((p: AgentProfile) => (
            <li key={p.slug}>
              <button
                type="button"
                className="choice"
                aria-pressed={p.slug === profileSlug}
                onClick={() => {
                  setProfileSlug(p.slug);
                  advance();
                }}
              >
                <Machine mini setup={p} keys={matrix ? machineKeys(matrix, p.slug) : []} width={96} />
                <span className="choice-name">{p.name}</span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="choice choice-door" onClick={() => navigate({ view: "deck", deck: "agent", returnTo: { credentialKey: key } })}>
              <Outline kind="machine" width={96} />
              <span className="choice-name">Create an agent</span>
            </button>
          </li>
        </ul>
      ),
    });
  }

  const noTask = !!credential && credential.task.trim() === "";
  beats.push({
    id: "hand",
    title: "Hand it over",
    forward: "Copy",
    valid: !!credential && !!profile && !noTask,
    settled: "Copied",
    onForward: copy,
    body: noTask ? (
      <p className="muted">This badge has no task yet</p>
    ) : (
      <>
        {loadedMachine({ kind: sending ? "sending" : "idle" }, { phase: "loading" })}
        <p className="muted">Copy the prompt, paste it into {profile?.name ?? "the agent"}, and bring back what it says</p>
      </>
    ),
  });

  const stale = staleReason(waiting, version, profile);
  const replyMachine = loadedMachine(sending ? { kind: "sending" } : reply.trim() ? replyScreen(reply) : { kind: "waiting" });
  beats.push({
    id: "reply",
    title: "What came back",
    forward: stale ? undefined : "Next",
    // A waiting test is checked for a changed task before its reply can be recorded.
    valid: reply.trim() !== "" && !(waiting && version === null),
    settled: reply.trim() ? `${reply.trim().slice(0, 80)}${reply.trim().length > 80 ? "…" : ""}` : undefined,
    body: stale ? (
      <>
        {replyMachine}
        <p className="muted">{stale} since you copied it</p>
        <div>
          <button type="button" className="primary" onClick={() => void copyAgain()}>
            Copy again
          </button>
        </div>
        {copyError && (
          <p className="deck-error" role="alert">
            {copyError}
          </p>
        )}
        <DismissLink onDismiss={() => dismiss()} />
      </>
    ) : (
      <>
        {replyMachine}
        <RichText aria-label="Reply" value={reply} onChange={setReply} placeholder="Paste the reply" />
        {waiting && <DismissLink onDismiss={() => dismiss()} />}
      </>
    ),
  });

  const rubric = credential?.rubric.trim() ?? "";
  beats.push({
    id: "meet",
    title: "Did it meet it",
    body: ({ advance }) => (
      <div className={rubric ? "meet meet-with-rubric" : "meet"}>
        {rubric && (
          <div className="meet-rubric">
            <span className="meet-rubric-head">Rubric</span>
            <p>{rubric}</p>
          </div>
        )}
        <div className="meet-choices">
          <button
            type="button"
            className="primary"
            onClick={() => {
              result.current = "met";
              advance();
            }}
          >
            Met
          </button>
          <button
            type="button"
            onClick={() => {
              result.current = "not_met";
              advance();
            }}
          >
            Not yet
          </button>
        </div>
      </div>
    ),
  });

  function dismiss() {
    if (profileSlug && key) remove(profileSlug, key);
    home();
  }

  const replyAt = beats.findIndex((b) => b.id === "reply");
  const handAt = replyAt - 1;
  const startAt = props.resume && waiting ? replyAt : props.credentialKey && props.profileSlug && round === 0 ? handAt : 0;

  return <Deck key={round} label="Test an agent" beats={beats} startAt={startAt} onClose={home} onFinish={record} />;
}

/** The cartridge's motion for each phase of the test. */
const PHASE_CLASS = { loading: "cast-loading", ejecting: "cast-ejecting" } as const;

/** The page of keys that holds `id`, so a key that just lit is in view. The machine clamps the rest. */
function pageOf(keys: readonly { id: string }[], id: string): number {
  return trigPages(keys).findIndex((page) => page.some((k) => k.id === id));
}

function staleReason(waiting: PendingTest | undefined, version: string | null, profile: AgentProfile | undefined): string | null {
  if (!waiting || !profile || version === null) return null;
  if (waiting.assignmentVersion !== version) return "The task changed";
  if (!sameSetup(waiting.setup, profile)) return "The agent's setup changed";
  return null;
}

function DismissLink({ onDismiss }: { onDismiss(): void }) {
  return (
    <p className="helper">
      <button type="button" className="link" onClick={onDismiss}>
        Dismiss this test
      </button>
    </p>
  );
}

