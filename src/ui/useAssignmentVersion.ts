// A badge's current assignment version (KTD5) for a view: the test deck tells a stale copied
// prompt by it, and compare and the reply view pick a held reply's reading and tell which of
// Jev's calls are current by it (jev-in-compare KTD3, KTD7). The hash is async, so a view
// reads null until it lands, and again for a moment after the task or rubric changes.

import { useEffect, useState } from "react";
import { assignmentVersion } from "../domain/hash";
import type { Credential } from "../domain/types";

/** The credential's assignment version, worked out once per task and rubric, or null until it has been. */
export function useAssignmentVersion(credential: Pick<Credential, "task" | "rubric"> | undefined): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setVersion(null);
    if (credential) void assignmentVersion(credential.task, credential.rubric).then((v) => live && setVersion(v));
    return () => {
      live = false;
    };
  }, [credential?.task, credential?.rubric]); // eslint-disable-line react-hooks/exhaustive-deps
  return version;
}
