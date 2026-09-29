// The current route and a way to change it, shared by every screen inside the shell.

import { createContext, useContext } from "react";
import type { Route } from "./routes";

export interface NavContextValue {
  route: Route;
  navigate(route: Route): void;
}

export const NavContext = createContext<NavContextValue | null>(null);

export function useNav(): NavContextValue {
  const value = useContext(NavContext);
  if (!value) throw new Error("useNav must be used inside an AppShell");
  return value;
}
