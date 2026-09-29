// An agent, opened (U7, R4, R7, R13). The player card in edit mode (locked once the agent
// has results, offering a new agent like it), its other parts as small cards that open
// one-beat edits, and the badges it earned, dimmed with the reason when a re-test is due.

import { FLAG_REASONS, cellKey } from "../domain/matrix";
import { credentialKey } from "../domain/types";
import { Badge } from "./Badge";
import { PartCard, useEscapeHome } from "./BadgeDetail";
import { Missing } from "./EditDecks";
import { useNav } from "./nav";
import { PlayerCard } from "./PlayerCard";
import type { AgentPart } from "./routes";
import { useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";

export function AgentDetail({ profileSlug }: { profileSlug: string }) {
  const { state } = useFolder();
  const { navigate } = useNav();
  const matrix = useMatrix(state);
  useEscapeHome();

  if (!state) return null;
  const profile = state.profiles.find((p) => p.slug === profileSlug);
  if (!profile) return <Missing onHome={() => navigate({ view: "home" })} />;

  const edit = (part: AgentPart) => navigate({ view: "deck", deck: "edit-agent", profileSlug, part });
  const params = Object.keys(profile.params);
  const earned = (matrix?.columns ?? []).flatMap(({ collection, credentials }) =>
    credentials.flatMap((credential) => {
      const cell = matrix?.cells.get(cellKey(profileSlug, credentialKey(credential)));
      return cell?.status === "met" ? [{ collection, credential, cell }] : [];
    }),
  );

  return (
    <div className="detail agent-detail">
      <PlayerCard key={profileSlug} profileSlug={profileSlug} />

      <ul className="parts" aria-label="Parts">
        <PartCard name="Name" value={profile.name} onOpen={() => edit("name")} />
        <PartCard name="Repo" value={profile.repo || "None yet"} onOpen={() => edit("repo")} />
        <PartCard name="Notes" value={profile.notes.trim().split("\n")[0] || "None yet"} onOpen={() => edit("notes")} />
        <PartCard name="Parameters" value={params.length === 0 ? "None yet" : params.join(", ")} onOpen={() => edit("params")} />
      </ul>

      <section className="detail-section" aria-labelledby="agent-badges">
        <h3 id="agent-badges">Badges</h3>
        {matrix && earned.length === 0 ? (
          <p className="muted">
            No badges yet.{" "}
            <button type="button" className="link" onClick={() => navigate({ view: "deck", deck: "test", profileSlug })}>
              Test it
            </button>
          </p>
        ) : (
          <ul className="detail-earned">
            {earned.map(({ collection, credential, cell }) => {
              const key = credentialKey(credential);
              const flagged = cell.flags.length > 0;
              return (
                <li key={key}>
                  <button
                    type="button"
                    className={`earned${flagged ? " flagged" : ""}`}
                    data-flagged={flagged || undefined}
                    onClick={() => navigate({ view: "item", item: "badge", credentialKey: key })}
                  >
                    <Badge collection={collection} credential={credential} size={72} />
                    <span className="earned-name">{credential.name}</span>
                    {cell.flags.map((f) => (
                      <span key={f} className="earned-reason">
                        {FLAG_REASONS[f]}
                      </span>
                    ))}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
