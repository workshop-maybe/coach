// What sits above compare's panes (jev-in-compare U6, R6-R9, KTD6, KTD7, KTD13): the strip, or
// once Jev has anything current to show, the grid in its place. Both name each reply in the
// compare with the same chip: its agent, its setup, its state and when it came back, the open
// pair lit as a pressed key is, and the same press rules (the view's `choose`).
//
// The grid is a table in its own named, keyboard-focusable box, capped at about a third of
// the window's height, that scrolls both ways, with the header row and the row-header column
// sticky, so five or more replies, a narrow window or a long point never widen the window.
// Its header row is the chips. Its rows are the badge's current rubric points, then, while
// some column has a current reading, the learning targets as a second opinion sends them and
// Overall, each group set apart by a rule. A cell holds that reply's call in ink and its
// percent in small mono, read with the badge's current pair for the reading's model, where
// the reading holds the row (a point or a target by its exact text); on a
// point row, then, Better than and every reply it covers that point better than, by column
// name, where both orders of a head-to-head agree. Only what is current shows: a reading or a
// head-to-head asked at another version of the badge leaves its cells blank. No ranking and
// no winner.

import { useLayoutEffect, useRef } from "react";
import { calibrationOf, callOf, type CutOffs } from "../domain/calls";
import { currentHeadToHead, currentReadingOf, marksOf, type CompareTake } from "../domain/compareJev";
import type { Take } from "../domain/handoffResults";
import { rubricParts, savedPointOf, targetsToSend } from "../domain/secondOpinion";
import type { AgentProfile, Credential, FolderState, JevReading } from "../domain/types";
import { listNames, setupText, takeWhen } from "./format";
import { CALL_WORDS, percent } from "./JevReading";
import { Verdict } from "./shared";

/** One reply in the compare, in strip order. */
export interface CompareColumn extends CompareTake {
  profile: AgentProfile;
  /** When it came back, with its time when another take by the agent in the compare shares its date. */
  when: string;
}

/** The compare's replies as columns, each named as the grid's marks name it. */
export function columnsOf(entries: readonly { id: string; profile: AgentProfile; take: Take }[]): CompareColumn[] {
  const all = entries.map((e) => e.take);
  return entries.map((e) => {
    const when = takeWhen(e.take, all);
    const twin = entries.some((o) => o !== e && o.profile.slug === e.profile.slug);
    return { ...e, when, name: twin ? `${e.profile.name}, ${when}` : e.profile.name };
  });
}

interface ChipProps {
  column: CompareColumn;
  /** Whether the reply is one of the open pair. */
  pressed: boolean;
  disabled: boolean;
  onChoose(id: string): void;
}

/** A reply's chip: its agent over its setup over its state and date. The strip's item and the grid's column header. */
export function CompareChip({ column, pressed, disabled, onChoose }: ChipProps) {
  return (
    <button type="button" className="compare-chip" data-take={column.id} aria-pressed={pressed} disabled={disabled} onClick={() => onChoose(column.id)}>
      <span className="compare-chip-name">{column.profile.name}</span>
      <span className="compare-chip-meta">{setupText(column.take.setup)}</span>
      <span className="compare-chip-meta">
        <Verdict take={column.take} /> · {column.when}
      </span>
    </button>
  );
}

interface AboveProps {
  columns: readonly CompareColumn[];
  /** The open pair's ids. */
  open: readonly string[];
  disabled: boolean;
  onChoose(id: string): void;
}

/**
 * The strip: every reply as a chip. When it goes, as the first saved answer turns it into
 * the grid, `onLeave` gets the take of a chip that had the focus, before the chip leaves the
 * page, so the view can hand the focus to that take's column header.
 */
export function CompareStrip({ columns, open, disabled, onChoose, onLeave }: AboveProps & { onLeave(id: string): void }) {
  const list = useRef<HTMLOListElement>(null);
  const leave = useRef(onLeave);
  leave.current = onLeave;
  // A layout effect's cleanup runs before its nodes leave the page, while the chip still has the focus.
  useLayoutEffect(() => {
    const node = list.current;
    return () => {
      const el = document.activeElement;
      if (node && el instanceof HTMLElement && el.classList.contains("compare-chip") && node.contains(el) && el.dataset.take) leave.current(el.dataset.take);
    };
  }, []);
  return (
    <ol ref={list} className="compare-strip" aria-label="Replies">
      {columns.map((c) => (
        <li key={c.id}>
          <CompareChip column={c} pressed={open.includes(c.id)} disabled={disabled} onChoose={onChoose} />
        </li>
      ))}
    </ol>
  );
}

/** A column's current reading, with the pair its calls read with. */
interface ColumnReading {
  reading: JevReading;
  pair: CutOffs;
}

/** What the grid shows. */
export interface CompareGridData {
  /** The badge's current rubric points, in rubric order. */
  points: string[];
  /** The badge's learning targets as a second opinion sends them, while some column has a current reading; else none. */
  targets: string[];
  /** Whether some column has a current reading: the target rows and Overall show only then. */
  anyReading: boolean;
  /** Each column's current reading, by take id. */
  readings: Map<string, ColumnReading>;
  /** For each take id, one list per point of the take ids it covers that point better than (`marksOf`). */
  marks: Map<string, string[][]>;
}

/**
 * The grid's rows and cells (KTD7, KTD13), or null while nothing current shows: no column
 * has a reading at `version` and no pair of columns a head-to-head there.
 */
export function compareGridOf(state: FolderState, key: string, credential: Credential, version: string, columns: readonly CompareColumn[]): CompareGridData | null {
  const readings = new Map<string, ColumnReading>();
  const pairs = new Map<string, CutOffs>();
  const pairFor = (model: string) => pairs.get(model) ?? pairs.set(model, calibrationOf(state, key, model).pair).get(model)!;
  for (const c of columns) {
    const reading = currentReadingOf(state, c.take, version);
    if (reading) readings.set(c.id, { reading, pair: pairFor(reading.model) });
  }
  const anyReading = readings.size > 0;
  const anyPair = columns.some((a, i) => columns.slice(i + 1).some((b) => currentHeadToHead(state, key, a.take, b.take, version) !== undefined));
  if (!anyReading && !anyPair) return null;
  return {
    points: rubricParts(credential.rubric).points,
    targets: anyReading ? targetsToSend(credential.learningTargets) : [],
    anyReading,
    readings,
    marks: marksOf(state, key, columns, version),
  };
}


/** One cell: the call and its percent where the reading holds the row, then the head-to-head mark. */
function Cell({ probability, pair, better }: { probability?: number; pair?: CutOffs; better: readonly string[] }) {
  const read = probability !== undefined && pair !== undefined;
  return (
    <td>
      {read && (
        <span className="compare-grid-read">
          <span className="jev-call">{CALL_WORDS[callOf(probability, pair)]}</span>{" "}
          <data className="jev-p" value={String(probability)}>
            {percent(probability)}
          </data>
        </span>
      )}
      {read && better.length > 0 && " "}
      {better.length > 0 && <span className="compare-grid-mark">{`Better than ${listNames(better)}`}</span>}
    </td>
  );
}

/** A row's header: its full text, clamped to two lines on screen. */
function RowHead({ text }: { text: string }) {
  return (
    <th scope="row" title={text}>
      <span className="compare-grid-text">{text}</span>
    </th>
  );
}

/** The grid in the strip's place (KTD13). */
export function CompareGrid({ grid, columns, open, disabled, onChoose }: AboveProps & { grid: CompareGridData }) {
  const names = new Map(columns.map((c) => [c.id, c.name]));
  const betterAt = (id: string, point: number) => (grid.marks.get(id)?.[point] ?? []).flatMap((other) => names.get(other) ?? []);
  return (
    <div className="compare-grid" role="region" aria-label="Jev's calls" tabIndex={0}>
      <table aria-label="Jev's calls">
        <thead>
          <tr>
            <th className="compare-grid-corner" />
            {columns.map((c) => (
              <th key={c.id} scope="col">
                <CompareChip column={c} pressed={open.includes(c.id)} disabled={disabled} onChoose={onChoose} />
              </th>
            ))}
          </tr>
        </thead>
        {grid.points.length > 0 && (
          <tbody>
            {grid.points.map((point, i) => (
              <tr key={i}>
                <RowHead text={point} />
                {columns.map((c) => {
                  const read = grid.readings.get(c.id);
                  const at = savedPointOf(read?.reading.points, point);
                  return <Cell key={c.id} probability={at?.probability} pair={read?.pair} better={betterAt(c.id, i)} />;
                })}
              </tr>
            ))}
          </tbody>
        )}
        {grid.anyReading && grid.targets.length > 0 && (
          <tbody>
            {grid.targets.map((target, i) => (
              <tr key={i}>
                <RowHead text={target} />
                {columns.map((c) => {
                  const read = grid.readings.get(c.id);
                  const at = read?.reading.targets?.find((t) => t.text === target);
                  return <Cell key={c.id} probability={at?.probability} pair={read?.pair} better={[]} />;
                })}
              </tr>
            ))}
          </tbody>
        )}
        {grid.anyReading && (
          <tbody>
            <tr>
              <RowHead text="Overall" />
              {columns.map((c) => {
                const read = grid.readings.get(c.id);
                return <Cell key={c.id} probability={read?.reading.overall} pair={read?.pair} better={[]} />;
              })}
            </tr>
          </tbody>
        )}
      </table>
    </div>
  );
}
