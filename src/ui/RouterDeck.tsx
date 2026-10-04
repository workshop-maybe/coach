// Find an agent for a job (router plan): the job pasted as written, then the badge it is like,
// asked of Jev (R3, R4) or picked from the list (R5), then one card. The card recommends an
// agent with its reasons (R7-R9), or turns a miss into a test: a badge made from the job
// (R12), or a bake-off on the badge nobody holds cleanly (R13). Taking an agent writes one
// routing record (R14) and goes home.
//
// The ask runs in the ask card's body, never in a forward action (KTD11): Deck moves on after
// an onForward whatever happened while it waited, and a card's position is all advance()
// checks. So a generation counter guards it. The ask card's body unmounting (Back, Close,
// "Pick the badge myself") bumps it, a late answer is dropped, and the requests stop.
// Jev's answers are kept with the job and the badges they were about, and the card works out
// its badge and its agent from the folder on every render (KTD4, KTD8), so a reload, a trash
// or a hand edit changes the card and never breaks it. A detour to the cost order or to a
// new badge carries the answers in the route, and comes back without asking again.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { calibrationOf } from "../domain/calls";
import { takeAgentForJob } from "../domain/operations";
import { costPlaces, recommend, type CleanHolder, type Recommendation } from "../domain/recommend";
import { askRoute, jobFirstLine, matchOf, ratingOf, routeBadges, routeBatches, type RouteOutcome } from "../domain/router";
import { toJevError } from "../jev/jev";
import { JEV_MODEL } from "../domain/jevRequest";
import { credentialKey, type Credential, type FolderState, type MatchedBy, type Rating, type Slug } from "../domain/types";
import { Cartridge } from "../cast/Cartridge";
import { Machine } from "../cast/Machine";
import { Outline } from "../cast/Outline";
import { Deck, type Beat } from "./Deck";
import { FLAG_SHORT, formatDate, setupText } from "./format";
import { useJev } from "./jevContext";
import { useNav } from "./nav";
import { RichText } from "./RichText";
import { NONE_OF_THESE, type RouterResume } from "./routes";
import { jevFailure } from "./TestDeck";
import { useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";

/** The one failure line a routing ask words its own way (KTD11): too long names the job. */
const JOB_TOO_LONG = "This job is too long for Jev.";

function routeFailure(e: unknown): string {
  return toJevError(e).kind === "tooLong" ? JOB_TOO_LONG : jevFailure(e).line;
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** What the card is about: its badge, how it was found, the other matches, and Jev's rating. */
interface CardFocus {
  key: string | null;
  matched: MatchedBy;
  alsoLike: string[];
  rating: Rating | null;
  model: string | null;
}

export function RouterDeck({ resume }: { resume?: RouterResume }) {
  const { state } = useFolder();
  if (!state) return null;
  return <Router resume={resume} state={state} />;
}

/** The deck over a loaded folder. `state` is the folder as it is now, read again on every render. */
function Router({ resume, state }: { resume?: RouterResume; state: FolderState }) {
  const { storage, apply } = useFolder();
  const { navigate } = useNav();
  const jev = useJev();
  const matrix = useMatrix(state);
  const [job, setJob] = useState(resume?.job ?? "");
  const [outcome, setOutcome] = useState<RouteOutcome | undefined>(resume?.outcome);
  const [picked, setPicked] = useState<string | undefined>(resume?.picked);
  const [tapped, setTapped] = useState<string | undefined>(resume?.tapped);
  // The user chose the list over Jev for this deck.
  const [picking, setPicking] = useState(resume?.picked !== undefined);
  const [taken, setTaken] = useState<Slug | null>(null);
  const [asking, setAsking] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const askGen = useRef(0);

  const credentials = state.credentials;
  const keys = useMemo(() => credentials.map(credentialKey), [credentials]);
  const byKey = useMemo(() => new Map(credentials.map((c) => [credentialKey(c), c])), [credentials]);
  const plan = useMemo(() => routeBatches(job, routeBadges(credentials)), [job, credentials]);
  // An outcome counts for the card only while the job is the one asked about. The card reads it
  // over the badges still in the folder (KTD4, KTD11). The ask card counts as answered only while
  // the badges are also the ones asked about, so a changed badge set invites a fresh ask.
  const forJob = !!outcome && outcome.job === job;
  const answered = forJob && !!outcome && !!plan && sameKeys(outcome.keys, plan.sent);

  const resumeNow: RouterResume = { job, ...(forJob ? { outcome } : {}), ...(picked !== undefined ? { picked } : {}), ...(tapped ? { tapped } : {}) };
  const home = () => navigate({ view: "home" });
  const orderByCost = () => navigate({ view: "deck", deck: "cost-order", returnTo: resumeNow });

  function editJob(text: string) {
    setJob(text);
    setTrouble(null);
    askGen.current++;
  }

  /** Leaving the ask card drops any ask in flight. */
  function leaveAsk() {
    askGen.current++;
    setAsking(false);
  }

  async function ask(advance: () => void) {
    if (!plan || plan.batches.length === 0 || asking) return;
    const gen = ++askGen.current;
    setAsking(true);
    setTrouble(null);
    try {
      const got = await askRoute(job, plan, jev.ask, { cancelled: () => gen !== askGen.current });
      if (gen !== askGen.current || !got) return;
      setOutcome(got);
      setPicked(undefined);
      setTapped(undefined);
      setTaken(null);
      advance();
    } catch (e) {
      if (gen === askGen.current) setTrouble(routeFailure(e));
    } finally {
      if (gen === askGen.current) setAsking(false);
    }
  }

  // The card's badge (KTD4, KTD11): the user's pick when they picked one, else Jev's strongest
  // match or the "also like" they tapped, each only while it is still in the folder.
  const focus: CardFocus = (() => {
    if (picked !== undefined) {
      return { key: picked !== NONE_OF_THESE && byKey.has(picked) ? picked : null, matched: "picked", alsoLike: [], rating: null, model: null };
    }
    if (forJob && outcome) {
      const m = matchOf(outcome.answers, keys);
      const tap = tapped && byKey.has(tapped) && m.alsoLike.includes(tapped) ? tapped : undefined;
      const key = tap ?? m.best;
      const alsoLike = [m.best, ...m.alsoLike].filter((k): k is string => k !== null && k !== key);
      return { key, matched: tap ? "also-like" : "jev", alsoLike, rating: ratingOf(outcome.levels), model: outcome.model };
    }
    return { key: null, matched: "picked", alsoLike: [], rating: null, model: null };
  })();

  const credential = focus.key ? byKey.get(focus.key) : undefined;
  const rec: Recommendation | null = focus.key && matrix ? recommend(state, matrix, focus.key, focus.rating) : null;
  const pickSlug = rec?.kind === "pick" ? rec.pick.profile.slug : null;
  const holders: CleanHolder[] = rec?.kind === "pick" ? [rec.pick, ...rec.alternatives] : rec?.kind === "no-pick" ? rec.holders : [];
  // The agent the card will take: the one chosen among the holders while it still holds, else the pick.
  const takenHolder = holders.find((h) => h.profile.slug === taken) ?? holders.find((h) => h.profile.slug === pickSlug);

  const sendable = plan?.sent.length ?? routeBadges(credentials).length;
  const askable = jev.usable && !picking && credentials.length > 0 && sendable > 0;

  const jobBeat: Beat = {
    id: "job",
    title: "The job",
    forward: "Next",
    valid: job.trim() !== "",
    settled: jobFirstLine(job) || undefined,
    pane: true,
    focusBody: true,
    body: <RichText aria-label="Job" value={job} onChange={editJob} placeholder="Paste it as you'd hand it to an agent" />,
  };

  const askBeat: Beat = {
    id: "ask",
    title: "Ask Jev which badge it's like",
    ...(answered ? { forward: "Next" } : {}),
    settled: forJob ? matchedLine(focus.key ? byKey.get(focus.key) : undefined) : undefined,
    body: ({ advance }) => (
      <AskCard
        sends={plan?.sent.length ?? 0}
        tooLongCount={plan?.tooLong.length ?? 0}
        jobTooLong={plan === null}
        answered={answered}
        asking={asking}
        trouble={trouble}
        onAsk={() => void ask(advance)}
        onPick={() => {
          setPicking(true);
          setTrouble(null);
        }}
        onLeave={leaveAsk}
      />
    ),
  };

  const pickBeat: Beat = {
    id: "pick",
    title: "Which badge is it like",
    settled: picked === undefined ? undefined : picked === NONE_OF_THESE ? "None of these" : byKey.get(picked)?.name,
    body: ({ advance }) => (
      <>
        {trouble && (
          <p className="deck-error" role="alert">
            {trouble}
          </p>
        )}
        <ul className="choices choices-badges">
          {credentials.map((c) => {
            const key = credentialKey(c);
            const collection = state.collections.find((x) => x.slug === c.collectionSlug);
            return (
              <li key={key}>
                <button
                  type="button"
                  className="choice"
                  aria-pressed={picked === key}
                  onClick={() => {
                    setPicked(key);
                    setTaken(null);
                    advance();
                  }}
                >
                  {collection && <Cartridge collection={collection} credential={c} width={48} />}
                  <span className="choice-name">{c.name}</span>
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              className="choice choice-door"
              aria-pressed={picked === NONE_OF_THESE}
              onClick={() => {
                setPicked(NONE_OF_THESE);
                advance();
              }}
            >
              <Outline kind="cartridge" width={40} />
              <span className="choice-name">None of these</span>
            </button>
          </li>
        </ul>
      </>
    ),
  };

  const cardBeat = buildCard();

  const beats: Beat[] = credentials.length === 0 ? [jobBeat, cardBeat] : [jobBeat, askable ? askBeat : pickBeat, cardBeat];
  const startAt = resume && (resume.outcome || resume.picked !== undefined || credentials.length === 0) ? beats.length - 1 : 0;

  function buildCard(): Beat {
    // A miss: no badge is like the job (R12).
    if (!focus.key || !credential) {
      return { id: "miss", title: "No badge like this job", forward: "Make a badge from this job", body: null };
    }
    if (!rec) return { id: "wait", title: credential.name, body: null };
    if (rec.kind === "no-holder") {
      return {
        id: "no-holder",
        title: `No agent holds ${credential.name} yet`,
        forward: "Run a bake-off on it",
        body: (
          <>
            {rec.flagged.length > 0 && (
              <ul className="router-lines">
                {rec.flagged.map((f) => (
                  <li key={f.profile.slug}>{`${f.profile.name} needs a re-test: ${f.flags.map((x) => FLAG_SHORT[x]).join(", ")}`}</li>
                ))}
              </ul>
            )}
            <AlsoLike keys={focus.alsoLike} byKey={byKey} onTap={tapBadge} />
          </>
        ),
      };
    }
    const takeName = takenHolder?.profile.name;
    if (rec.kind === "no-pick") {
      return {
        id: "no-pick",
        title: credential.name,
        forward: takenHolder && taken ? `Take ${takeName}` : "Order by cost",
        body: (
          <div className="router-record">
            <ul className="router-lines">
              <li>{rec.noCostOrder ? "Your agents have no cost order yet" : "Not in your cost order yet"}</li>
              {focus.rating && <li>{ratingLine(focus.rating)}</li>}
            </ul>
            <HolderChoices holders={rec.holders} chosen={taken} onChoose={setTaken} />
            <AlsoLike keys={focus.alsoLike} byKey={byKey} onTap={tapBadge} />
          </div>
        ),
      };
    }
    const { pick, basis, step, cheaper, nextUp } = rec;
    const track = calibrationOf(state, focus.key!, focus.model ?? JEV_MODEL).trackRecord;
    const lead =
      step === "stepped-up" ? "Stepped up: Jev rates this job unusual or high-stakes" : basis === "go-to" ? `Go-to for ${credential.name}` : `Cheapest agent holding ${credential.name}`;
    return {
      id: "pick",
      title: pick.profile.name,
      forward: `Take ${takeName ?? pick.profile.name}`,
      body: (
        <div className="router-record">
          <p className="router-setup">{setupText(pick.profile)}</p>
          <p className="router-lead">{lead}</p>
          {step === "nothing-above" && <p className="router-note">{`Nothing above ${pick.profile.name} holds this badge`}</p>}
          {step === "blocked-by-order" && (
            <p className="router-note">
              {"Didn't step up: holders above it aren't in your cost order"}{" "}
              <button type="button" className="link" onClick={orderByCost}>
                Order by cost
              </button>
            </p>
          )}
          <ul className="router-lines" aria-label="Its record">
            <li>{`Met on ${formatDate(pick.latest.recordedAt)}`}</li>
            {track && <li>{`Jev matched your verdict ${track.matches} of ${track.calls} times on this badge`}</li>}
            {focus.rating && step !== "stepped-up" && <li>{ratingLine(focus.rating)}</li>}
          </ul>
          <ul className="router-lines" aria-label="Beside it">
            {cheaper.map((h) => (
              <li key={h.profile.slug}>{`${h.profile.name} also holds this, for less`}</li>
            ))}
            {nextUp && <li>{`Next up: ${nextUp.profile.name}`}</li>}
            {!pick.placed && <li>Not in your cost order yet</li>}
            {costPlaces(state).size === 0 && (
              <li>
                {"Your agents have no cost order yet "}
                <button type="button" className="link" onClick={orderByCost}>
                  Order by cost
                </button>
              </li>
            )}
          </ul>
          {holders.length > 1 && <HolderChoices holders={holders} chosen={takenHolder?.profile.slug ?? null} onChoose={setTaken} />}
          <AlsoLike keys={focus.alsoLike} byKey={byKey} onTap={tapBadge} />
        </div>
      ),
    };
  }

  function tapBadge(key: string) {
    setTapped(key);
    setTaken(null);
  }

  async function finish() {
    if (!focus.key || !credential) {
      navigate({ view: "deck", deck: "credential", fromJob: { task: job, router: resumeNow } });
      return;
    }
    if (!rec) return;
    if (rec.kind === "no-holder") {
      navigate({ view: "deck", deck: "test", credentialKey: focus.key });
      return;
    }
    if (!takenHolder || (rec.kind === "no-pick" && !taken)) {
      orderByCost();
      return;
    }
    const pick = rec.kind === "pick" ? rec : null;
    apply(
      await takeAgentForJob(storage, state, {
        job,
        collectionSlug: credential.collectionSlug,
        credentialSlug: credential.slug,
        profileSlug: takenHolder.profile.slug,
        recommended: pick ? pick.pick.profile.slug : null,
        basis: pick ? pick.basis : "none",
        steppedUp: pick?.step === "stepped-up",
        matched: focus.matched,
        ...(focus.rating ? { difficulty: focus.rating } : {}),
        ...(focus.model ? { jevModel: focus.model } : {}),
      }),
    );
    home();
  }

  return (
    <Deck
      label="Find an agent for a job"
      beats={beats}
      startAt={startAt}
      unsaved={job.trim() !== ""}
      onClose={home}
      onFinish={finish}
    />
  );
}

function matchedLine(credential: Credential | undefined): string {
  return credential ? `Like ${credential.name}` : "No badge like it";
}

function ratingLine(rating: Rating): string {
  return rating === "routine" ? "Jev rates this job routine" : rating === "judgment" ? "Jev rates this job as needing judgment" : "Jev rates this job unusual or high-stakes";
}

/** The ask card's body: what goes, the one press that sends it, and the way to pick instead (R4, KTD11). Unmounting drops the ask. */
function AskCard(props: {
  sends: number;
  tooLongCount: number;
  jobTooLong: boolean;
  answered: boolean;
  asking: boolean;
  trouble: string | null;
  onAsk(): void;
  onPick(): void;
  onLeave(): void;
}) {
  const { sends, tooLongCount, jobTooLong, answered, asking, trouble, onAsk, onPick, onLeave } = props;
  const leave = useRef(onLeave);
  leave.current = onLeave;
  useEffect(() => () => leave.current(), []);
  return (
    <div className="router-ask" aria-live="polite">
      {jobTooLong ? (
        <p className="muted">{JOB_TOO_LONG}</p>
      ) : (
        <>
          <p>
            {sends === 1
              ? "Sends the job, and the name, task and learning targets of 1 badge, to TypeSafe"
              : `Sends the job, and the names, tasks and learning targets of ${sends} badges, to TypeSafe`}
          </p>
          {tooLongCount > 0 && <p className="jev-note">{tooLongCount === 1 ? "1 badge is too long to send" : `${tooLongCount} badges are too long to send`}</p>}
        </>
      )}
      {trouble && <p className="deck-error">{trouble}</p>}
      <p className="helper">
        {!jobTooLong &&
          (answered ? (
            <button type="button" className="link" disabled={asking} onClick={onAsk}>
              {asking ? "Asking Jev…" : "Ask Jev again"}
            </button>
          ) : (
            <button type="button" className="primary" disabled={asking} onClick={onAsk}>
              {asking ? "Asking Jev…" : "Ask Jev"}
            </button>
          ))}
        <button type="button" className="link" onClick={onPick}>
          Pick the badge myself
        </button>
      </p>
    </div>
  );
}

/** The agents that hold the badge, one of them chosen: the forward action takes it (KTD11). */
function HolderChoices({ holders, chosen, onChoose }: { holders: CleanHolder[]; chosen: Slug | null; onChoose(slug: Slug): void }) {
  return (
    <ul className="choices router-holders" aria-label="Agents that hold it">
      {holders.map((h) => (
        <li key={h.profile.slug}>
          <button type="button" className="choice" aria-pressed={chosen === h.profile.slug} onClick={() => onChoose(h.profile.slug)}>
            <Machine mini setup={h.profile} width={56} />
            <span className="choice-name">{h.profile.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Jev's other matches over the threshold. Tapping one switches the card to it (KTD4). */
function AlsoLike({ keys, byKey, onTap }: { keys: string[]; byKey: Map<string, Credential>; onTap(key: string): void }): ReactNode {
  const shown = keys.filter((k) => byKey.has(k));
  if (shown.length === 0) return null;
  return (
    <p className="router-also">
      {"Also like: "}
      {shown.map((k, i) => (
        <span key={k}>
          {i > 0 && ", "}
          <button type="button" className="link" onClick={() => onTap(k)}>
            {byKey.get(k)!.name}
          </button>
        </span>
      ))}
    </p>
  );
}
