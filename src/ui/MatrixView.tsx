// The agent × credential matrix (R17-R19). Rows are profiles, columns are credentials
// grouped by collection. Status and flags are text, never color alone. A credential no
// agent meets gets a quiet distinct style (R19).

import { Fragment, useEffect, useState } from "react";
import { FLAG_REASONS, buildMatrix, cellKey, type CellFlag, type Matrix } from "../domain/matrix";
import { credentialKey as keyOf } from "../domain/types";
import { useNav } from "./AppShell";
import { AssessmentForm } from "./AssessmentForm";
import { CellHistory } from "./CellHistory";
import { PageHeader } from "./PageHeader";
import { Person } from "./Person";
import { Stat } from "./Stat";
import { resultLabel } from "./format";
import { describeError, useFolder } from "./useFolderState";

const FLAG_MARKS: Record<CellFlag, string> = {
  earlier_version: "Earlier version",
  setup_mismatch: "Setup changed",
};

const UNMET_LABEL = "No agent meets this yet";

export function MatrixView() {
  const { state, setNotice } = useFolder();
  const { route, navigate } = useNav();
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!state) return;
    let live = true;
    buildMatrix(state).then(
      (m) => live && setMatrix(m),
      (e) => live && setNotice(describeError(e)),
    );
    return () => {
      live = false;
    };
  }, [state, setNotice]);

  if (!state || !matrix) return <p className="muted">Loading…</p>;

  const hasCredentials = matrix.columns.some((g) => g.credentials.length > 0);
  const credentialCount = matrix.columns.reduce((n, g) => n + g.credentials.length, 0);
  const openKey = route.view === "matrix" ? route.cellKey : undefined;
  const openCell = openKey ? matrix.cells.get(openKey) : undefined;
  const openProfile = openCell && matrix.rows.find((p) => p.slug === openCell.profileSlug);
  const openCredential =
    openCell && matrix.columns.flatMap((g) => g.credentials).find((c) => keyOf(c) === openCell.credentialKey);

  return (
    <div className="matrix-view">
      <PageHeader
        title="Matrix"
        lead={<>Which of your agents can <strong>actually meet your acceptance criteria</strong> for each credential?</>}
        actions={
          matrix.rows.length > 0 &&
          hasCredentials && (
            <button type="button" onClick={() => setRecording(true)}>
              Record result
            </button>
          )
        }
      />

      {matrix.rows.length === 0 ? (
        <div className="empty-state">
          <p>No agent profiles yet. Add the agents you run to see how they do against your credentials.</p>
          <button type="button" onClick={() => navigate({ view: "agents" })}>
            Go to Agents
          </button>
        </div>
      ) : !hasCredentials ? (
        <div className="empty-state">
          <p>No credentials yet. Write one to start testing your agents.</p>
          <button type="button" onClick={() => navigate({ view: "collections" })}>
            Go to Collections
          </button>
        </div>
      ) : (
        <>
          <Stat value={credentialCount - matrix.unmetByAnyone.size} of={credentialCount}>
            credentials at least one of your agents has met.
          </Stat>
          {recording && (
            <AssessmentForm onDone={() => setRecording(false)} onCancel={() => setRecording(false)} />
          )}
          <div className="matrix-scroll">
            <table className="matrix">
              <thead>
                <tr>
                  <td />
                  {matrix.columns
                    .filter((g) => g.credentials.length > 0)
                    .map((g) => (
                      <th key={g.collection.slug} scope="colgroup" colSpan={g.credentials.length}>
                        {g.collection.name}
                      </th>
                    ))}
                </tr>
                <tr>
                  <th scope="col">Agent</th>
                  {matrix.columns.map((g) =>
                    g.credentials.map((c) => {
                      const unmet = matrix.unmetByAnyone.has(keyOf(c));
                      return (
                        <th key={keyOf(c)} scope="col" className={unmet ? "credential-unmet" : undefined}>
                          <span>{c.name}</span>
                          {unmet && <span className="unmet-note">{UNMET_LABEL}</span>}
                        </th>
                      );
                    }),
                  )}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((p) => (
                  <tr key={p.slug}>
                    <th scope="row">
                      <span className="item-name">
                        <Person />
                        {p.name}
                      </span>
                    </th>
                    {matrix.columns.map((g) => (
                      <Fragment key={g.collection.slug}>
                        {g.credentials.map((c) => {
                          const k = cellKey(p.slug, keyOf(c));
                          const cell = matrix.cells.get(k);
                          if (!cell) return <td key={k} />;
                          const label = resultLabel(cell.status);
                          const reasons = cell.flags.map((f) => ` ${FLAG_REASONS[f]}.`).join("");
                          return (
                            <td key={k} className={matrix.unmetByAnyone.has(keyOf(c)) ? "credential-unmet" : undefined}>
                              <button
                                type="button"
                                className={`cell cell-${cell.status}`}
                                aria-label={`${p.name}, ${c.name}: ${label}.${reasons}`}
                                aria-current={k === openKey ? "true" : undefined}
                                onClick={() => navigate({ view: "matrix", cellKey: k })}
                              >
                                <span className="cell-status">{label}</span>
                                {cell.flags.map((f) => (
                                  <span key={f} className="flag" title={FLAG_REASONS[f]}>
                                    {FLAG_MARKS[f]}
                                  </span>
                                ))}
                              </button>
                            </td>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {openCell && openProfile && openCredential && (
        <CellHistory
          key={openKey}
          cell={openCell}
          profile={openProfile}
          credential={openCredential}
          onClose={() => navigate({ view: "matrix" })}
        />
      )}
    </div>
  );
}
