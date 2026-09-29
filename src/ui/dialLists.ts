// The values an agent's three dials turn through: harness (with its models) and effort.
// Shared by the player card's dials and the machine's encoders (src/cast), so both
// always agree on what a setting's position is.

export const OTHER = "Other";

export const HARNESSES: { value: string; label: string; models: string[] }[] = [
  { value: "claude-code", label: "Claude Code", models: ["opus", "sonnet", "haiku"] },
  { value: "codex", label: "Codex", models: ["gpt-5-codex", "gpt-5"] },
  { value: "cursor", label: "Cursor", models: ["auto", "claude-sonnet", "gpt-5"] },
];

export const EFFORTS = ["low", "medium", "high", "max"];

export function modelsFor(harness: string): string[] {
  return HARNESSES.find((h) => h.value === harness)?.models ?? [];
}
