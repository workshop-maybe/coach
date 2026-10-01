// A badge, opened (U6, R4, R7, R12, R18). The credential as its cartridge, its parts as
// small cards (each opens a one-beat edit deck), and its holders as small machines: the
// agents whose latest result met it. Opening a holder shows every result it has for this
// badge, newest first.

import { useState } from "react";
import { resolveBadgeSettings } from "../badge/settings";
import { FLAG_REASONS, cellKey, type Cell } from "../domain/matrix";
import { Cartridge } from "../cast/Cartridge";
import { Machine } from "../cast/Machine";
import { machineKeys } from "../cast/mappings";
import { credentialKey, type AgentProfile, type Assessment } from "../domain/types";
import { contextLine } from "../domain/context";
import { handoffsFor } from "../domain/handoffs";
import { FLAG_SHORT, contextText, firstLine, formatDate, resultLabel } from "./format";
import { useNav } from "./nav";
import type { CredentialPart } from "./routes";
import { Missing, PartCard, fileName, focusOnMount, paletteName, useEscape } from "./shared";
import { TrashLink } from "./TrashDeck";
import { useFolder } from "./useFolderState";
import { useMatrix } from "./useMatrix";

export function BadgeDetail({ credentialKey: key }: { credentialKey: string }) {
  const { state } = useFolder();
  const { navigate } = useNav();
  const matrix = useMatrix(state);
  const [open, setOpen] = useState<string | null>(null);
  useEscape(() => navigate({ view: "home" }));

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
  const opened = holders.find((h) => h.profile.slug === open);
  const targets = credential.learningTargets.filter((t) => t.trim() !== "");
  const look = resolveBadgeSettings(collection, credential.slug);
  const handoffs = handoffsFor(state, key).length;

  return (
    <section className="detail" aria-label={credential.name}>
      <button type="button" className="deck-close ghost" aria-label="Close" onClick={home}>
        ×
      </button>
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
                  className={`detail-holder${cell.flags.length > 0 ? " flagged" : ""}`}
                  aria-expanded={open === profile.slug}
                  onClick={() => setOpen(open === profile.slug ? null : profile.slug)}
                >
                  {matrix && <Machine mini setup={profile} keys={machineKeys(matrix, profile.slug)} width={64} />}
                  <span className="detail-holder-name">{profile.name}</span>
                  <span className="detail-holder-latest">
                    {[resultLabel(cell.status), cell.latest ? formatDate(cell.latest.recordedAt) : "", ...cell.flags.map((f) => FLAG_SHORT[f])].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {opened && <History profile={opened.profile} cell={opened.cell} assessments={state.assessments} onTestAgain={() => navigate({ view: "deck", deck: "test", profileSlug: opened.profile.slug, credentialKey: key })} />}
      </section>

      <TrashLink onOpen={() => navigate({ view: "deck", deck: "trash", item: { kind: "badge", credentialKey: key } })} />
    </section>
  );
}

function History({
  profile,
  cell,
  assessments,
  onTestAgain,
}: {
  profile: AgentProfile;
  cell: Cell;
  /** Every result in the folder, so memory compares across credentials (R7). */
  assessments: readonly Assessment[];
  onTestAgain(): void;
}) {
  return (
    <div className="detail-history" aria-label={`${profile.name} results`} role="region">
      {cell.flags.length > 0 && (
        <ul className="detail-reasons">
          {cell.flags.map((f) => (
            <li key={f}>{FLAG_REASONS[f]}</li>
          ))}
        </ul>
      )}
      <ol>
        {cell.history.map((a) => (
          <li key={a.fileStem}>
            <p className="detail-history-head">
              <strong>{resultLabel(a.result)}</strong> <span className="muted">{formatDate(a.recordedAt)}</span>
            </p>
            <p className="detail-history-context muted">{contextText(contextLine(assessments, a))}</p>
            {a.note.trim() !== "" && <p>{a.note}</p>}
            <details>
              <summary>Reply</summary>
              <pre className="handback">{a.handBack}</pre>
            </details>
          </li>
        ))}
      </ol>
      <p className="helper">
        <button type="button" className="link" onClick={onTestAgain}>
          Test again
        </button>
      </p>
    </div>
  );
}
