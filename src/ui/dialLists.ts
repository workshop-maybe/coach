// The values an agent's three dials turn through: harness (with its models) and effort.
// Shared by the player card's dials and the machine's encoders (src/cast), so both
// always agree on what a setting's position is.

import type { AgentSetup } from "../domain/types";

export const OTHER = "Other";

// Checked against each harness's model docs on 2026-09-30. Anything else is typed under
// Other once, and the dial remembers it (rememberedModels).
export const HARNESSES: { value: string; label: string; models: string[] }[] = [
  { value: "claude-code", label: "Claude Code", models: ["fable", "opus", "sonnet", "haiku"] },
  { value: "codex", label: "Codex", models: ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"] },
  { value: "cursor", label: "Cursor", models: ["auto", "composer-2.5", "grok-4.7"] },
];

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export function modelsFor(harness: string): string[] {
  return HARNESSES.find((h) => h.value === harness)?.models ?? [];
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
    if (s.harness.trim() !== key || model === "") continue;
    const lower = model.toLowerCase();
    if (listed.has(lower) || seen.has(lower)) continue;
    seen.add(lower);
    found.push(model);
  }
  return found.sort((a, b) => a.localeCompare(b));
}
