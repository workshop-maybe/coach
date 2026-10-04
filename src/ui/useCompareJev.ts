// Compare with Jev, run (jev-in-compare U5, KTD8, KTD9): what one press would send, worked
// out from the folder on every render, and the run that sends it. The run asks one request
// at a time, readings first in strip order and then pairs, and saves each answer before the
// next ask goes, so a stop keeps what came back and asking again sends only the rest.
// Before each ask it checks the badge is still the version it planned at. A request Jev
// refuses as too long joins the too-long items for as long as the compare stays open, and
// the run goes on; any other failure stops it with one line, which stays after Jev Mode
// turns off. Nothing is retried. Each save goes through the compare's one-write-at-a-time
// gate, from the folder as it is then. Leaving drops the run, and an answer that lands
// after is not saved, as the test drops an ask on leaving.

import { useEffect, useMemo, useRef, useState } from "react";
import { planCompareJev, type CompareItem, type CompareTake } from "../domain/compareJev";
import { assignmentVersion } from "../domain/hash";
import { headToHeadPoints } from "../domain/headToHead";
import { answeringModel, type JevAnswers } from "../domain/jevRequest";
import { BADGE_CHANGED, saveHeadToHead, saveHeldReading } from "../domain/operations";
import { readingBeforeVerdict } from "../domain/savedReading";
import { readingParts } from "../domain/secondOpinion";
import { credentialKey, type Credential, type FolderState } from "../domain/types";
import { JevError, toJevError } from "../jev/jev";
import { useJev } from "./jevContext";
import { jevFailure } from "./jevFailure";
import { describeError, useFolder } from "./useFolderState";

export interface CompareJevOptions {
  /** The badge's key. */
  key: string;
  /** The badge as the folder has it now, or undefined while it is missing. */
  credential: Credential | undefined;
  /** The badge's current assignment version, or null until it has been worked out. */
  version: string | null;
  /** The compare's takes, in strip order. */
  takes: readonly CompareTake[];
  /** The compare's one-write-at-a-time gate (`useTakeWrites().exclusive`). */
  exclusive<T>(section: () => Promise<T>): Promise<T>;
}

/** How far a run has gone: `done` of `total` requests answered or skipped. */
export interface CompareJevProgress {
  done: number;
  total: number;
}

export interface CompareJev {
  /** The count line, while the action shows. */
  countLine: string | null;
  /** The line saying readings quote earlier replies, while the action shows. */
  examplesLine: string | null;
  /** One line per item too long for Jev, while Jev Mode is on and the badge has a rubric. */
  tooLongLines: string[];
  /** Whether the action shows: Jev Mode usable, a rubric, the version known, something to send, and no failure a retry can't fix. */
  canAsk: boolean;
  /** Sends what is missing, one request at a time. Does nothing unless the action shows and no run is going. */
  run(): Promise<void>;
  running: boolean;
  /** While running: how many requests are done, of how many. */
  progress: CompareJevProgress | null;
  /** The line for the failure that stopped the last run, until the next press or leaving. */
  failure: string | null;
}

/** Compare with Jev for one compare (KTD8, KTD9). */
export function useCompareJev({ key, credential, version, takes, exclusive }: CompareJevOptions): CompareJev {
  const { storage, state, apply } = useFolder();
  const jev = useJev();
  // Items Jev refused as too long while this compare has been open.
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<CompareJevProgress | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Set by a failure a retry can't fix, and kept until the compare opens again.
  const [hidden, setHidden] = useState(false);
  // The run generation: leaving bumps it, so a run in flight drops every answer after.
  const generation = useRef(0);
  // Set before the first await, so a second press does nothing.
  const runningNow = useRef(false);
  // The folder as it is now, for each save: a run outlives the render that started it.
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  // The takes are read from the folder state, so its identity, their ids and names decide the plan.
  // Nothing reads the plan unless Jev is offered, so it is built only then.
  const offered = jev.usable && !!credential && credential.rubric.trim() !== "";
  const takesKey = takes.map((t) => `${t.id}\n${t.name}`).join("\n\n");
  const plan = useMemo(
    () => (offered && state && credential && version !== null ? planCompareJev({ state, key, credential, version, takes, skipped }) : null),
    [offered, state, key, credential, version, takesKey, skipped], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const canAsk = offered && version !== null && !!plan && plan.countLine !== null && !hidden;

  async function run(): Promise<void> {
    if (!canAsk || !plan || version === null || runningNow.current) return;
    const items: CompareItem[] = [...plan.readings, ...plan.pairs];
    const planned = version;
    const gen = ++generation.current;
    const live = () => gen === generation.current;
    runningNow.current = true;
    setRunning(true);
    setFailure(null);
    try {
      for (const [done, item] of items.entries()) {
        setProgress({ done, total: items.length });
        if (await stopsAt(item, planned, live)) return;
      }
    } finally {
      if (live()) {
        runningNow.current = false;
        setRunning(false);
        setProgress(null);
      }
    }
  }

  /** Asks for one item and saves its answer. True when the run stops here. */
  async function stopsAt(item: CompareItem, planned: string, live: () => boolean): Promise<boolean> {
    const badge = latest.current?.credentials.find((c) => credentialKey(c) === key);
    const now = badge ? await assignmentVersion(badge.task, badge.rubric) : null;
    if (!live()) return true;
    if (now !== planned) {
      setFailure(BADGE_CHANGED);
      return true;
    }

    const askedAt = new Date().toISOString();
    let answers: JevAnswers;
    try {
      answers = await jev.ask(item.request);
    } catch (e) {
      if (!live()) return true;
      if (toJevError(e).kind === "tooLong") {
        setSkipped((s) => new Set([...s, item.itemKey]));
        return false;
      }
      const { line, retry } = jevFailure(e);
      setFailure(line);
      if (!retry) setHidden(true);
      return true;
    }
    if (!live()) return true;

    // An answer that isn't a full reading or a full head-to-head fails like any other ask.
    const save = saveOf(item, answers, planned, askedAt);
    if (!save) {
      setFailure(jevFailure(new JevError("other")).line);
      return true;
    }
    try {
      const next = await exclusive(() => save(latest.current!));
      latest.current = next;
      apply(next);
    } catch (e) {
      if (live()) setFailure(describeError(e));
      return true;
    }
    return !live();
  }

  /** The save for an item's answers, or null when they don't answer every question asked. */
  function saveOf(item: CompareItem, answers: JevAnswers, planned: string, askedAt: string): ((current: FolderState) => Promise<FolderState>) | null {
    const model = answeringModel(answers);
    if (item.kind === "reading") {
      const { state: asked } = item.request;
      const parts = readingParts(asked.rubric_points, answers, asked.learning_targets);
      if (!parts) return null;
      const reading = readingBeforeVerdict({ parts, model, assignmentVersion: planned, askedAt, examplesSent: item.sources.length });
      const { profileSlug, collectionSlug, credentialSlug, fileStem } = item.entry.take;
      return (current) => saveHeldReading(storage, current, { profileSlug, collectionSlug, credentialSlug, fileStem, reading });
    }
    const points = headToHeadPoints(item.request.state.rubric_points, answers);
    if (!points) return null;
    const { first, second } = item;
    return (current) =>
      saveHeadToHead(storage, current, {
        collectionSlug: first.take.collectionSlug,
        credentialSlug: first.take.credentialSlug,
        model,
        assignmentVersion: planned,
        askedAt,
        first: { profileSlug: first.take.profileSlug, fileStem: first.take.fileStem },
        second: { profileSlug: second.take.profileSlug, fileStem: second.take.fileStem },
        points,
      });
  }

  return {
    countLine: canAsk && plan ? plan.countLine : null,
    examplesLine: canAsk && plan ? plan.examplesLine : null,
    tooLongLines: offered && plan ? plan.tooLongLines : [],
    canAsk,
    run,
    running,
    progress,
    failure,
  };
}
