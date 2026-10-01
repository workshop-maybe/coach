// Create an agent (U4, R13, KTD4): one card, chosen like a player. The agent's machine sits
// over three dials (harness, model, effort) and one button makes the agent, named for its
// setup. Clicking an encoder on the machine turns its dial (Shift or Alt turns it back,
// R3). Dials are buttons, never selects: each is a radio group to assistive tech, with
// arrow keys and previous/next controls moving through its values. "Other" turns a dial
// into one line to type on the same card. An agent with results is locked (KTD10) and
// offers a new agent like it instead.

import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { loadFolder, profilePath } from "../domain/folder";
import { createProfile, duplicateProfileDraft, isSetupLocked, updateProfile } from "../domain/operations";
import type { AgentProfile, AgentSetup, FolderState, Slug } from "../domain/types";
import { Deck } from "./Deck";
import { useNav } from "./nav";
import type { EncoderDial, MachineKey } from "../cast/mappings";
import { KeyedMachine } from "./KeyedMachine";
import type { TestPick } from "./routes";
import { useFolder } from "./useFolderState";
import { EFFORTS, HARNESSES, LATEST, OTHER, joinModel, modelsFor, rememberedModels, splitModel, versionsFor } from "./dialLists";

const FIRST: AgentSetup = { harness: "claude-code", model: "opus", effort: "high" };

function harnessLabel(value: string): string {
  return HARNESSES.find((h) => h.value === value)?.label ?? value;
}

/** "<harness>, <model>, <effort>", or with a number when another agent has that name (KTD4). */
export function setupName(setup: AgentSetup, taken: Iterable<string>, self?: string): string {
  const split = splitModel(setup.harness, setup.model);
  const model = split && split.version !== LATEST ? `${split.model} ${split.version}` : setup.model.trim();
  const parts = [harnessLabel(setup.harness.trim()), model, setup.effort.trim()].filter(Boolean);
  const base = parts.join(", ") || "New agent";
  const names = new Set([...taken].filter((n) => n !== self).map((n) => n.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** A setup value as a dial position: a listed value, or Other with its typed text. */
interface DialValue {
  choice: string;
  other: string;
}

function toDial(value: string, options: string[]): DialValue {
  return options.includes(value) ? { choice: value, other: "" } : { choice: OTHER, other: value };
}

const fromDial = (d: DialValue) => (d.choice === OTHER ? d.other.trim() : d.choice);

interface Dials {
  harness: DialValue;
  model: DialValue;
  /** The chosen model's version, or LATEST. Only a listed model with known versions has one. */
  version: string;
  effort: DialValue;
}

/** The effort dial's values: the listed efforts, plus a custom one the agent started with. */
function effortsWith(effort: string): string[] {
  return EFFORTS.includes(effort) || effort === "" ? EFFORTS : [...EFFORTS, effort];
}

function dialsFor(setup: AgentSetup, known: readonly AgentSetup[]): Dials {
  const split = splitModel(setup.harness, setup.model);
  return {
    harness: toDial(setup.harness, HARNESSES.map((h) => h.value)),
    model: split ? { choice: split.model, other: "" } : toDial(setup.model, [...modelsFor(setup.harness), ...rememberedModels(setup.harness, known)]),
    version: split?.version ?? LATEST,
    effort: toDial(setup.effort, effortsWith(setup.effort)),
  };
}

export interface PlayerCardProps {
  /** An existing agent to show. Left out, the card makes a new one. */
  profileSlug?: Slug;
  /** A test waiting on this agent, to return to once it is made (AE2). */
  returnTo?: TestPick;
  /** A locked agent this new one starts from. Once made, the new agent opens. */
  likeSlug?: Slug;
  /** An existing agent's earned keys, to handle on its machine (R8). */
  keys?: readonly MachineKey[];
  /** Activating one of `keys`. */
  onKey?(key: MachineKey): void;
  /** The handoff plugged into an existing agent, drawn on its machine (R15). */
  plugged?: { label?: string } | null;
}

type Mode = { kind: "create"; draft: Omit<AgentProfile, "slug"> | null } | { kind: "edit"; slug: Slug };

export function PlayerCard(props: PlayerCardProps) {
  // The dials start from what is on disk, so the card waits for the folder.
  const { state } = useFolder();
  return state ? <Player {...props} /> : null;
}

function Player({ profileSlug, returnTo, likeSlug, keys, onKey, plugged }: PlayerCardProps) {
  const { storage, state, apply } = useFolder();
  const { navigate } = useNav();
  const [mode] = useState<Mode>(() =>
    profileSlug
      ? { kind: "edit", slug: profileSlug }
      : { kind: "create", draft: state && likeSlug && state.profiles.some((p) => p.slug === likeSlug) ? duplicateProfileDraft(state, likeSlug) : null },
  );
  const stored = mode.kind === "edit" ? state?.profiles.find((p) => p.slug === mode.slug) : undefined;
  const start = mode.kind === "create" ? (mode.draft ?? FIRST) : (stored ?? FIRST);
  const known = state?.profiles ?? [];
  const [dials, setDials] = useState<Dials>(() => dialsFor(start, known));
  const locked = mode.kind === "edit" && !!state && isSetupLocked(state, mode.slug);

  const harness = fromDial(dials.harness);
  // Versions belong to a listed model; a typed or remembered model has none.
  const versions = dials.model.choice === OTHER ? [] : versionsFor(harness, dials.model.choice);
  const model = versions.length > 0 ? joinModel(dials.model.choice, dials.version) : fromDial(dials.model);
  const setup: AgentSetup = { harness, model, effort: fromDial(dials.effort) };
  const taken = state?.profiles.map((p) => p.name) ?? [];
  const name = mode.kind === "edit" && stored ? stored.name : setupName(setup, taken);
  const complete = setup.harness !== "" && setup.model !== "" && setup.effort !== "";

  // Listed models, then any typed on an earlier agent with this harness, then Other.
  const models = [...modelsFor(setup.harness), ...rememberedModels(setup.harness, known), OTHER];
  const harnessOptions = [...HARNESSES.map((h) => h.value), OTHER];
  const effortOptions = effortsWith(start.effort);

  function setHarness(d: DialValue) {
    if (d.choice === dials.harness.choice) return setDials({ ...dials, harness: d });
    const first = modelsFor(d.choice)[0] ?? rememberedModels(fromDial(d), known)[0];
    setDials({ ...dials, harness: d, model: first ? { choice: first, other: "" } : { choice: OTHER, other: "" }, version: LATEST });
  }

  /** A new model starts at its latest version. */
  function setModel(d: DialValue) {
    setDials({ ...dials, model: d, version: d.choice === dials.model.choice ? dials.version : LATEST });
  }

  const optionsOf: Record<EncoderDial, string[]> = { harness: harnessOptions, model: models, effort: effortOptions };

  /** An encoder click: the same step as that dial's previous and next controls. */
  function stepDial(dial: EncoderDial, by: 1 | -1) {
    const options = optionsOf[dial];
    const current = dials[dial];
    const next = options[(Math.max(0, options.indexOf(current.choice)) + by + options.length) % options.length];
    const value = { choice: next, other: next === OTHER ? current.other : "" };
    if (dial === "harness") setHarness(value);
    else if (dial === "model") setModel(value);
    else setDials({ ...dials, [dial]: value });
  }

  async function finish({ keepMine }: { keepMine: boolean }) {
    if (!state) return;
    // A new agent like a locked one is its own flow, so the route says so (not the opened agent).
    if (locked && stored) return navigate({ view: "deck", deck: "agent", likeSlug: stored.slug });
    if (mode.kind === "edit" && stored) {
      const current: FolderState = keepMine ? await loadFolder(storage) : state;
      const path = profilePath(stored.slug);
      // Keep mine lays only the setup over the file as it is now, so other changes on disk stay.
      const onDisk = keepMine ? current.profiles.find((p) => p.slug === stored.slug) : undefined;
      apply(await updateProfile(storage, current, { ...(onDisk ?? stored), ...setup }, current.raw[path] ?? null));
      navigate({ view: "item", item: "agent", profileSlug: stored.slug });
      return;
    }
    const draft = mode.kind === "create" ? mode.draft : null;
    const made = await createProfile(storage, state, {
      name,
      ...setup,
      repo: draft?.repo ?? "",
      notes: draft?.notes ?? "",
      params: { ...(draft?.params ?? {}) },
    });
    apply(made.state);
    if (returnTo?.credentialKey) navigate({ view: "deck", deck: "test", profileSlug: made.slug, credentialKey: returnTo.credentialKey });
    else if (likeSlug) navigate({ view: "item", item: "agent", profileSlug: made.slug });
    else navigate({ view: "home" });
  }

  const forward = locked ? "Make a new agent like this" : mode.kind === "edit" ? "Keep this setup" : "Make the agent";

  return (
    <Deck
      key={mode.kind === "edit" ? `edit:${mode.slug}` : "create"}
      label={mode.kind === "edit" ? "An agent" : "Create an agent"}
      onClose={() => navigate(likeSlug ? { view: "item", item: "agent", profileSlug: likeSlug } : { view: "home" })}
      onFinish={finish}
      beats={[
        {
          id: "player",
          title: name,
          forward,
          valid: locked || complete,
          body: (
            <div className={`player${locked ? " player-locked" : ""}`}>
              <div className="player-stage">
                <KeyedMachine setup={setup} keys={keys} onKey={onKey} onStep={locked ? undefined : stepDial} plugged={plugged} width={300} />
              </div>
              <div className="dials">
                <Dial
                  label="Harness"
                  options={harnessOptions}
                  show={harnessLabel}
                  value={dials.harness}
                  disabled={locked}
                  onChange={setHarness}
                />
                <Dial label="Model" options={models} value={dials.model} disabled={locked} onChange={setModel} />
                {versions.length > 0 && (
                  <Dial
                    label="Version"
                    options={[LATEST, ...versions]}
                    value={{ choice: dials.version, other: "" }}
                    disabled={locked}
                    onChange={(v) => setDials({ ...dials, version: v.choice })}
                  />
                )}
                <Dial label="Effort" options={effortOptions} value={dials.effort} disabled={locked} onChange={(effort) => setDials({ ...dials, effort })} />
              </div>
            </div>
          ),
        },
      ]}
    />
  );
}

interface DialProps {
  label: string;
  options: string[];
  value: DialValue;
  disabled?: boolean;
  show?(value: string): string;
  onChange(value: DialValue): void;
}

/** One dial: its value between previous and next, a radio group to assistive tech. */
export function Dial({ label, options, value, disabled = false, show = (v) => v, onChange }: DialProps) {
  const index = Math.max(0, options.indexOf(value.choice));
  const group = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLInputElement>(null);
  const isOther = value.choice === OTHER;

  // The dial's position between renders, so two quick key presses step twice rather than
  // both reading the value from before the first one re-rendered.
  const at = useRef(index);
  at.current = index;

  function step(by: number, focus: boolean) {
    if (disabled) return;
    at.current = (at.current + by + options.length) % options.length;
    const next = options[at.current];
    onChange({ choice: next, other: next === OTHER ? value.other : "" });
    if (!focus) return;
    // Focus follows the value, onto its radio or onto the line Other opens.
    requestAnimationFrame(() => {
      if (next === OTHER) line.current?.focus();
      else group.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const inLine = e.target instanceof HTMLInputElement;
    const back = e.key === "ArrowUp" || (!inLine && e.key === "ArrowLeft");
    const on = e.key === "ArrowDown" || (!inLine && e.key === "ArrowRight");
    if (!back && !on) return;
    e.preventDefault();
    step(on ? 1 : -1, true);
  }

  return (
    <div className="dial">
      <span className="dial-label" aria-hidden="true">
        {label}
      </span>
      <div className="dial-row">
        <button type="button" className="dial-step" aria-label={`Previous ${label.toLowerCase()}`} tabIndex={-1} disabled={disabled} onClick={() => step(-1, false)}>
          ‹
        </button>
        <div className="dial-window" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} ref={group} onKeyDown={onKeyDown}>
          {options.map((o, i) => {
            const checked = i === index;
            return (
              <span
                key={o}
                role="radio"
                aria-checked={checked}
                aria-disabled={disabled || undefined}
                tabIndex={checked && !isOther ? 0 : -1}
                className={checked && !isOther ? "dial-value" : "dial-option"}
                onClick={() => !disabled && onChange({ choice: o, other: "" })}
              >
                {show(o)}
              </span>
            );
          })}
          {isOther && (
            <input
              ref={line}
              className="dial-line"
              aria-label={`${label}, other`}
              placeholder={label}
              value={value.other}
              disabled={disabled}
              autoComplete="off"
              onChange={(e) => onChange({ choice: OTHER, other: e.target.value })}
            />
          )}
        </div>
        <button type="button" className="dial-step" aria-label={`Next ${label.toLowerCase()}`} tabIndex={-1} disabled={disabled} onClick={() => step(1, false)}>
          ›
        </button>
      </div>
    </div>
  );
}
