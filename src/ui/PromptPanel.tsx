// Placeholder with the final props contract. U10 replaces the body.
import type { PromptJob } from "../domain/prompts";

export interface PromptPanelProps {
  /** `collection/slug` of the credential the prompt is for. */
  credentialKey: string;
  /** Job to open on. Defaults to "test". */
  initialJob?: PromptJob;
  /** Pre-selected agent profile for the test job. */
  profileSlug?: string;
  onClose(): void;
}

export function PromptPanel({ onClose }: PromptPanelProps) {
  return (
    <section aria-label="Prompt">
      <button type="button" onClick={onClose}>Close</button>
    </section>
  );
}
