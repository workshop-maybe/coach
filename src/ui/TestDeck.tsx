// Test an agent against a credential (U5, R14-R17): who takes it, hand it over, what came
// back, did it meet it. Starting from a badge asks for an agent; starting from an agent
// asks for a badge, and a missing side has a door to create it and come back (AE2).
// Copy leaves the test waiting in "What needs you" (KTD5) until a result is recorded or
// it is dismissed. Met lands the badge on the agent, the one motion in the flow (R16).

import { useEffect, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { assignmentVersion } from "../domain/hash";
import { recordAssessment } from "../domain/operations";
import { testPrompt } from "../domain/prompts";
import { credentialKey, type AgentProfile, type AgentSetup, type AssessmentResult, type Credential, type Slug } from "../domain/types";
import { Badge } from "./Badge";
import { focusOnMount } from "./CredentialDeck";
import { Deck, type Beat } from "./Deck";
import { useNav } from "./nav";
import { usePendingTests, type PendingTest } from "./pendingTests";
import { Person } from "./Person";
import { useFolder } from "./useFolderState";

/** How long the landing plays before home returns. */
export const LANDING_MS = 1400;

export interface TestDeckProps {
  profileSlug?: Slug;
  credentialKey?: string;
  /** Open at "what came back" for a test already copied (R17). */
  resume?: boolean;
}

type Outcome = { kind: "open" } | { kind: "met" } | { kind: "not-yet" };

const sameSetup = (a: AgentSetup, b: AgentSetup) => a.harness === b.harness && a.model === b.model && a.effort === b.effort;

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
  }, [credential?.task, credential?.rubric, credential]);

  const home = () => navigate({ view: "home" });

  // Met plays the landing, then home returns on its own.
  useEffect(() => {
    if (outcome.kind !== "met") return;
    const t = window.setTimeout(home, LANDING_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome.kind]);

  if (!state) return null;

  async function copy() {
    if (!credential || !profile) return;
    await writeText(testPrompt(credential, profile));
    add({
      profileSlug: profile.slug,
      credentialKey: credentialKey(credential),
      copiedAt: new Date().toISOString(),
      assignmentVersion: await assignmentVersion(credential.task, credential.rubric),
      setup: { harness: profile.harness, model: profile.model, effort: profile.effort },
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
    });
    remove(profile.slug, credentialKey(credential));
    apply(next);
    setOutcome({ kind: result.current === "met" ? "met" : "not-yet" });
  }

  function tryAnother() {
    setProfileSlug(undefined);
    setAsks({ agent: true, badge: false });
    setReply("");
    setOutcome({ kind: "open" });
    setRound((r) => r + 1);
  }

  const collection = credential ? collectionOf(credential) : undefined;

  if (outcome.kind === "met" && credential && collection && profile) {
    return (
      <section className="deck" aria-label="Test an agent">
        <div className="deck-card landing" data-testid="landing">
          <h2 tabIndex={-1} ref={focusOnMount}>
            {profile.name} holds it
          </h2>
          <div className="landing-stage" aria-hidden="true">
            <span className="landing-badge">
              <Badge collection={collection} credential={credential} size={96} />
            </span>
            <span className="landing-person">
              <Person solid />
            </span>
          </div>
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
                  {col && <Badge collection={col} credential={c} size={56} />}
                  <span className="choice-name">{c.name}</span>
                </button>
              </li>
            );
          })}
          <li>
            <button type="button" className="choice choice-door" onClick={() => navigate({ view: "deck", deck: "credential", returnTo: { profileSlug } })}>
              <span className="door-disc" aria-hidden="true" />
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
                <Person solid={p.slug === profileSlug} />
                <span className="choice-name">{p.name}</span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="choice choice-door" onClick={() => navigate({ view: "deck", deck: "agent", returnTo: { credentialKey: key } })}>
              <Person />
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
      <p className="muted">Copy the prompt, paste it into {profile?.name ?? "the agent"}, and bring back what it says</p>
    ),
  });

  const stale = staleReason(waiting, version, profile);
  beats.push({
    id: "reply",
    title: "What came back",
    forward: stale ? undefined : "Next",
    // A waiting test is checked for a changed task before its reply can be recorded.
    valid: reply.trim() !== "" && !(waiting && version === null),
    settled: reply.trim() ? `${reply.trim().slice(0, 80)}${reply.trim().length > 80 ? "…" : ""}` : undefined,
    body: stale ? (
      <>
        <p className="muted">{stale} since you copied it</p>
        <div>
          <button type="button" className="primary" onClick={() => void copy()}>
            Copy again
          </button>
        </div>
        <DismissLink onDismiss={() => dismiss()} />
      </>
    ) : (
      <>
        <textarea aria-label="Reply" value={reply} onChange={(e) => setReply(e.target.value)} />
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

