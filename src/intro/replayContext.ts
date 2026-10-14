import { createContext, useContext } from "react";

/** Opens the intro replay. AppShell provides it; Home's quiet key calls it (KTD11). */
export const ReplayContext = createContext<() => void>(() => {});

export const useReplay = () => useContext(ReplayContext);
