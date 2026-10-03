// The Jev port over the native `jev_*` commands (KTD1, KTD5). Each method is one `invoke`;
// a rejection becomes a JevError, and a plain string from Tauri itself reads as "other".

import { invoke } from "@tauri-apps/api/core";
import type { JevAnswers, JevRequest } from "../domain/jevRequest";
import { toJevError, type Jev, type JevStatus } from "./jev";

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw toJevError(e);
  }
}

export class TauriJev implements Jev {
  status(): Promise<JevStatus> {
    return call(() => invoke<JevStatus>("jev_status"));
  }

  setKey(key: string): Promise<JevStatus> {
    return call(() => invoke<JevStatus>("jev_set_key", { key }));
  }

  clearKey(): Promise<JevStatus> {
    return call(() => invoke<JevStatus>("jev_clear_key"));
  }

  setOn(on: boolean): Promise<JevStatus> {
    return call(() => invoke<JevStatus>("jev_set_on", { on }));
  }

  ask(request: JevRequest): Promise<JevAnswers> {
    return call(() => invoke<JevAnswers>("jev_ask", { request }));
  }
}
