// The agent × credential matrix for the folder as loaded, rebuilt whenever the folder
// changes. Null until the first build finishes. Screens read holders and flags from it.

import { useEffect, useState } from "react";
import { buildMatrix, type Matrix } from "../domain/matrix";
import type { FolderState } from "../domain/types";

export function useMatrix(state: FolderState | null): Matrix | null {
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  useEffect(() => {
    if (!state) return;
    let live = true;
    void buildMatrix(state).then((m) => live && setMatrix(m));
    return () => {
      live = false;
    };
  }, [state]);
  return matrix;
}
