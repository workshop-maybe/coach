// A badge, opened (U6, R4, R7, R12, R18). The credential as its cartridge and its parts as
// small cards (each opens a one-beat edit deck) in one column, its replies and its holders
// in the other, stacked below the stacking width (App.css). While one handoff has run, the
// replies are every agent's reply to it, each opening as its own view and coming back here
// with its take lit and the picks kept (U5, R16); once two or more have, each handoff that
// ran is a row that opens it as its own item (R1, R3, R5).
// The holders are small machines, the agents whose latest result met it, each naming the
// handoff that earned it; opening one goes to the reply that earned it (R4). Under each
// holder is one line: Go-to on the go-to, Make go-to on every other holder, which marks
// that holder's latest result. A go-to that no longer holds the badge shows under them,
// flagged (U5, R4, R8, R9, KTD7). The go-to is resolved from the folder on every render.

import { useEffect, useId, useRef, useState } from "react";
import { resolveBadgeSettings } from "../badge/settings";
import { cellKey, type Cell } from "../domain/matrix";
import { Cartridge } from "../cast/Cartridge";
import { Machine } from "../cast/Machine";
import { machineKeys } from "../cast/mappings";
import { goToOf, goToStanding } from "../domain/goTo";
import { markGoTo } from "../domain/operations";
import { credentialKey, type AgentProfile, type FolderState } from "../domain/types";
import { handoffRuns, type HandoffRun } from "../domain/handoffResults";
import { SKELETON_ID, handoffsFor, skeletonOf } from "../domain/handoffs";
import { FLAG_SHORT, firstLine, formatDate, goToLine, handoffLabel, handoffText, plugMark, resultLabel } from "./format";
import { useNav } from "./nav";
import { livePlugs, plugFor, usePendingTests } from "./pendingTests";
import { ReplyList } from "./ReplyList";
import { replyRoute } from "./replyRoute";
import type { CredentialPart, ReplyListState } from "./routes";
import { Missing, PartCard, fileName, focusOnMount, paletteName, useEscape } from "./shared";
import { TrashLink } from "./TrashDeck";
import { describeError, useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";

export function BadgeDetail({ credentialKey: key, lit, litTake, picks, focusCompare }: { credentialKey: string } & ReplyListState) {
  const { state, folder, storage, apply } = useFolder();
  const { navigate } = useNav();
  const { pending } = usePendingTests(folder);
  const matrix = useMatrix(state);
  useEscape(() => navigate({ view: "home" }));
  const ids = useId();
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  // The agent just made the go-to. Its row takes focus once it says Go-to, since the
  // Make go-to that was pressed is gone by then (KTD7).
  const [focusSlug, setFocusSlug] = useState<string | null>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const goTo = state ? goToOf(state, key) : null;
  const goToSlug = goTo?.profile.slug ?? null;
  useEffect(() => {
    if (!focusSlug || goToSlug !== focusSlug) return;
    const button = rowButtons.current.get(focusSlug);
    if (!button) return;
    button.focus();
    setFocusSlug(null);
  }, [focusSlug, goToSlug, matrix]);

  if (!state) return null;
  const home = () => navigate({ view: "home" });
  const credential = state.credentials.find((c) => credentialKey(c) === key);
  const collection = state.collections.find((c) => c.slug === credential?.collectionSlug);
  if (!credential || !collection) return <Missing onHome={home} />;

  const edit = (part: CredentialPart) => navigate({ view: "deck", deck: "edit-credential", credentialKey: key, part });
  const holders: { profile: AgentProfile; cell: Cell }[] = [];
  for (const profile of state.profiles) {
    const cell = matrix?.cells.get(cellKey(profile.slug, key));
    if (cell?.status === "met") holders.push({ profile, cell });
  }
  const runs = matrix ? handoffRuns(matrix, state, key) : null;
  const targets = credential.learningTargets.filter((t) => t.trim() !== "");
  const look = resolveBadgeSettings(collection, credential.slug);
  const handoffs = handoffsFor(state, key).length;
  const live = livePlugs(pending, state);
  const plugged = (slug: string) => plugMark(state, plugFor(live, slug));
  const standing = goTo && matrix ? goToStanding(matrix, goTo) : null;

  const makeGoTo = async (profile: AgentProfile, fileStem: string) => {
    if (marking) return;
    setMarking(true);
    setMarkError(null);
    try {
      apply(await markGoTo(storage, state, { profileSlug: profile.slug, collectionSlug: credential.collectionSlug, credentialSlug: credential.slug, fileStem }));
      setFocusSlug(profile.slug);
    } catch (e) {
      setMarkError(describeError(e));
    } finally {
      setMarking(false);
    }
  };

  return (
    <section className="detail detail-split" aria-label={credential.name}>
      <button type="button" className="deck-close ghost" aria-label="Close" onClick={home}>
        ×
      </button>
      <div className="detail-main">
        <div className="detail-head">
          <Cartridge collection={collection} credential={credential} width={136} />
          <h2 tabIndex={-1} ref={focusOnMount}>
            {credential.name}
          </h2>
          <button type="button" className="primary" onClick={() => navigate({ view: "deck", deck: "test", credentialKey: key })}>
            Test it on an agent
          </button>
        </div>

        <ul className="parts" aria-label="Parts">
          <PartCard name="Name" value={credential.name} onOpen={() => edit("name")} />
          <PartCard name="Learning targets" value={targets.length === 0 ? "None yet" : targets.length === 1 ? targets[0] : `${targets.length} targets`} onOpen={() => edit("targets")} />
          <PartCard name="Task" value={firstLine(credential.task) || "None yet"} onOpen={() => edit("task")} />
          <PartCard name="Rubric" value={firstLine(credential.rubric) || "None yet"} onOpen={() => edit("rubric")} />
          <PartCard name="Look" value={[paletteName(look.palette), look.art ? fileName(look.art) : ""].filter(Boolean).join(" · ")} onOpen={() => edit("look")} />
          <PartCard
            name="Handoffs"
            value={handoffs === 0 ? "Skeleton" : handoffs === 1 ? "1 handoff" : `${handoffs} handoffs`}
            onOpen={() => navigate({ view: "deck", deck: "handoffs", credentialKey: key })}
          />
        </ul>
      </div>

      <div className="detail-side">
        {matrix && runs && runs.runs.length > 0 && (
          <section className="detail-section" aria-labelledby="badge-replies">
            <h3 id="badge-replies">Replies</h3>
            {runs.mode === "single" ? (
              <>
                <p className="muted">{handoffText(state, key, runs.runs[0].id)}</p>
                <ReplyList credentialKey={key} run={runs.runs[0]} state={state} matrix={matrix} lit={lit} litTake={litTake} picks={picks} focusCompare={focusCompare} />
              </>
            ) : (
              <ul className="handoff-runs">
                {runs.runs.map((run) => (
                  <li key={run.id}>
                    <RunRow state={state} credentialKey={key} run={run} onOpen={() => navigate({ view: "item", item: "handoff", credentialKey: key, handoffId: run.id })} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="detail-section" aria-labelledby="badge-holders">
          <h3 id="badge-holders">Holders</h3>
          {holders.length === 0 ? (
            <p className="muted">{matrix ? "Nobody holds it yet" : ""}</p>
          ) : (
            <ul className="detail-holders">
              {holders.map(({ profile, cell }) => (
                <li key={profile.slug}>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) rowButtons.current.set(profile.slug, el);
                      else rowButtons.current.delete(profile.slug);
                    }}
                    className={`detail-holder${cell.flags.length > 0 ? " flagged" : ""}`}
                    onClick={() => matrix && navigate(replyRoute(matrix, state, key, profile.slug))}
                  >
                    {matrix && <Machine mini setup={profile} keys={machineKeys(matrix, profile.slug)} plugged={plugged(profile.slug)} width={64} />}
                    <span className="detail-holder-name" id={`${ids}-${profile.slug}`}>
                      {profile.name}
                    </span>
                    <span className="detail-holder-latest">
                      {[
                        resultLabel(cell.status),
                        cell.latest ? formatDate(cell.latest.recordedAt) : "",
                        cell.latest ? handoffText(state, key, cell.latest.handoff?.id) : "",
                        ...cell.flags.map((f) => FLAG_SHORT[f]),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                  {matrix &&
                    (goToSlug === profile.slug ? (
                      <p className={`detail-holder-goto${standing && standing.flags.length > 0 ? " flagged" : ""}`}>Go-to</p>
                    ) : (
                      cell.latest && (
                        <p className="helper">
                          <button type="button" className="link" aria-describedby={`${ids}-${profile.slug}`} disabled={marking} onClick={() => cell.latest && makeGoTo(profile, cell.latest.fileStem)}>
                            Make go-to
                          </button>
                        </p>
                      )
                    ))}
                </li>
              ))}
            </ul>
          )}
          {goTo && standing && !standing.holds && <p className="detail-goto-away flagged">{goToLine(goTo.profile.name, standing.flags)}</p>}
          {markError && (
            <p className="deck-error" role="alert">
              {markError}
            </p>
          )}
        </section>

        <TrashLink onOpen={() => navigate({ view: "deck", deck: "trash", item: { kind: "badge", credentialKey: key } })} />
      </div>
    </section>
  );
}

/**
 * A handoff that ran, as a row on its badge (KTD5): its key, its name, the first line it
 * changed from the skeleton (a new handoff starts as a copy of it), and how its agents did.
 */
function RunRow({ state, credentialKey: key, run, onOpen }: { state: FolderState; credentialKey: string; run: HandoffRun; onOpen(): void }) {
  const text = handoffsFor(state, key).find((h) => h.id === run.id)?.text;
  const own = run.id === SKELETON_ID || text === undefined ? null : ownLine(text, skeletonOf(state).text);
  const agents = run.agents.length;
  return (
    <button type="button" className="handoff-run" onClick={onOpen}>
      <span className="handoff-run-key">{handoffLabel(state, key, run.id) ?? "?"}</span>
      <span className="handoff-run-name">{handoffText(state, key, run.id)}</span>
      {own && <span className="handoff-run-line">{own}</span>}
      <span className="handoff-run-count">
        {agents === 1 ? "1 agent" : `${agents} agents`} · {run.met} met{run.held > 0 && ` · ${run.held} held`}
      </span>
    </button>
  );
}

/** The first line a handoff wrote that the skeleton does not have, else its first line. */
function ownLine(text: string, skeleton: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const theirs = new Set(skeleton.split("\n").map((l) => l.trim()));
  return lines.find((l) => !theirs.has(l)) ?? lines[0] ?? "";
}
