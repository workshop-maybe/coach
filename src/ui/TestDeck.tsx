// Test an agent against a credential (U5, R14-R17) with the handoff box (U6, R9-R13,
// R16-R18, KTD8, KTD11): which badge, who takes it, hand it over, what came back, did it
// meet it. Starting from a badge asks for the agent first, so the box knows the agent's
// winner (R11); a missing side has a door to create it and come back (AE2). "Hand it over"
// plugs the badge into the box beside the agent and offers the badge's handoffs as keys;
// Copy fills the lit one from the badge, and only once the clipboard holds it does the box
// print the card and the agent take it in. The waiting test is the agent's plug (KTD6)
// until a result is recorded with the handoff that ran, or it is pulled without a result.
// An agent holds one plug: a plug on this badge opens at "What came back", and a plug on
// another badge must be pulled first, as a detour that comes back to this test (R18).
//
// Pasting and judging are panes (U4, R7, R14, R22): "What came back" gives the reply box
// the window under a strip of the drawing (KTD9) and takes first focus (R21), and "Did it
// meet it" shows the reply and the rubric rendered side by side (R11), with a switch to
// both as stored (R12) and Met and Not yet pinned below. Once a reply is pasted the deck
// holds unsaved work, so Escape never throws it away (R19, R20, KTD8).
//
// Jev's second opinion (U6, R6-R13, KTD10, KTD11). When the judge pane first shows, the
// round settles whether it offers one: Jev Mode usable, a rubric, and a reply within
// Jev's budget. In such a round Met and Not yet become choices, Save records the pick, and
// a quiet "Ask Jev" ("Check with Jev" after a pick) puts Jev's reading below the rubric.
// A reading belongs to this round, this reply and this assignment version, and a request
// generation drops any answer that lands after a newer ask, an edit, a save or a new round.
// Every other round judges exactly as before: Met and Not yet save at once.
//
// Jev's cleanup of a terminal paste (U9, R15, R18-R21, KTD17, KTD18). Every paste into the
// reply box gets the meaning-safe fixes. Where Jev is usable, a terminal-looking paste
// that replaced the whole box and still has line breaks Jev could join offers a quiet
// "Clean up with Jev"; the joined text goes in the way a paste does, and "Put back the
// paste" restores what the paste first produced. The deck keeps the paste, the reply as
// the app last wrote it and the cleanup in flight, since going Back remounts the editor.
// The app's own writes are no edit; any other change ends both offers, and a cleanup
// generation drops an answer that lands after an edit, a new paste or the box going away.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { SKELETON_ID, defaultHandoff, fillHandoff, handoffsFor, skeletonOf, winnerFor } from "../domain/handoffs";
import { assignmentVersion } from "../domain/hash";
import { sameSetup } from "../domain/matrix";
import { fitsJev } from "../domain/jevBudget";
import { cleanUpLineBreaks, lineBreakBatches } from "../domain/lineBreaks";
import { recordAssessment } from "../domain/operations";
import { readingParts, secondOpinionRequest, type JevReadingParts } from "../domain/secondOpinion";
import {
  credentialKey,
  type AgentProfile,
  type AssessmentResult,
  type Credential,
  type HandoffTemplate,
  type JevReading,
  type Slug,
  type TestContext,
} from "../domain/types";
import { JevError, toJevError } from "../jev/jev";
import { Cartridge } from "../cast/Cartridge";
import { HandoffBox } from "../cast/HandoffBox";
import { Machine } from "../cast/Machine";
import { Outline } from "../cast/Outline";
import { handoffKeys, machineKeys, openingChoice, replyScreen, trigPages, type HandoffKey, type ScreenState } from "../cast/mappings";
import { Deck, type Beat } from "./Deck";
import { backToTest } from "./HandoffDecks";
import { handoffLabel } from "./format";
import { useJev } from "./jevContext";
import { JevReadingPanel } from "./JevReading";
import { useNav } from "./nav";
import { livePlugs, plugFor, usePendingTests, type PendingTest } from "./pendingTests";
import { RichText } from "./RichText";
import type { PastePayload, RichTextHandle } from "./RichText";
import { RichView } from "./RichView";
import type { TestPick } from "./routes";
import { StoredSwitch, focusOnMount } from "./shared";
import { describeError, useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";

/** How long the landing plays before home returns. */
export const LANDING_MS = 1400;

/** How long the dots run across the screen after Copy before the cursor waits. */
export const SENDING_MS = 700;

/** The Jev model a reading records. The native side pins it (MODEL in src-tauri/src/jev.rs) and does not return it. */
const JEV_MODEL = "jev-1.13.0";

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface TestDeckProps {
  profileSlug?: Slug;
  credentialKey?: string;
  /** Open at "what came back" for a test already copied (R17). */
  resume?: boolean;
  /** The handoff to light in the box, back from a handoff edit (KTD10). */
  handoffId?: string;
  /** The test this pull holds up: a recorded result or a pull goes back to it (R18, AE5). */
  returnTo?: TestPick;
}

/** A handoff as it was copied: its id and the filled text. */
type Copied = HandoffTemplate;

type Outcome = { kind: "open" } | { kind: "met"; plugId: string } | { kind: "not-yet"; plugId: string };

/** The reply as the app last wrote it (KTD18): by a paste, a put-back or Jev's cleanup. */
interface Unedited {
  markdown: string;
  by: "paste" | "putBack" | "cleanup";
  /** A cleanup asked about this text that changed nothing: nothing to join, or a failure and whether asking again can help. */
  note?: { line: string; failed: boolean; retry: boolean };
}

/** Jev's reading in hand, with what it was asked about (KTD11). */
interface HeldReading {
  round: number;
  reply: string;
  assignmentVersion: string;
  askedAt: string;
  parts: JevReadingParts;
  /** The pick when the reading arrived, or null when it came before one (R13). */
  verdictWhenSeen: AssessmentResult | null;
}

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
  // The judge card shows the reply and the rubric as stored rather than rendered (R12).
  const [asStored, setAsStored] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "open" });
  // The verdict a Met or Not yet press saves at once, outside a Jev round.
  const pressed = useRef<AssessmentResult>("met");
  // The pick a Jev round's Save records (KTD10). The ref is the pick when an answer lands.
  const [verdict, setVerdict] = useState<AssessmentResult | null>(null);
  const verdictNow = useRef<AssessmentResult | null>(null);
  const [recording, setRecording] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  // The machine's screen through Copy: dots out, then the cursor waits.
  const [sending, setSending] = useState(false);
  // A failed Copy again, shown on the card as the deck shows its own errors.
  const [copyError, setCopyError] = useState<string | null>(null);
  // The key the operator pressed in the box, for the agent and badge it was pressed for.
  const [picked, setPicked] = useState<{ profileSlug: Slug; key: string; id: string } | null>(null);
  // What this visit put on the clipboard. `fromHand` keeps "Hand it over" in the deck after its own Copy.
  const [copied, setCopied] = useState<(Copied & { profileSlug: Slug; key: string; fromHand: boolean }) | null>(null);
  const matrix = useMatrix(state);
  const jev = useJev();
  // Whether this round offers a second opinion, settled when the judge pane first shows (KTD10).
  const [decision, setDecision] = useState<{ round: number; offered: boolean; tooLong: boolean } | null>(null);
  const [held, setHeld] = useState<HeldReading | null>(null);
  const [asking, setAsking] = useState(false);
  // The last ask's failure. One that can't be retried takes the ask away for the round (KTD20).
  const [jevTrouble, setJevTrouble] = useState<{ round: number; line: string; retry: boolean } | null>(null);
  // The request generation: an answer lands only while its ask is still the latest (KTD11).
  const askGen = useRef(0);
  const inFlight = useRef(false);
  // Jev's cleanup of the paste (KTD18). The ref is the reply box's handle while it is mounted.
  const replyBox = useRef<RichTextHandle>(null);
  // The last paste into the reply box: as it came, as the fixes left it, and whether it can be cleaned up.
  const [pasted, setPasted] = useState<{ raw: string; fixed: string; cleanable: boolean } | null>(null);
  // The reply as the app last wrote it, or null once anything else changed it. The ref is the
  // same, current within the paste and change handlers before a render.
  const [unedited, setUnedited] = useState<Unedited | null>(null);
  const uneditedNow = useRef<Unedited | null>(null);
  // Set while the app writes into the reply box, so its own write is not taken for an edit.
  const writing = useRef(false);
  const [cleaning, setCleaning] = useState(false);
  // The cleanup generation: an answer lands only while its cleanup is still the latest.
  const cleanGen = useRef(0);
  const cleaningNow = useRef(false);

  const profile = state?.profiles.find((p) => p.slug === profileSlug);
  const credential = state?.credentials.find((c) => credentialKey(c) === key);
  const collectionOf = (c: Credential) => state?.collections.find((x) => x.slug === c.collectionSlug);
  const waiting = pending.find((p) => p.profileSlug === profileSlug && p.credentialKey === key);

  // The second opinion this reply would ask for, and whether it fits Jev's budget (KTD19).
  const request = useMemo(
    () => (credential && jev.usable && credential.rubric.trim() !== "" ? secondOpinionRequest({ task: credential.task, rubric: credential.rubric, reply }) : null),
    [credential?.task, credential?.rubric, reply, jev.usable], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const fits = useMemo(() => request !== null && fitsJev(request), [request]);
  // Whether Jev can be asked about the paste at all: not when the paste alone is over Jev's budget (KTD19).
  const pasteFits = useMemo(() => !!pasted?.cleanable && lineBreakBatches(pasted.fixed) !== null, [pasted]);
  // The reading counts only for the round, reply and assignment version it was asked about.
  const shown = held && held.round === round && held.reply === reply && held.assignmentVersion === version ? held : null;

  // Leaving the deck drops any ask or cleanup in flight.
  useEffect(
    () => () => {
      askGen.current++;
      cleanGen.current++;
    },
    [],
  );

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
  // Where a finished test goes: home, or back to the test this pull held up (AE5).
  const leave = () => navigate(props.returnTo ? backToTest(props.returnTo) : { view: "home" });
  const goOn = useRef(leave);
  goOn.current = leave;

  // Met plays the landing, then home (or the held-up test) returns on its own.
  useEffect(() => {
    if (outcome.kind !== "met") return;
    const t = window.setTimeout(() => goOn.current(), LANDING_MS);
    return () => window.clearTimeout(t);
  }, [outcome.kind]);

  // The dots run a moment, then the cursor waits. Under reduced motion it waits at once.
  useEffect(() => {
    if (!sending) return;
    const t = window.setTimeout(() => setSending(false), reducedMotion() ? 0 : SENDING_MS);
    return () => window.clearTimeout(t);
  }, [sending]);

  if (!state) return null;

  // The badge's box: its handoffs, the default, and what opens lit for this agent (KTD8).
  const own = key ? handoffsFor(state, key) : [];
  const keys = handoffKeys(own.map((h) => h.id));
  const has = (id: string | null | undefined): id is string => !!id && keys.some((k) => k.id === id);
  const def = key ? defaultHandoff(state, key).id : SKELETON_ID;
  const won = profile && key ? winnerFor(state, profile.slug, key) : null;
  const choice = openingChoice(def, has(won) ? won : null);
  const pick = picked && picked.profileSlug === profileSlug && picked.key === key && has(picked.id) ? picked.id : null;
  const back = key === props.credentialKey && has(props.handoffId) ? props.handoffId : null;
  const lit = pick ?? back ?? choice.lit;
  const ask = choice.ask;
  const here = copied && copied.profileSlug === profileSlug && copied.key === key ? copied : null;

  const templateOf = (id: string): string | null => (id === SKELETON_ID ? skeletonOf(state).text : own.find((h) => h.id === id)?.text ?? null);
  const fill = (id: string): Copied | null => {
    const template = templateOf(id);
    return credential && template !== null ? { id, text: fillHandoff(template, credential) } : null;
  };
  const labelOf = (id: string) => keys.find((k) => k.id === id)?.label;

  /** Copies a handoff filled from the badge as it is now, then plugs it into the agent (R12, R15). */
  async function copy(id: string, fromHand: boolean) {
    if (!credential || !profile) return;
    const handoff = fill(id);
    if (!handoff) throw new Error("That handoff is no longer in the folder.");
    setSending(true);
    // The context the test starts with (R1). It never blocks or fails the copy (KTD8).
    const capturedAt = new Date().toISOString();
    const reading = storage.readContext(profile.repo, profile.harness).then(
      (r): TestContext => ({ ...r, capturedAt }),
      () => undefined,
    );
    try {
      await writeText(handoff.text);
    } catch (e) {
      setSending(false);
      throw e;
    }
    // Only now does the box print and the agent take the card in.
    setCopied({ ...handoff, profileSlug: profile.slug, key: credentialKey(credential), fromHand });
    const context = await reading;
    add({
      profileSlug: profile.slug,
      credentialKey: credentialKey(credential),
      copiedAt: new Date().toISOString(),
      assignmentVersion: version ?? (await assignmentVersion(credential.task, credential.rubric)),
      setup: { harness: profile.harness, model: profile.model, effort: profile.effort },
      ...(context ? { context } : {}),
      handoff,
    });
  }

  /**
   * The handoff that ran (R13): the plug's, as copied. A plug saved before handoffs ran the
   * built-in prompt and records none (R14). A plug lost from storage falls back to what this
   * visit copied, or to the badge default filled now when the deck resumed past the box.
   */
  function ran(): Copied | undefined {
    if (waiting) return waiting.handoff;
    return here ? { id: here.id, text: here.text } : fill(def) ?? undefined;
  }

  /** Records the verdict, captured when the save starts, with the reading in hand (R13). */
  async function record(verdict: AssessmentResult) {
    if (!state || !credential || !profile) return;
    const handoff = ran();
    // An ask still in flight is dropped: the result saves without it (KTD11).
    const jevReading = shown ? savedReading(shown, verdict) : undefined;
    dropAsk();
    setRecording(true);
    try {
      const next = await recordAssessment(storage, state, {
        profileSlug: profile.slug,
        collectionSlug: credential.collectionSlug,
        credentialSlug: credential.slug,
        result: verdict,
        note: "",
        handBack: reply,
        ...(waiting?.context ? { context: waiting.context } : {}),
        ...(handoff ? { handoff } : {}),
        ...(jevReading ? { jev: jevReading } : {}),
      });
      // The plug comes out only once the result is written.
      remove(profile.slug, credentialKey(credential));
      apply(next);
      const plugId = handoff?.id ?? SKELETON_ID;
      setOutcome(verdict === "met" ? { kind: "met", plugId } : { kind: "not-yet", plugId });
    } finally {
      setRecording(false);
    }
  }

  /** Forgets any ask in flight, so its answer or failure lands nowhere. */
  function dropAsk() {
    askGen.current++;
    inFlight.current = false;
    setAsking(false);
  }

  /**
   * A changed reply drops the reading and any ask about the old one (KTD11). A change that
   * is not the app's own write also ends the cleanup's offers and any cleanup in flight (KTD18).
   */
  function editReply(next: string) {
    setReply(next);
    if (next !== reply && (held || inFlight.current)) {
      dropAsk();
      setHeld(null);
    }
    if (!writing.current && uneditedNow.current && next !== uneditedNow.current.markdown) {
      markUnedited(null);
      dropCleanup();
    }
  }

  function markUnedited(next: Unedited | null) {
    uneditedNow.current = next;
    setUnedited(next);
  }

  /** Forgets any cleanup in flight, so its answer or failure lands nowhere. */
  function dropCleanup() {
    cleanGen.current++;
    cleaningNow.current = false;
    setCleaning(false);
  }

  /** A paste into the reply box, with the fixes in: the reply is now what it produced (KTD18). */
  function onPaste(paste: PastePayload) {
    dropCleanup();
    setPasted({ raw: paste.raw, fixed: paste.fixed, cleanable: paste.terminal && paste.candidates && paste.whole });
    markUnedited({ markdown: paste.markdown, by: "paste" });
  }

  /** Writes text into the reply box the way a paste would, as the app's own write (KTD18). */
  function writeReply(text: string, by: Unedited["by"]) {
    const box = replyBox.current;
    if (!box) return;
    writing.current = true;
    let markdown: string;
    try {
      markdown = box.replaceAsPaste(text);
    } finally {
      writing.current = false;
    }
    markUnedited({ markdown, by });
  }

  /**
   * Asks Jev which of the paste's line breaks are a terminal's wraps and joins those (KTD17).
   * All or nothing, and only into the box it was asked from, while the reply is still the
   * text it was asked about.
   */
  async function cleanUp() {
    const base = uneditedNow.current;
    if (!pasted || !base || cleaningNow.current) return;
    const asked: Unedited = { markdown: base.markdown, by: base.by };
    markUnedited(asked);
    const gen = ++cleanGen.current;
    const current = () => gen === cleanGen.current && uneditedNow.current === asked;
    cleaningNow.current = true;
    setCleaning(true);
    try {
      const joined = await cleanUpLineBreaks(pasted.fixed, jev.ask, { cancelled: () => !current() });
      if (!joined || !current() || !replyBox.current) return;
      if (joined.joined === 0) markUnedited({ ...asked, note: { line: "Nothing to join", failed: false, retry: false } });
      else writeReply(joined.text, "cleanup");
    } catch (e) {
      if (current()) markUnedited({ ...asked, note: { ...jevFailure(e), failed: true } });
    } finally {
      if (gen === cleanGen.current) {
        cleaningNow.current = false;
        setCleaning(false);
      }
    }
  }

  /** Puts the paste back as it first came into the box, undoing only Jev's joins (R21). */
  function putBack() {
    if (pasted) writeReply(pasted.raw, "putBack");
  }

  function choose(v: AssessmentResult) {
    verdictNow.current = v;
    setVerdict(v);
  }

  /** Asks Jev about this reply once; the same inputs keep the reading in hand (KTD11). */
  async function askJev() {
    if (!request || version === null || inFlight.current || shown) return;
    const gen = ++askGen.current;
    inFlight.current = true;
    setAsking(true);
    setJevTrouble(null);
    const asked = { round, reply, assignmentVersion: version, askedAt: new Date().toISOString() };
    try {
      const parts = readingParts(request.state.rubric_points, await jev.ask(request));
      if (gen !== askGen.current) return;
      // An answer that isn't a full reading fails like any other ask.
      if (!parts) throw new JevError("other");
      setHeld({ ...asked, parts, verdictWhenSeen: verdictNow.current });
    } catch (e) {
      if (gen === askGen.current) setJevTrouble({ round, ...jevFailure(e) });
    } finally {
      if (gen === askGen.current) {
        inFlight.current = false;
        setAsking(false);
      }
    }
  }

  /** Copies the plugged handoff again, refilled from the badge as it is now (KTD11). */
  async function copyAgain() {
    setCopyError(null);
    const id = waiting?.handoff?.id ?? SKELETON_ID;
    try {
      await copy(templateOf(id) === null ? def : id, false);
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
    setCopied(null);
    setPicked(null);
    // The next round decides Jev afresh, with no pick, no reading and nothing in flight.
    dropAsk();
    setDecision(null);
    setVerdict(null);
    verdictNow.current = null;
    setHeld(null);
    setJevTrouble(null);
    // And no paste to clean up or put back.
    dropCleanup();
    setPasted(null);
    markUnedited(null);
    setRound((r) => r + 1);
  }

  const collection = credential ? collectionOf(credential) : undefined;
  const agentKeys = matrix && profile ? machineKeys(matrix, profile.slug) : [];

  /** The agent's machine, with a handoff card in its slot going in, standing or ejecting. */
  const agentMachine = (
    screen: ScreenState,
    { phase, seated, plugged = null, width = 280 }: { phase?: keyof typeof PHASE_CLASS; seated?: string; plugged?: { label?: string } | null; width?: number } = {},
  ) =>
    profile ? (
      <Machine
        setup={profile}
        keys={agentKeys}
        page={seated ? pageOf(agentKeys, seated) : 0}
        seated={seated}
        screen={screen}
        plugged={plugged}
        headroom
        width={width}
        className={phase && PHASE_CLASS[phase]}
      />
    ) : null;

  const stage = (screen: ScreenState, opts: Parameters<typeof agentMachine>[1] = {}) => <div className="test-stage">{agentMachine(screen, opts)}</div>;

  /**
   * The badge in the box beside the agent. With `fed`, the handoff just copied, the box
   * prints that card and the agent takes it in; without, the box shows the choice.
   */
  const boxStage = (screen: ScreenState, fed: Copied | null = null) =>
    profile && credential && collection ? (
      <div className="test-stage test-stage-handoff">
        <HandoffBox
          badge={{ collection, credential }}
          keys={keys}
          lit={fed ? fed.id : lit}
          ask={fed ? null : ask}
          screen={fed ? fed.text : lit ? fill(lit)?.text ?? "" : ""}
          width={250}
          className={fed ? "cast-printing" : undefined}
        />
        {agentMachine(screen, fed ? { phase: "feeding", plugged: { label: labelOf(fed.id) }, width: 230 } : { width: 230 })}
      </div>
    ) : null;

  if (outcome.kind === "met" && credential && profile) {
    return (
      <section className="deck" aria-label="Test an agent">
        <div className="deck-card landing" data-testid="landing">
          <h2 tabIndex={-1} ref={focusOnMount}>
            {profile.name} holds it
          </h2>
          {stage({ kind: "idle" }, { phase: "ejecting", seated: credentialKey(credential), plugged: { label: labelOf(outcome.plugId) } })}
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
    const heldUp = props.returnTo && state.credentials.find((c) => credentialKey(c) === props.returnTo?.credentialKey);
    return (
      <section className="deck" aria-label="Test an agent">
        <div className="deck-card">
          <h2 tabIndex={-1} ref={focusOnMount}>
            Not yet
          </h2>
          {stage({ kind: "idle" }, { phase: "ejecting", plugged: { label: labelOf(outcome.plugId) } })}
          <p className="muted">{profile.name} does not hold it</p>
          <div className="deck-actions">
            {props.returnTo ? (
              <>
                <button type="button" className="ghost" onClick={home}>
                  Home
                </button>
                <button type="button" className="primary" onClick={leave}>
                  {heldUp ? `Hand over ${heldUp.name}` : "Back to the test"}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="ghost" onClick={home}>
                  Done
                </button>
                <button type="button" className="primary" onClick={tryAnother}>
                  Try another agent
                </button>
              </>
            )}
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

  // The plug guard (R18, KTD8). A plug on this badge skips the box and opens at "What came
  // back"; a plug on another badge replaces the box with pulling it first.
  const holder = profile && credential && !waiting ? plugFor(livePlugs(pending, state), profile.slug) : undefined;
  if (holder && profile) {
    const held = state.credentials.find((c) => credentialKey(c) === holder.credentialKey);
    const heldLabel = held ? (handoffLabel(state, holder.credentialKey, holder.handoff?.id) ?? undefined) : undefined;
    beats.push({
      id: "pull-first",
      title: "Pull that handoff first",
      forward: "Pull it",
      onForward: () =>
        navigate({
          view: "deck",
          deck: "test",
          profileSlug: profile.slug,
          credentialKey: holder.credentialKey,
          resume: true,
          returnTo: { profileSlug: profile.slug, credentialKey: key, ...(props.handoffId ? { handoffId: props.handoffId } : {}) },
        }),
      body: (
        <>
          {stage({ kind: "waiting" }, { plugged: { label: heldLabel } })}
          <p className="muted">
            {profile.name} holds the {held?.name ?? "other"} handoff
          </p>
        </>
      ),
    });
  } else if (!waiting || here?.fromHand) {
    const noTask = !!credential && credential.task.trim() === "";
    const keyName = (k: HandoffKey) =>
      ask?.winner === k.id ? `${k.label} · this agent's winner` : ask?.default === k.id ? `${k.label} · badge default` : !ask && k.id === def ? `${k.label} · default` : k.label;
    const editPick: TestPick = { ...(profileSlug ? { profileSlug } : {}), ...(key ? { credentialKey: key } : {}), ...(lit ? { handoffId: lit } : {}) };
    beats.push({
      id: "hand",
      title: "Hand it over",
      forward: "Copy",
      valid: !!credential && !!profile && !noTask && lit !== null,
      settled: "Copied",
      onForward: () => (lit ? copy(lit, true) : undefined),
      body: noTask ? (
        <p className="muted">This badge has no task yet</p>
      ) : (
        <>
          {boxStage({ kind: sending ? "sending" : "idle" })}
          <ul className="handoff-keys" aria-label="Handoffs">
            {keys.map((k) => (
              <li key={k.id}>
                <button
                  type="button"
                  className="handoff-key"
                  aria-pressed={k.id === lit}
                  onClick={() => profileSlug && key && setPicked({ profileSlug, key, id: k.id })}
                >
                  {keyName(k)}
                </button>
              </li>
            ))}
          </ul>
          <p className="muted">{ask && lit === null ? "Pick one to copy" : `Copy the handoff, paste it into ${profile?.name ?? "the agent"}, and bring back what it says`}</p>
          {key && (
            <p className="helper">
              <button type="button" className="link" onClick={() => navigate({ view: "deck", deck: "handoffs", credentialKey: key, returnTo: editPick })}>
                Edit handoffs
              </button>
            </p>
          )}
        </>
      ),
    });
  }

  const stale = staleReason(waiting, version, profile);
  const plugId = waiting ? waiting.handoff?.id ?? SKELETON_ID : here?.id;
  const replyScreenState: ScreenState = sending ? { kind: "sending" } : reply.trim() ? replyScreen(reply) : { kind: "waiting" };
  const replyStage = here ? boxStage(replyScreenState, here) : stage(replyScreenState, { plugged: plugId ? { label: labelOf(plugId) } : null });
  // The cleanup's offers (KTD18): clean up while the reply is still what a paste or a
  // put-back wrote, put back while it is still what the cleanup wrote.
  const untouched = unedited !== null && unedited.markdown === reply ? unedited : null;
  const note = untouched?.note;
  const offerCleanup = jev.usable && !!pasted?.cleanable && (untouched?.by === "paste" || untouched?.by === "putBack") && (note?.retry ?? true);
  const offerPutBack = untouched?.by === "cleanup" && pasted !== null;
  const cleanupPart =
    offerCleanup || offerPutBack || note ? (
      <>
        {note?.failed && <p className="deck-error reply-cleanup-error">{note.line}</p>}
        {/* A failure that can't be retried stands alone. */}
        {(offerCleanup || offerPutBack || !note?.failed) && (
          <p className="helper">
            {offerCleanup && pasteFits && (
              <button type="button" className="link" disabled={cleaning} onClick={() => void cleanUp()}>
                {cleaning ? "Cleaning up…" : "Clean up with Jev"}
              </button>
            )}
            {offerPutBack && (
              <button type="button" className="link" onClick={putBack}>
                Put back the paste
              </button>
            )}
            <span className="helper-status" role="status">
              {offerCleanup && !pasteFits ? "This reply is too long for Jev" : note && !note.failed ? note.line : ""}
            </span>
          </p>
        )}
      </>
    ) : null;
  beats.push({
    id: "reply",
    title: "What came back",
    forward: stale ? undefined : "Next",
    // A waiting test is checked for a changed task before its reply can be recorded, and
    // a cleanup in flight is waited for.
    valid: reply.trim() !== "" && !(waiting && version === null) && !cleaning,
    // The reply box takes the window and the first focus; a stale test asks for Copy again on a page.
    pane: !stale,
    focusBody: !stale,
    body: stale ? (
      <>
        {replyStage}
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
        <PullLink onPull={pull} />
      </>
    ) : (
      <>
        <div className="test-strip">{replyStage}</div>
        <RichText ref={replyBox} aria-label="Reply" value={reply} onChange={editReply} placeholder="Paste the reply" cleanPaste onPaste={onPaste} />
        <OnLeave run={dropCleanup} />
        {cleanupPart}
        {waiting && <PullLink onPull={pull} />}
        {cleaning && (
          <p className="helper-status reply-wait" role="status">
            Waiting for Jev
          </p>
        )}
      </>
    ),
  });

  const rubric = credential?.rubric.trim() ?? "";
  // The round's Jev decision, or what it would be if the judge pane showed now (KTD10).
  const live = { offered: jev.usable && rubric !== "" && fits, tooLong: jev.usable && rubric !== "" && !fits };
  const decided = decision?.round === round ? decision : null;
  const jevRound = (decided ?? live).offered;
  const decide = () => setDecision((d) => (d?.round === round ? d : { round, ...live }));
  const trouble = jevTrouble?.round === round ? jevTrouble : null;
  const tooLong = live.tooLong && (jevRound || !!decided?.tooLong);
  const canAsk = jevRound && live.offered && version !== null && !shown && (trouble?.retry ?? true);
  const jevPart =
    jevRound || tooLong ? (
      <div className="meet-jev" aria-live="polite">
        {tooLong && <p className="muted">This reply is too long for Jev</p>}
        {trouble && <p className="deck-error">{trouble.line}</p>}
        {(canAsk || asking) && (
          <p className="helper">
            <button type="button" className="link" disabled={asking || recording} onClick={() => void askJev()}>
              {asking ? "Asking Jev…" : verdict ? "Check with Jev" : "Ask Jev"}
            </button>
          </p>
        )}
        {shown && <JevReadingPanel reading={shown.parts} />}
      </div>
    ) : null;
  beats.push({
    id: "meet",
    title: "Did it meet it",
    pane: true,
    // In a Jev round the pick waits for Save, so the user can check with Jev first (R8, R9).
    ...(jevRound ? { forward: "Save", valid: verdict !== null } : {}),
    body: ({ advance }) => (
      <div className={rubric ? "meet meet-with-rubric" : "meet"}>
        {!decided && <OnShow run={decide} />}
        <StoredSwitch className="meet-stored" asStored={asStored} onToggle={() => setAsStored((s) => !s)} />
        <div className="meet-texts">
          {rubric && (
            <div className={shown || trouble || tooLong ? "meet-text meet-text-rubric meet-text-jev" : "meet-text meet-text-rubric"}>
              <span className="meet-text-head" aria-hidden="true">
                Rubric
              </span>
              <RichView aria-label="Rubric" value={rubric} stored={asStored} />
              {jevPart}
            </div>
          )}
          <div className="meet-text">
            <span className="meet-text-head" aria-hidden="true">
              Reply
            </span>
            <RichView aria-label="Reply" value={reply} stored={asStored} />
          </div>
        </div>
        <div className="meet-choices">
          {jevRound ? (
            <>
              <button type="button" aria-pressed={verdict === "met"} disabled={recording} onClick={() => choose("met")}>
                Met
              </button>
              <button type="button" aria-pressed={verdict === "not_met"} disabled={recording} onClick={() => choose("not_met")}>
                Not yet
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="primary"
                disabled={recording}
                onClick={() => {
                  pressed.current = "met";
                  advance();
                }}
              >
                Met
              </button>
              <button
                type="button"
                disabled={recording}
                onClick={() => {
                  pressed.current = "not_met";
                  advance();
                }}
              >
                Not yet
              </button>
            </>
          )}
        </div>
      </div>
    ),
  });

  /** Ejects the plug and records nothing (R17). */
  function pull() {
    if (profileSlug && key) remove(profileSlug, key);
    leave();
  }

  // Both sides known from the route: a plug on this badge opens at "What came back",
  // otherwise the deck opens at the box (or at pulling the other plug first).
  const replyAt = beats.findIndex((b) => b.id === "reply");
  const bothKnown = !!props.credentialKey && !!props.profileSlug && round === 0;
  const startAt = waiting && (bothKnown || props.resume) ? replyAt : bothKnown ? replyAt - 1 : 0;

  return (
    <Deck
      key={round}
      label="Test an agent"
      beats={beats}
      startAt={startAt}
      unsaved={reply.trim() !== ""}
      onClose={home}
      onFinish={() => record(jevRound && verdict ? verdict : pressed.current)}
    />
  );
}

/** Runs `run` before the first paint each time it mounts: a decision taken when a card first shows. */
function OnShow({ run }: { run(): void }) {
  useLayoutEffect(run, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Runs `run` when the card it sits on goes away, as going Back does to the reply box. */
function OnLeave({ run }: { run(): void }) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => () => latest.current(), []);
  return null;
}

/** The reading as the result keeps it. One seen after a pick says whether the saved verdict differs (R13). */
function savedReading(held: HeldReading, verdict: AssessmentResult): JevReading {
  const base = { model: JEV_MODEL, assignmentVersion: held.assignmentVersion, askedAt: held.askedAt, overall: held.parts.overall, points: held.parts.points };
  return held.verdictWhenSeen === null
    ? { ...base, seen: "before" }
    : { ...base, seen: "after", verdictWhenSeen: held.verdictWhenSeen, verdictChanged: verdict !== held.verdictWhenSeen };
}

/** Where a key problem is fixed (KTD20). */
const FIX_THE_KEY = "Jev Mode in the top bar, on home";

/**
 * One line for a failed ask, and whether asking again can help (KTD20). Nothing from the
 * error's own text: "other" carries at most its status number. A key problem, Jev Mode off
 * or a reply too long can't succeed on a retry, so those take the ask away for the round.
 */
export function jevFailure(e: unknown): { line: string; retry: boolean } {
  const error = toJevError(e);
  switch (error.kind) {
    case "keyRefused":
      return { line: `TypeSafe refused the key. Change it in ${FIX_THE_KEY}.`, retry: false };
    case "keyMissing":
      return { line: `Jev has no key. Add one in ${FIX_THE_KEY}.`, retry: false };
    case "invalidKey":
      return { line: `The key doesn't look right. Change it in ${FIX_THE_KEY}.`, retry: false };
    case "off":
      return { line: `Jev Mode is off. Turn it on in ${FIX_THE_KEY}.`, retry: false };
    case "tooLong":
      return { line: "This reply is too long for Jev.", retry: false };
    case "rateLimited":
      return { line: "Jev has had too many asks. Try again in a moment.", retry: true };
    case "overloaded":
      return { line: "Jev is overloaded. Try again shortly.", retry: true };
    case "unreachable":
      return { line: "Jev couldn't be reached.", retry: true };
    case "keychain":
      return { line: "The keychain didn't give up the key.", retry: true };
    case "settings":
      return { line: "Jev Mode's settings couldn't be read.", retry: true };
    case "other":
      return { line: error.status === null ? "Jev couldn't answer." : `Jev couldn't answer (${error.status}).`, retry: true };
  }
}

/** The motion for each phase of the test: the handoff card going in, or ejecting. */
const PHASE_CLASS = { feeding: "cast-feeding", ejecting: "cast-ejecting" } as const;

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

function PullLink({ onPull }: { onPull(): void }) {
  return (
    <p className="helper">
      <button type="button" className="link" onClick={onPull}>
        Pull without a result
      </button>
    </p>
  );
}
