// A reply to a program badge, opened (U5 of docs/plans/2026-10-20-1605-feat-bounded-programs-plan.md,
// R6-R11, R17, R19; KTD4, KTD9, KTD12). It opens straight from the reply route in place of the
// reply view, and keeps that view's header, verdict actions and way back: the take is found in
// the folder on every render, Close and Escape go back by the rule in replyRoute.ts, and the
// verdict step judges as it does there. Fixture results sit beside the verdict and never set it.
//
// The program is found again in the reply's text each time (KTD5) and only ever reaches
// Quinelings' bounded interpreter as parsed data (R18), in one session the view owns (KTD9). The
// runtime loads lazily; while it loads, the view says it is busy. Running the fixtures is
// synchronous work in the click handler. A load that lands after the view has gone sets nothing.
//
// The layout is the plan's: the checks with Run the fixtures and the verdict actions over the
// fixtures and the selected one's detail on the left, the body on the right, then the reply,
// Jev's saved reading and the handoff that ran below. A reply with no program, or one that does
// not compile, says what failed and shows the outline of a missing body (R17).

import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { Outline } from "../cast/Outline";
import { handoffTextOf, isHeld, readingOfTake, takeTime } from "../domain/handoffResults";
import { runFixtures, type FixtureActual, type FixtureExpected, type FixtureResult } from "../domain/fixtureRun";
import { checkProgram } from "../domain/programChecks";
import { findProgram } from "../domain/programReply";
import { loadQuinelings, newSession, type QdlJobId, type QdlSession, type QuinelingsRuntime } from "../domain/quinelings";
import { replyItems, textOf } from "../domain/replyItems";
import { rubricParts } from "../domain/secondOpinion";
import { credentialKey } from "../domain/types";
import { formatDate, handoffText } from "./format";
import { resultImages } from "./imageSource";
import { SavedReading } from "./JevReading";
import { JudgeStep, useVerdictStep } from "./JudgeStep";
import { useNav } from "./nav";
import { usePane } from "./pane";
import { QuinelingBody } from "./QuinelingBody";
import { backFromReply, takeIdOf, takeOf } from "./replyRoute";
import { ReplyStack } from "./ReplyStack";
import type { TakeRef } from "./routes";
import { Missing, StoredSwitch, TakeBar, useEscape } from "./shared";
import { TakeActions, useTakeWrites } from "./takeActions";
import { useAssignmentVersion } from "./useAssignmentVersion";
import { describeError, useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";

/** The runtime and the view's own session, once loaded, or why it failed to load. */
type Loaded = { kind: "loading" } | { kind: "ready"; rt: QuinelingsRuntime; session: QdlSession } | { kind: "failed"; message: string };

/** One run of the fixtures, tied to the artifact it ran, so a reply that reads differently later drops it. */
interface Run {
  artifactId: string;
  results: FixtureResult[];
}

export function QuinelingView({ credentialKey: key, take, picks, jobId }: { credentialKey: string; take: TakeRef; picks?: TakeRef[]; jobId: QdlJobId }) {
  const { state, storage } = useFolder();
  const { navigate } = useNav();
  const matrix = useMatrix(state);
  const [asStored, setAsStored] = useState(false);

  const headingId = useId();
  const checksId = useId();
  const fixturesId = useId();
  const bodyId = useId();
  const writes = useTakeWrites(() => document.getElementById(headingId)?.focus());
  const verdicts = useVerdictStep(writes);

  const credential = state?.credentials.find((c) => credentialKey(c) === key);
  const version = useAssignmentVersion(credential);
  const found = state && credential ? takeOf(state, key, take) : null;
  usePane(found !== null);

  const close = () => {
    if (state) navigate(credential ? backFromReply(matrix, state, key, take, picks) : { view: "home" });
  };
  useEscape(() => {
    if (!writes.savingNow.current) close();
  });

  // One runtime load and one fresh session per view (KTD9).
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    loadQuinelings().then(
      (rt) => live && setLoaded({ kind: "ready", rt, session: newSession(rt) }),
      (e: unknown) => live && setLoaded({ kind: "failed", message: describeError(e) }),
    );
    return () => {
      live = false;
    };
  }, []);

  // Re-derived from the reply's text (KTD5); the memos only spare a parse and a compile per render.
  const text = found ? textOf(replyItems(found.take)) : "";
  const program = useMemo(() => findProgram(text), [text]);
  const session = loaded.kind === "ready" ? loaded.session : null;
  const checks = useMemo(() => (session && program.kind === "program" ? checkProgram(session, program.intent) : null), [session, program]);
  const job = loaded.kind === "ready" ? loaded.rt.QDLV1Library.get(jobId) : null;

  const [run, setRun] = useState<Run | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [walkKey, setWalkKey] = useState(0);

  if (!state) return null;
  if (!credential) return <Missing onHome={close} />;
  if (!found) return <Missing onHome={close} label="Back to the badge" />;

  const { profile, take: a } = found;
  const id = takeIdOf(take);
  const date = formatDate(takeTime(a));
  const note = isHeld(a) ? "" : a.note.trim();
  const reading = readingOfTake(state, a, version);
  const step = verdicts.stepOf(id, a);

  const artifact = checks?.compiles ? checks.artifact : null;
  const results = run && artifact && run.artifactId === artifact.id ? run.results : null;
  const fixtures = job?.fixtures ?? [];
  const names = fixtures.map((f) => f.name);
  const selected = picked !== null && names.includes(picked) ? picked : (names[0] ?? null);
  const shown = results?.find((r) => r.name === selected) ?? null;

  function runAll() {
    if (loaded.kind !== "ready" || !artifact) return;
    try {
      const ran = runFixtures(loaded.session, loaded.rt, artifact, jobId);
      setRun({ artifactId: artifact.id, results: ran });
      setRunError(null);
      setPicked((ran.find((r) => !r.matches) ?? ran[0])?.name ?? null);
      setWalkKey((k) => k + 1);
    } catch (e) {
      setRunError(describeError(e));
    }
  }

  function select(name: string) {
    setPicked(name);
    if (results) setWalkKey((k) => k + 1);
  }

  // Up and Down move through the fixtures, the way a list moves.
  function moveIn(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const at = selected === null ? -1 : names.indexOf(selected);
    const next = names[Math.min(names.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next === undefined || next === selected) return;
    e.preventDefault();
    select(next);
    e.currentTarget.querySelectorAll<HTMLButtonElement>("button.fixture")[names.indexOf(next)]?.focus();
  }

  return (
    <section className="pane quineling-view" aria-label={`${profile.name}, ${date}`} aria-busy={loaded.kind === "loading" ? true : undefined}>
      <button type="button" className="deck-close ghost" aria-label="Close" disabled={writes.saving} onClick={close}>
        ×
      </button>
      <div className="quineling-head">
        <TakeBar name={profile.name} take={a} id={headingId} focus>
          {note !== "" && <p className="reply-note">{note}</p>}
        </TakeBar>
      </div>
      <div className="quineling-grid">
        <section className="quineling-panel quineling-checks" aria-labelledby={checksId}>
          <h3 id={checksId} className="quineling-bar">
            Checks
          </h3>
          <div className="quineling-panel-body">
            <ChecksList program={program} checks={checks} loaded={loaded} />
            <button type="button" className="primary" disabled={!artifact} onClick={runAll}>
              Run the fixtures
            </button>
            {runError && (
              <p className="quineling-fail" role="alert">
                {runError}
              </p>
            )}
          </div>
          {step ? (
            <JudgeStep
              key={`${step.id} ${step.verdict}`}
              step={step}
              points={rubricParts(credential.rubric).points}
              saving={writes.saving}
              describedBy={headingId}
              onBack={() => verdicts.back(step)}
              onSave={(extras) => void verdicts.finish(step, a, extras)}
            />
          ) : (
            <TakeActions
              take={a}
              saving={writes.saving}
              describedBy={headingId}
              focus={verdicts.backTo(id)}
              onVerdict={(r) => verdicts.verdict(id, a, key, version, r)}
            />
          )}
        </section>
        <section className="quineling-panel quineling-output" aria-labelledby={fixturesId}>
          <h3 id={fixturesId} className="quineling-bar">
            Fixtures
          </h3>
          {fixtures.length > 0 && (
            <ul className="fixture-list" onKeyDown={moveIn}>
              {fixtures.map((f) => {
                const r = results?.find((x) => x.name === f.name);
                return (
                  <li key={f.name}>
                    <button type="button" className="fixture" aria-pressed={f.name === selected} onClick={() => select(f.name)}>
                      <span className="fixture-name">{f.name}</span>
                      {r && <span className={r.matches ? "fixture-matches" : "fixture-differs"}>{r.matches ? "matches" : "differs"}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {job && selected !== null && (
            <FixtureDetail
              expected={shown?.expected ?? expectedOf(job.fixtures.find((f) => f.name === selected)!, job.intent.outputs)}
              result={shown}
            />
          )}
        </section>
        <section className="quineling-panel quineling-body-panel" aria-labelledby={bodyId}>
          <h3 id={bodyId} className="quineling-bar">
            Body
          </h3>
          <div className="quineling-body">
            {session && artifact ? (
              <QuinelingBody
                session={session}
                artifact={artifact}
                trace={shown ? shown.trace : null}
                walkKey={walkKey}
                redNodeId={shown?.redNodeId ?? null}
                guessNodeId={shown?.likelyCause?.nodeId ?? null}
              />
            ) : (
              loaded.kind !== "loading" && <Outline kind="body" />
            )}
          </div>
        </section>
      </div>
      {writes.error && (
        <p className="deck-error" role="alert">
          {writes.error}
        </p>
      )}
      <article className="reply-record quineling-reply">
        <div className="quineling-bar quineling-reply-bar">
          <span>Reply</span>
          <StoredSwitch asStored={asStored} onToggle={() => setAsStored((s) => !s)} />
        </div>
        <ReplyStack aria-label="Reply" items={replyItems(a)} stored={asStored} source={resultImages(storage, a)} />
      </article>
      {reading && <SavedReading reading={reading} credentialKey={key} hasVerdict={!isHeld(a)} />}
      <details className="reply-ran">
        <summary>{handoffText(state, key, a.handoff?.id)}</summary>
        <pre className="handback">{handoffTextOf(a)}</pre>
      </details>
    </section>
  );
}

/** What the checks found: the program's two checks, or what failed and its diagnostic (R8, R17). */
function ChecksList({ program, checks, loaded }: { program: ReturnType<typeof findProgram>; checks: ReturnType<typeof checkProgram> | null; loaded: Loaded }) {
  if (program.kind === "none") return <p className="quineling-fail">No program found</p>;
  if (program.kind === "several") {
    return (
      <>
        <p className="quineling-fail">More than one program</p>
        <p className="quineling-diagnostic">{program.count} programs in the reply</p>
      </>
    );
  }
  if (program.kind === "unreadable") {
    return (
      <>
        <p className="quineling-fail">Could not read the program</p>
        <p className="quineling-diagnostic">{program.message}</p>
      </>
    );
  }
  if (loaded.kind === "failed") {
    return (
      <>
        <p className="quineling-fail">The checks did not load</p>
        <p className="quineling-diagnostic">{loaded.message}</p>
      </>
    );
  }
  if (!checks) return <p className="muted">Checking…</p>;
  if (!checks.compiles) {
    return (
      <>
        <p className="quineling-fail">Does not compile</p>
        <p className="quineling-diagnostic">
          {checks.code}: {checks.message}
        </p>
      </>
    );
  }
  return (
    <ul className="quineling-check-list">
      <li className="quineling-pass">
        Compiles · {checks.operations} {checks.operations === 1 ? "operation" : "operations"}
      </li>
      <li className={checks.reproducesSource ? "quineling-pass" : "quineling-fail"}>
        {checks.reproducesSource ? "Reproduces its own source" : "Does not reproduce its own source"}
      </li>
    </ul>
  );
}

/** A fixture's expected outcome before any run, keyed by output name as fixtureRun keys it (KTD6). */
function expectedOf(fixture: { expectedOutputs?: unknown[]; expectedStatus?: "refused" | "failed"; expectedDiagnostic?: string }, outputs: string[]): FixtureExpected {
  if (fixture.expectedStatus) return { status: fixture.expectedStatus, code: fixture.expectedDiagnostic ?? "" };
  const values = fixture.expectedOutputs ?? [];
  return { status: "completed", outputs: Object.fromEntries(outputs.map((name, i) => [name, values[i]])) };
}

/** The selected fixture: its expected outcome, and after a run its actual one and the guess at a failure's cause (R11, R16). */
function FixtureDetail({ expected, result }: { expected: FixtureExpected; result: FixtureResult | null }) {
  const differing = new Set(result?.differingOutputs ?? []);
  return (
    <div className="fixture-detail">
      <dl>
        <dt>Expected</dt>
        <dd>
          <Outcome outcome={expected} />
        </dd>
        {result && (
          <>
            <dt>Actual</dt>
            <dd>
              <Outcome
                outcome={result.actual}
                names={expected.status === "completed" ? Object.keys(expected.outputs) : undefined}
                differing={result.matches ? undefined : differing}
              />
            </dd>
          </>
        )}
      </dl>
      {result?.likelyCause && (
        <div className="fixture-guess">
          <h4>Likely cause</h4>
          <p>
            A guess: <span className="quineling-mono">{result.likelyCause.nodeId}</span> gives {show(result.likelyCause.agentValue)} where the job's own program gives{" "}
            {show(result.likelyCause.referenceValue)}
          </p>
        </div>
      )}
    </div>
  );
}

/** Outputs by name, or a refusal or failure as its status and diagnostic. Every value renders as text. */
function Outcome({ outcome, names, differing }: { outcome: FixtureExpected | FixtureActual; names?: string[]; differing?: Set<string> }) {
  if (outcome.status !== "completed") {
    const message = "message" in outcome && outcome.message ? `\n${outcome.message}` : "";
    return (
      <pre className={`quineling-mono${differing ? " fixture-wrong" : ""}`}>
        {outcome.status} · {outcome.code}
        {message}
      </pre>
    );
  }
  return (
    <ul className="fixture-outputs">
      {(names ?? Object.keys(outcome.outputs)).map((name) => (
        <li key={name} className={differing?.has(name) ? "fixture-wrong" : undefined}>
          <span className="fixture-output-name">{name}</span> {show(Object.prototype.hasOwnProperty.call(outcome.outputs, name) ? outcome.outputs[name] : undefined)}
        </li>
      ))}
    </ul>
  );
}

/** A value as JSON text, or "missing" when the run produced none. */
function show(value: unknown): string {
  return value === undefined ? "missing" : JSON.stringify(value);
}
