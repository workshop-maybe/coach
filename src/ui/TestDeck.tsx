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
//
// The screen after a Met waits for the user (go-to R5, R6, KTD6). It holds the stem of the
// result it just recorded and resolves the agent, the badge and that result on every
// render. While the result is still there and Met, its one forward action makes or keeps
// the agent as the badge's go-to, then leaves; the quiet back and Escape leave with no mark.
//
// "Hold to compare" sits beside Met and Not yet (hold-and-compare R1-R3, KTD9): it saves the
// reply with no verdict, through the deck's finish as they do, and frees the agent. The
// screen after it says how many replies to this handoff are held, and "Test another agent"
// starts this deck over in place at "Who takes it" with the handoff that ran carried to
// the box, through the doors out of that card and back. "Try another agent" after Not yet
// does the same. In a Jev round it is a third choice that Save holds; a reading in hand
// goes with the held reply, seen before any verdict.
//
// Growing context (growing context R1-R8, R11, KTD4, KTD6, KTD7, KTD11). A second opinion
// also sends the badge's learning targets and the openings of the user's own judged replies
// on the badge, ranked once per folder snapshot, badge and assignment version and fitted to
// Jev's budget per reply; a muted line under the ask says how many go. A reading is frozen
// with the cut-off pair for the model that answered, so the judge pane, the reason step and
// the saved reading all read it the same way, and its track record shows only once Met or
// Not yet is picked. The choice is one piece of state in both rounds, and the beats follow
// from it: after Not yet on a rubric with points, an optional step to tap the points the
// reply missed; after a verdict that opposes the reading's overall call, an optional line
// asking what Jev missed, saved as the result's note. Hold adds neither. A change of choice
// clears both drafts, the save re-derives both from the choice as it stands, and leaving
// the judge card forward drops any ask in flight, so no reading lands on a later card.
//
// The reply is a list of items (U4 of docs/plans/2026-10-07-0620-feat-reply-artifacts-plan.md,
// R1-R4, R7, R9, KTD7). "What came back" builds it in ReplyItemsEditor, which opens as one
// empty text box so a paste lands as before, and Next goes once the reply has something in it
// and no copy is in flight. The judge pane shows the items as the stack every view uses, the
// record and the hold save them with blank text items dropped, and a change of agent or badge
// carries their files to the new folder. The paste cleanup belongs to the text item the last
// paste went into: it cleans that item, Put back restores it, an edit to it ends both offers,
// and removing it does too.
//
// Jev reads the reply as it will save (U6, KTD8, `jevReply`): its text, the texts of its
// Markdown and plain-text files, read ahead through useItemTexts, and a line for each other
// item. Ask Jev waits, as it waits for the version, while a file text the reply or a chosen
// earlier reply needs is still loading, and "too long for Jev" counts all of it (R15).
//
// Compare shares pieces of this deck (jev-in-compare U1, KTD14): the two steps' bodies and
// words live in `verdictSteps.tsx`, the reading as it is saved in `domain/savedReading.ts`,
// and the failed-ask line in `jevFailure.ts`, re-exported here for this deck's tests.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { SKELETON_ID, defaultHandoff, fillHandoff, handoffsFor, skeletonOf, winnerFor } from "../domain/handoffs";
import { assignmentVersion } from "../domain/hash";
import { sameSetup } from "../domain/matrix";
import { calibrationOf, isOverrule, type Calibration } from "../domain/calls";
import { fitSecondOpinion } from "../domain/jevBudget";
import { examplesFor, rankExamples } from "../domain/jevExamples";
import { isTextFileRef, jevReply, pendingTexts, type RefTexts } from "../domain/jevReply";
import { answeringModel } from "../domain/jevRequest";
import { assessmentDir, credentialsDir } from "../domain/folder";
import { cleanUpLineBreaks, lineBreakBatches } from "../domain/lineBreaks";
import { goToOf, resultOf } from "../domain/goTo";
import { heldOn, runIdOf } from "../domain/handoffResults";
import { holdReply, markGoTo, recordAssessment } from "../domain/operations";
import { hasContent, normalizeReply, replyItems, replyKey, textOf } from "../domain/replyItems";
import { reasonLine } from "../domain/reasonLine";
import { readingBeforeVerdict, savedReading } from "../domain/savedReading";
import { readingParts, rubricParts, tappedPoints, type JevReadingParts } from "../domain/secondOpinion";
import {
  credentialKey,
  type AgentProfile,
  type AssessmentResult,
  type Credential,
  type HandoffTemplate,
  type ReplyItem,
  type Slug,
  type TestContext,
} from "../domain/types";
import { JevError } from "../jev/jev";
import { Cartridge } from "../cast/Cartridge";
import { HandoffBox } from "../cast/HandoffBox";
import { Machine } from "../cast/Machine";
import { Outline } from "../cast/Outline";
import { handoffKeys, machineKeys, openingChoice, replyItemsScreen, trigPages, type HandoffKey, type ScreenState } from "../cast/mappings";
import { Deck, type Beat } from "./Deck";
import { backToTest } from "./HandoffDecks";
import { handoffLabel } from "./format";
import { imageSource } from "./imageSource";
import { useItemTexts } from "./useItemTexts";
import { useJev } from "./jevContext";
import { jevFailure } from "./jevFailure";
import { JevReadingPanel } from "./JevReading";
import { useNav } from "./nav";
import { livePlugs, plugFor, usePendingTests, type PendingTest } from "./pendingTests";
import type { PastePayload } from "./RichText";
import { ReplyItemsEditor, replyEntry, type ReplyEntry, type ReplyItemsEditorHandle } from "./ReplyItemsEditor";
import { ReplyStack } from "./ReplyStack";
import { RichView } from "./RichView";
import type { TestPick } from "./routes";
import { Missing, StoredSwitch, focusOnMount, useEscape } from "./shared";
import { describeError, useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";
import { useAssignmentVersion } from "./useAssignmentVersion";
import { useRichImages } from "./useRichImages";
import { MISSED_POINTS_TITLE, MissedPointsList, REASON_TITLE, ReasonBody } from "./verdictSteps";

export { jevFailure };

/** How long the dots run across the screen after Copy before the cursor waits. */
export const SENDING_MS = 700;

/** Said beside Ask Jev when the reply holds a picture, video, PDF, other file or link. */
export const JEV_EYES_NOTE = "Jev reads the words. The pictures, videos, files and links are here for your own eyes.";

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

/** What the judge card's choice records: a verdict, or the reply held without one (hold-and-compare R1). */
type Choice = AssessmentResult | "hold";

/** How the round ended. A Met keeps the file stem of the result it recorded, so a mark names exactly that result. */
type Outcome = { kind: "open" } | { kind: "met"; plugId: string; fileStem: string } | { kind: "not-yet"; plugId: string } | { kind: "held"; plugId: string };

/** The reply as the app last wrote it (KTD18): by a paste, a put-back or Jev's cleanup. */
interface Unedited {
  markdown: string;
  by: "paste" | "putBack" | "cleanup";
  /** A cleanup asked about this text that changed nothing: nothing to join, or a failure and whether asking again can help. */
  note?: { line: string; failed: boolean; retry: boolean };
}

/** A reply as the beat opens it: one empty text item (KTD7). */
const freshReply = (): ReplyEntry[] => [replyEntry({ kind: "text", text: "" })];

/** Jev's reading in hand, with what it was asked about (KTD11). */
export interface ReadingInHand {
  round: number;
  /** The reply it was asked about, as `replyKey` of its items. */
  reply: string;
  assignmentVersion: string;
  askedAt: string;
  parts: JevReadingParts;
  /** The pick when the reading arrived, or null when it came before one (R13). */
  verdictWhenSeen: AssessmentResult | null;
  /** The model that answered (growing context KTD3). */
  model: string;
  /** The badge's calibration for that model, frozen when the reading arrived (growing context KTD8). */
  calibration: Calibration;
  /** How many distinct earlier replies the request quoted (growing context KTD6). */
  examplesSent: number;
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
  // The reply's items as they are built, each with an id that outlives its place (KTD7).
  const [entries, setEntries] = useState<ReplyEntry[]>(freshReply);
  // The judge card shows the reply and the rubric as stored rather than rendered (R12).
  const [asStored, setAsStored] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "open" });
  // The judge card's choice (growing context KTD4): the press outside a Jev round, or the pick
  // a Jev round's Save records (KTD10). The beats after the judge card follow from it. The ref
  // is the verdict picked when an answer lands: Hold is not a verdict, so a reading that lands
  // on it was seen before any verdict.
  const [chosen, setChosen] = useState<Choice | null>(null);
  const verdictNow = useRef<AssessmentResult | null>(null);
  // The drafts of the steps after the judge card: the points tapped as missed, by their text,
  // and the reason line. Both are cleared on a change of choice and re-derived at the save.
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const [reason, setReason] = useState("");
  // The handoff that ran before "Test another agent", lit for the next agent on the same badge (hold-and-compare KTD9).
  const [carried, setCarried] = useState<{ key: string; id: string } | null>(null);
  const [recording, setRecording] = useState(false);
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
  const [inHand, setInHand] = useState<ReadingInHand | null>(null);
  const [asking, setAsking] = useState(false);
  // The last ask's failure. One that can't be retried takes the ask away for the round (KTD20).
  const [jevTrouble, setJevTrouble] = useState<{ round: number; line: string; retry: boolean } | null>(null);
  // The request generation: an answer lands only while its ask is still the latest (KTD11).
  const askGen = useRef(0);
  const inFlight = useRef(false);
  // Jev's cleanup of the paste (KTD18). The ref is the reply editor's handle while it is mounted.
  const replyBox = useRef<ReplyItemsEditorHandle>(null);
  // The last paste into a text item: as it came, as the fixes left it, whether it can be
  // cleaned up, and the item it went into (KTD7).
  const [pasted, setPasted] = useState<{ raw: string; fixed: string; cleanable: boolean; into: number } | null>(null);
  // The item that paste went into, current within the paste and change handlers before a render.
  const pastedInto = useRef<number | null>(null);
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
  // The go-to mark after a Met (KTD6). The ref is set before the first await, so a second
  // press, or an Escape while the mark saves, does nothing.
  const [marking, setMarking] = useState(false);
  const markingNow = useRef(false);
  const [markError, setMarkError] = useState<string | null>(null);
  // Nothing navigates once the deck has gone. Set in the effect, so StrictMode's second mount sets it again.
  const mounted = useRef(false);

  const profile = state?.profiles.find((p) => p.slug === profileSlug);
  const credential = state?.credentials.find((c) => credentialKey(c) === key);
  // The credential's current assignment version, to tell whether a copied prompt is stale.
  const version = useAssignmentVersion(credential);
  const collectionOf = (c: Credential) => state?.collections.find((x) => x.slug === c.collectionSlug);
  const waiting = pending.find((p) => p.profileSlug === profileSlug && p.credentialKey === key);
  const items = useMemo(() => entries.map((e) => e.item), [entries]);
  // The reply's text items joined, whose pictures and videos the folder keeps, and its identity.
  const reply = useMemo(() => textOf(items), [items]);
  // A pasted image and an added item go in the folder the result will be recorded in. Picking
  // another agent or badge moves the folder, and the files the reply still names go along (R10).
  const replyDir = profile && credential ? assessmentDir(profile.slug, credential.collectionSlug, credential.slug) : null;
  const replyImages = useRichImages(replyDir, reply, items);
  // The result folder's files, for the reply's editor and its stack (`imageSource` keeps one per folder).
  const replySource = replyDir ? imageSource(storage, replyDir) : null;
  const rubricImages = credential ? imageSource(storage, credentialsDir(credential.collectionSlug)) : undefined;
  // The reply as it will save, blank text items dropped, so the judge sees what is recorded and Jev reads it.
  const judged = useMemo(() => asSaved(items), [items]);
  // A reading belongs to the reply as it saves, so a blank text item never drops it.
  const replyId = useMemo(() => replyKey(judged), [judged]);
  // File texts read ahead for Jev (KTD8). A file that couldn't be read is tried again once
  // the copies in flight land, and on each folder reload.
  const itemTexts = useItemTexts(storage, replyImages.busy ? null : state);
  const replyTexts = useMemo<RefTexts>(() => (replyDir ? (ref) => itemTexts(`${replyDir}/${ref}`) : () => null), [replyDir, itemTexts]);

  // The badge's results ranked as example sources, once per folder snapshot, badge and
  // assignment version (growing context KTD10). Null while the version is loading.
  const ranked = useMemo(() => (state && key && version !== null ? rankExamples(state, key, version) : null), [state, key, version]);
  // The second opinion this reply would ask for, with the targets and as many examples as fit
  // Jev's budget (KTD19, growing context KTD10). Null when the reply alone is too long, which
  // is what decides "too long for Jev" and whether the round offers Jev, examples or not.
  // The reply goes as Jev reads it (KTD8), and `textsWait` holds while a file text it or a
  // chosen example needs is still loading. Files are read only while Jev is usable.
  const { fitted, textsWait } = useMemo(() => {
    if (!credential || !jev.usable || credential.rubric.trim() === "") return { fitted: null, textsWait: false };
    // What is still loading: the reply's refs, then the examples' data-root paths. Only the count is read.
    const loading: string[] = pendingTexts(judged, replyTexts);
    const read = jevReply(judged, replyTexts);
    const examples = ranked ? examplesFor(ranked, read, itemTexts, loading) : [];
    const fit = fitSecondOpinion({ task: credential.task, rubric: credential.rubric, reply: read, learningTargets: credential.learningTargets }, examples);
    return { fitted: fit, textsWait: loading.length > 0 };
  }, [credential?.task, credential?.rubric, credential?.learningTargets, judged, replyTexts, itemTexts, jev.usable, ranked]); // eslint-disable-line react-hooks/exhaustive-deps
  const fits = fitted !== null;
  // The badge's rubric points, for the missed-points step, parsed once per rubric.
  const points = useMemo(() => (credential ? rubricParts(credential.rubric).points : []), [credential?.rubric]); // eslint-disable-line react-hooks/exhaustive-deps
  // Whether Jev can be asked about the paste at all: not when the paste alone is over Jev's budget (KTD19).
  const pasteFits = useMemo(() => !!pasted?.cleanable && lineBreakBatches(pasted.fixed) !== null, [pasted]);
  // The reading counts only for the round, reply and assignment version it was asked about.
  const shown = inHand && inHand.round === round && inHand.reply === replyId && inHand.assignmentVersion === version ? inHand : null;

  // Leaving the deck drops any ask or cleanup in flight.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      askGen.current++;
      cleanGen.current++;
    };
  }, []);

  const home = () => navigate({ view: "home" });
  // Where a finished test goes: home, or back to the test this pull held up (AE5).
  const leave = () => navigate(props.returnTo ? backToTest(props.returnTo) : { view: "home" });

  // On the screen after a Met, Escape does what its quiet action does, and nothing while a
  // mark saves. On the screen after a hold, its quiet action goes home either way. During
  // the deck round Deck's own Escape is mounted and this one stays out.
  useEscape(() => {
    if (outcome.kind === "held") return home();
    if (outcome.kind !== "met" || markingNow.current) return;
    if (profile && credential) leave();
    else home();
  });

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
  // The handoff that ran before "Test another agent" outranks the route's and the badge's (KTD9).
  const carry = carried && carried.key === key && has(carried.id) ? carried.id : null;
  const lit = pick ?? carry ?? back ?? choice.lit;
  const ask = choice.ask;
  const here = copied && copied.profileSlug === profileSlug && copied.key === key ? copied : null;

  const templateOf = (id: string): string | null => (id === SKELETON_ID ? skeletonOf(state).text : own.find((h) => h.id === id)?.text ?? null);
  const fill = (id: string): Copied | null => {
    const template = templateOf(id);
    return credential && template !== null ? { id, text: fillHandoff(template, credential) } : null;
  };
  const labelOf = (id: string) => keys.find((k) => k.id === id)?.label;

  // The steps after the judge card (growing context KTD4, KTD11), worked out from the choice
  // and the folder as they are on every render. A tick counts only for a point the rubric
  // still has, in rubric order, so a point a reload removed drops its tick
  // (docs/solutions/runtime-errors/rederive-local-folder-ids-on-every-render.md).
  const missed = tappedPoints(points, ticked);
  const verdictChosen = chosen === "met" || chosen === "not_met" ? chosen : null;
  /** Whether the reading in hand, read with the pair frozen when it arrived, calls the reply against this verdict. Can't call never does. */
  const opposes = (verdict: AssessmentResult) => !!shown && isOverrule({ result: verdict, jev: shown.parts }, shown.calibration.pair);
  const asksMissed = chosen === "not_met" && points.length > 0;
  const asksReason = verdictChosen !== null && opposes(verdictChosen);

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

  /**
   * Records the verdict, captured when the save starts, with the reading in hand (R13) and
   * what the steps after the judge card drafted, each only while its step applies to this
   * verdict (growing context KTD4): the missed points with Not yet, as current rubric points
   * in rubric order, and the reason line while the reading opposes the verdict.
   */
  async function record(verdict: AssessmentResult) {
    if (!state || !credential || !profile) return;
    const handoff = ran();
    // An ask still in flight is dropped: the result saves without it (KTD11).
    const jevReading = shown ? savedReading(shown, verdict) : undefined;
    const missedPoints = verdict === "not_met" ? missed : [];
    const note = opposes(verdict) ? reasonLine(reason) : "";
    dropAsk();
    setRecording(true);
    try {
      // The Met screen names the result by the stem the save wrote.
      const { state: next, fileStem } = await recordAssessment(storage, state, {
        profileSlug: profile.slug,
        collectionSlug: credential.collectionSlug,
        credentialSlug: credential.slug,
        result: verdict,
        note,
        items,
        ...(waiting?.context ? { context: waiting.context } : {}),
        ...(handoff ? { handoff } : {}),
        ...(jevReading ? { jev: jevReading } : {}),
        ...(missedPoints.length > 0 ? { missedPoints } : {}),
      });
      // The plug comes out only once the result is written.
      remove(profile.slug, credentialKey(credential));
      apply(next);
      const plugId = handoff?.id ?? SKELETON_ID;
      setOutcome(verdict === "met" ? { kind: "met", plugId, fileStem } : { kind: "not-yet", plugId });
    } finally {
      setRecording(false);
    }
  }

  /** The judge card's choice, saved: a verdict records a result, Hold to compare holds the reply. */
  function finish(choice: Choice) {
    return choice === "hold" ? hold() : record(choice);
  }

  /**
   * Holds the reply without a verdict (hold-and-compare R1-R3, KTD9): a held reply with the
   * handoff that ran, the plug's context and a reading in hand, which was seen before any
   * verdict. The plug comes out only once the held reply is written.
   */
  async function hold() {
    if (!state || !credential || !profile) return;
    const handoff = ran();
    const jevReading = shown ? readingBeforeVerdict(shown) : undefined;
    dropAsk();
    setRecording(true);
    try {
      const { state: next } = await holdReply(storage, state, {
        profileSlug: profile.slug,
        collectionSlug: credential.collectionSlug,
        credentialSlug: credential.slug,
        items,
        ...(waiting?.context ? { context: waiting.context } : {}),
        ...(handoff ? { handoff } : {}),
        ...(jevReading ? { jev: jevReading } : {}),
      });
      remove(profile.slug, credentialKey(credential));
      apply(next);
      setOutcome({ kind: "held", plugId: handoff?.id ?? SKELETON_ID });
    } finally {
      setRecording(false);
    }
  }

  /** Marks the result just recorded as the agent's go-to for the badge, then leaves (R5, KTD6). */
  async function markIt(fileStem: string) {
    if (!state || !profile || !credential || markingNow.current) return;
    markingNow.current = true;
    setMarking(true);
    setMarkError(null);
    try {
      const next = await markGoTo(storage, state, {
        profileSlug: profile.slug,
        collectionSlug: credential.collectionSlug,
        credentialSlug: credential.slug,
        fileStem,
      });
      // The mark is on disk, so the folder takes it even when the deck has gone.
      apply(next);
      if (mounted.current) leave();
    } catch (e) {
      if (mounted.current) setMarkError(describeError(e));
    } finally {
      markingNow.current = false;
      if (mounted.current) setMarking(false);
    }
  }

  /** Forgets any ask in flight, so its answer or failure lands nowhere. */
  function dropAsk() {
    askGen.current++;
    inFlight.current = false;
    setAsking(false);
  }

  /** The text of the item the last paste went into, or null once it is gone. */
  const pastedText = (list: readonly ReplyEntry[]) => {
    const target = list.find((e) => e.id === pastedInto.current)?.item;
    return target?.kind === "text" ? target.text : null;
  };

  /**
   * A changed reply drops the reading and any ask about the old one (KTD11). A change to the
   * item the last paste went into that is not the app's own write, or its removal, also ends
   * the cleanup's offers and any cleanup in flight (KTD18, KTD7).
   */
  function editReply(next: ReplyEntry[]) {
    setEntries(next);
    if (replyKey(asSaved(next.map((e) => e.item))) !== replyId && (inHand || inFlight.current)) {
      dropAsk();
      setInHand(null);
    }
    if (!writing.current && uneditedNow.current && pastedText(next) !== uneditedNow.current.markdown) {
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

  /** A paste into text item `into`, with the fixes in: that item is now what it produced (KTD18, KTD7). */
  function onPaste(into: number, paste: PastePayload) {
    dropCleanup();
    pastedInto.current = into;
    setPasted({ raw: paste.raw, fixed: paste.fixed, cleanable: paste.terminal && paste.candidates && paste.whole, into });
    markUnedited({ markdown: paste.markdown, by: "paste" });
  }

  /** Writes text into the item the last paste went into, the way a paste would, as the app's own write (KTD18). */
  function writeReply(text: string, by: Unedited["by"]) {
    const box = replyBox.current;
    if (!box || !pasted) return;
    writing.current = true;
    let markdown: string | null;
    try {
      markdown = box.replaceAsPaste(pasted.into, text);
    } finally {
      writing.current = false;
    }
    if (markdown !== null) markUnedited({ markdown, by });
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

  /** The judge card's choice, in either round. A change of choice clears both drafts (growing context KTD4). */
  function choose(v: Choice) {
    verdictNow.current = v === "hold" ? null : v;
    if (v !== chosen) {
      setTicked([]);
      setReason("");
    }
    setChosen(v);
  }

  function toggleMissed(point: string) {
    setTicked((t) => (t.includes(point) ? t.filter((p) => p !== point) : [...t, point]));
  }

  /** Asks Jev about this reply once; the same inputs keep the reading in hand (KTD11). */
  async function askJev() {
    if (!fitted || textsWait || !state || !key || version === null || inFlight.current || shown) return;
    const { request, sources } = fitted;
    const gen = ++askGen.current;
    inFlight.current = true;
    setAsking(true);
    setJevTrouble(null);
    const asked = { round, reply: replyId, assignmentVersion: version, askedAt: new Date().toISOString(), examplesSent: sources.length };
    try {
      const answers = await jev.ask(request);
      const parts = readingParts(request.state.rubric_points, answers, request.state.learning_targets);
      if (gen !== askGen.current) return;
      // An answer that isn't a full reading fails like any other ask.
      if (!parts) throw new JevError("other");
      // The pair for the model that answered, from the folder snapshot the examples came from,
      // frozen with the reading so the judge card, the reason step and the save agree (KTD8).
      const model = answeringModel(answers);
      setInHand({ ...asked, parts, verdictWhenSeen: verdictNow.current, model, calibration: calibrationOf(state, key, model) });
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
    setEntries(freshReply());
    setOutcome({ kind: "open" });
    setSending(false);
    setCopied(null);
    setPicked(null);
    // The next round decides Jev afresh, with no pick, no drafts, no reading and nothing in flight.
    dropAsk();
    setDecision(null);
    setChosen(null);
    verdictNow.current = null;
    setTicked([]);
    setReason("");
    setInHand(null);
    setJevTrouble(null);
    // And no paste to clean up or put back.
    dropCleanup();
    pastedInto.current = null;
    setPasted(null);
    markUnedited(null);
    setCarried(null);
    setRound((r) => r + 1);
  }

  /**
   * The next agent on the same badge and the same handoff (hold-and-compare R3, KTD9): the
   * deck starts over in place, at "Who takes it", with the handoff that ran carried to the box.
   */
  function testAnother(handoffId: string) {
    tryAnother();
    if (key) setCarried({ key, id: handoffId });
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

  // The screen after a Met (KTD6), resolved from the folder on every render: a reload can
  // take the agent, the badge or the recorded result away under it.
  if (outcome.kind === "met") {
    if (!credential || !profile) return <Missing onHome={home} />;
    const k = credentialKey(credential);
    const { fileStem } = outcome;
    const recorded = resultOf(state, profile.slug, k, fileStem)?.result === "met";
    const keep = goToOf(state, k)?.profile.slug === profile.slug;
    const heldUp = props.returnTo && state.credentials.find((c) => credentialKey(c) === props.returnTo?.credentialKey);
    return (
      <section className="deck" aria-label="Test an agent">
        <div className="deck-card landing" data-testid="landing">
          {/* Focus stays on the heading, so an Enter carried over from the Met press cannot make a mark. */}
          <h2 tabIndex={-1} ref={focusOnMount}>
            {profile.name} holds it
          </h2>
          {stage({ kind: "idle" }, { phase: "ejecting", seated: k, plugged: { label: labelOf(outcome.plugId) } })}
          {markError && (
            <p className="deck-error" role="alert">
              {markError}
            </p>
          )}
          <div className="deck-actions">
            <button type="button" className="ghost" disabled={marking} onClick={leave}>
              {props.returnTo ? (heldUp ? `Hand over ${heldUp.name}` : "Back to the test") : "Home"}
            </button>
            {recorded && (
              <button type="button" className="primary" disabled={marking} onClick={() => void markIt(fileStem)}>
                {keep ? `Keep ${profile.name} as the go-to` : `Make ${profile.name} the go-to`}
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  // The screen after a hold (hold-and-compare R3, KTD9), resolved from the folder on every
  // render. It says how many replies to this badge and handoff wait to be compared, and
  // offers the next agent on the same handoff; in a detour it goes back to the held-up test.
  if (outcome.kind === "held") {
    if (!credential || !profile) return <Missing onHome={home} />;
    const { plugId } = outcome;
    const count = heldOn(state, credentialKey(credential)).filter((h) => runIdOf(h) === plugId).length;
    const heldUp = props.returnTo && state.credentials.find((c) => credentialKey(c) === props.returnTo?.credentialKey);
    return (
      <section className="deck" aria-label="Test an agent">
        <div className="deck-card">
          {/* Focus stays on the heading, so an Enter carried over from the hold cannot start the next test. */}
          <h2 tabIndex={-1} ref={focusOnMount}>
            Reply held
          </h2>
          {stage({ kind: "idle" }, { phase: "ejecting", plugged: { label: labelOf(plugId) } })}
          <p className="muted">{count === 1 ? "1 reply held to compare" : `${count} replies held to compare`}</p>
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
                <button type="button" className="primary" onClick={() => testAnother(plugId)}>
                  Test another agent
                </button>
              </>
            )}
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
                <button type="button" className="primary" onClick={() => testAnother(outcome.plugId)}>
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
            <button type="button" className="choice choice-door" onClick={() => navigate({ view: "deck", deck: "agent", returnTo: { credentialKey: key, ...(carry ? { handoffId: carry } : {}) } })}>
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
    const plugBadge = state.credentials.find((c) => credentialKey(c) === holder.credentialKey);
    const plugLabel = plugBadge ? (handoffLabel(state, holder.credentialKey, holder.handoff?.id) ?? undefined) : undefined;
    // The way back lights the handoff carried from the last round, else the route's.
    const backHandoff = carry ?? props.handoffId;
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
          returnTo: { profileSlug: profile.slug, credentialKey: key, ...(backHandoff ? { handoffId: backHandoff } : {}) },
        }),
      body: (
        <>
          {stage({ kind: "waiting" }, { plugged: { label: plugLabel } })}
          <p className="muted">
            {profile.name} holds the {plugBadge?.name ?? "other"} handoff
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
  const replyScreenState: ScreenState = sending ? { kind: "sending" } : hasContent(items) ? replyItemsScreen(items) : { kind: "waiting" };
  const replyStage = here ? boxStage(replyScreenState, here) : stage(replyScreenState, { plugged: plugId ? { label: labelOf(plugId) } : null });
  // The cleanup's offers (KTD18): clean up while the reply is still what a paste or a
  // put-back wrote, put back while it is still what the cleanup wrote.
  const untouched = unedited !== null && unedited.markdown === pastedText(entries) ? unedited : null;
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
    valid: hasContent(items) && !(waiting && version === null) && !cleaning && !replyImages.busy,
    // Leaving while a file is still being copied would drop it from the reply once it lands.
    holdBack: replyImages.busy,
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
        {replySource && (
          <ReplyItemsEditor
            ref={replyBox}
            value={entries}
            onChange={editReply}
            images={replyImages.images}
            source={replySource}
            addItems={replyImages.addItems}
            onPaste={onPaste}
          />
        )}
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
  // The round's Jev decision, or what it would be if the judge pane showed now (KTD10). While
  // file texts load, the reply is not yet known to be too long, so the round offers Jev.
  const live = { offered: jev.usable && rubric !== "" && (fits || textsWait), tooLong: jev.usable && rubric !== "" && !fits && !textsWait };
  const decided = decision?.round === round ? decision : null;
  const jevRound = (decided ?? live).offered;
  const decide = () => setDecision((d) => (d?.round === round ? d : { round, ...live }));
  const trouble = jevTrouble?.round === round ? jevTrouble : null;
  const tooLong = live.tooLong && (jevRound || !!decided?.tooLong);
  // Ask Jev waits while the version or a file text Jev reads is loading (KTD8).
  const canAsk = jevRound && live.offered && version !== null && !textsWait && !shown && (trouble?.retry ?? true);
  // What goes with the ask as it would go now, after the budget's drops (growing context KTD6).
  // Nothing is said while the version or a file text loads, since no ask goes then.
  const quoted = version !== null && !textsWait && fitted ? fitted.sources.length : 0;
  const sendsLine =
    quoted === 0
      ? null
      : (quoted === 1 ? "Also sends 1 earlier reply on this badge" : `Also sends ${quoted} earlier replies on this badge`) + (fitted?.withNotes ? " with your notes" : "");
  // Jev reads words. What it can't see is there for the person to judge (R14).
  const unseen = judged.some((i) => i.kind === "image" || i.kind === "video" || i.kind === "link" || (i.kind === "file" && !isTextFileRef(i.ref)));
  const jevPart =
    jevRound || tooLong ? (
      <div className="meet-jev" aria-live="polite">
        {unseen && <p className="jev-note">{JEV_EYES_NOTE}</p>}
        {tooLong && <p className="muted">This reply is too long for Jev</p>}
        {trouble && <p className="deck-error">{trouble.line}</p>}
        {(canAsk || asking) && (
          <>
            <p className="helper">
              <button type="button" className="link" disabled={asking || recording} onClick={() => void askJev()}>
                {asking ? "Asking Jev…" : verdictChosen ? "Check with Jev" : "Ask Jev"}
              </button>
            </p>
            {sendsLine && <p className="jev-note">{sendsLine}</p>}
          </>
        )}
        {shown && (
          <JevReadingPanel
            reading={shown.parts}
            pair={shown.calibration.pair}
            fitted={shown.calibration.fitted}
            // The track record waits for a verdict, so it can't lead the one being given (KTD7).
            trackRecord={verdictChosen ? shown.calibration.trackRecord : null}
          />
        )}
      </div>
    ) : null;
  // A step follows the judge card: the missed points after Not yet, or the reason line.
  const stepFollows = asksMissed || asksReason;
  beats.push({
    id: "meet",
    title: "Did it meet it",
    pane: true,
    // In a Jev round the pick waits for Save, so the user can check with Jev first (R8, R9).
    ...(jevRound ? { forward: stepFollows ? "Next" : "Save", valid: chosen !== null } : {}),
    // Leaving forward drops any ask in flight, so no reading lands on a later card (KTD4).
    onForward: dropAsk,
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
              <RichView aria-label="Rubric" value={rubric} stored={asStored} images={rubricImages} />
              {jevPart}
            </div>
          )}
          <div className="meet-text">
            <span className="meet-text-head" aria-hidden="true">
              Reply
            </span>
            {replySource && <ReplyStack items={judged} source={replySource} stored={asStored} aria-label="Reply" />}
          </div>
        </div>
        <div className="meet-choices">
          {jevRound ? (
            <>
              <button type="button" aria-pressed={chosen === "met"} disabled={recording} onClick={() => choose("met")}>
                Met
              </button>
              <button type="button" aria-pressed={chosen === "not_met"} disabled={recording} onClick={() => choose("not_met")}>
                Not yet
              </button>
              <button type="button" aria-pressed={chosen === "hold"} disabled={recording} onClick={() => choose("hold")}>
                Hold to compare
              </button>
            </>
          ) : (
            <>
              {/* Each press moves on once its choice has rendered: to the step it adds, or to the save. */}
              <button
                type="button"
                className="primary"
                disabled={recording}
                onClick={() => {
                  choose("met");
                  advance();
                }}
              >
                Met
              </button>
              <button
                type="button"
                disabled={recording}
                onClick={() => {
                  choose("not_met");
                  advance();
                }}
              >
                Not yet
              </button>
              {/* Saves the reply with no verdict, to judge beside other agents' replies (hold-and-compare R1). */}
              <button
                type="button"
                disabled={recording}
                onClick={() => {
                  choose("hold");
                  advance();
                }}
              >
                Hold to compare
              </button>
            </>
          )}
        </div>
      </div>
    ),
  });

  // The points the reply missed (growing context R6): optional, every current rubric point a
  // toggle, nothing pressed at first. Jev's call sits beside each point while a reading is in
  // hand, read with its frozen pair, and never presses anything for the user.
  if (asksMissed) {
    beats.push({
      id: "missed",
      title: MISSED_POINTS_TITLE,
      forward: asksReason ? (missed.length > 0 ? "Next" : "Skip") : "Save",
      body: (
        <MissedPointsList
          points={points}
          readingPoints={shown?.parts.points}
          pair={shown?.calibration.pair}
          picked={missed}
          onToggle={toggleMissed}
          disabled={recording}
        />
      ),
    });
  }

  // Why the verdict went against Jev's call (growing context R7), saved as the result's note.
  // asksReason already needs a verdict; the second test only narrows its type.
  if (asksReason && verdictChosen) {
    beats.push({
      id: "reason",
      title: REASON_TITLE,
      forward: "Save",
      body: <ReasonBody verdict={verdictChosen} value={reason} onChange={setReason} />,
    });
  }

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
      unsaved={hasContent(items)}
      onClose={home}
      onFinish={async () => {
        if (chosen) await finish(chosen);
      }}
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

/** The reply as it saves, blank text items dropped (R4). */
function asSaved(items: ReplyItem[]): ReplyItem[] {
  const kept = normalizeReply(items);
  return kept ? replyItems(kept) : items;
}
