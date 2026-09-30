// The values an agent's three dials turn through: harness (with its models) and effort.
// Shared by the player card's dials and the machine's encoders (src/cast), so both
// always agree on what a setting's position is.

import type { AgentSetup } from "../domain/types";

export const OTHER = "Other";

// Checked against each harness's model docs on 2026-09-30. Anything else is typed under
// Other once, and the dial remembers it (rememberedModels).
export const HARNESSES: { value: string; label: string; models: string[]; versions?: Record<string, string[]> }[] = [
  {
    value: "claude-code",
    label: "Claude Code",
    models: ["fable", "opus", "sonnet", "haiku"],
    // Newest first. The bare alias always means the newest (LATEST).
    versions: { fable: ["5.1", "5"], opus: ["5.5", "5", "4.8", "4.7", "4.6"], sonnet: ["5.5", "5", "4.6"], haiku: ["4.5"] },
  },
  { value: "codex", label: "Codex", models: ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"] },
  { value: "cursor", label: "Cursor", models: ["auto", "composer-2.5", "grok-4.7"] },
];

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export function modelsFor(harness: string): string[] {
  return HARNESSES.find((h) => h.value === harness)?.models ?? [];
}

/** A model left on its alias: whatever the harness currently ships as newest. */
export const LATEST = "latest";

/** A listed model's known versions, newest first; none when the harness ships versions as separate models. */
export function versionsFor(harness: string, model: string): string[] {
  return HARNESSES.find((h) => h.value === harness)?.versions?.[model] ?? [];
}

/**
 * A stored model value as a listed model and its version: "opus" is opus at LATEST,
 * "opus-5.5" is opus pinned to 5.5. Null for anything else (a typed model).
 */
export function splitModel(harness: string, value: string): { model: string; version: string } | null {
  const key = harness.trim();
  const v = value.trim();
  if (modelsFor(key).includes(v)) return { model: v, version: LATEST };
  for (const model of modelsFor(key)) {
    if (!v.startsWith(`${model}-`)) continue;
    const version = v.slice(model.length + 1);
    if (versionsFor(key, model).includes(version)) return { model, version };
  }
  return null;
}

/** The stored model value for a listed model at a version. */
export function joinModel(model: string, version: string): string {
  return version === LATEST ? model : `${model}-${version}`;
}

/**
 * Models typed under Other on this folder's agents with this harness, so the dial offers
 * them again. Derived from the agents themselves, never stored: delete the last agent that
 * used a model and the dial forgets it.
 */
export function rememberedModels(harness: string, setups: Iterable<AgentSetup>): string[] {
  const key = harness.trim();
  const listed = new Set(modelsFor(key).map((m) => m.toLowerCase()));
  const seen = new Set<string>();
  const found: string[] = [];
  for (const s of setups) {
    const model = s.model.trim();
    if (s.harness.trim() !== key || model === "" || splitModel(key, model)) continue;
    const lower = model.toLowerCase();
    if (listed.has(lower) || seen.has(lower)) continue;
    seen.add(lower);
    found.push(model);
  }
  return found.sort((a, b) => a.localeCompare(b));
}
