// The shared tokens (tokens.css) flip on a `.dark` class. The app has no theme
// toggle, so the class follows the OS setting, including changes while it runs.

export interface SchemeQuery {
  matches: boolean;
  addEventListener(type: "change", listener: (e: { matches: boolean }) => void): void;
  removeEventListener(type: "change", listener: (e: { matches: boolean }) => void): void;
}

/** Keeps `dark` on `root` in step with `media`. Returns a function that stops following. */
export function followColorScheme(
  root: HTMLElement = document.documentElement,
  media: SchemeQuery = window.matchMedia("(prefers-color-scheme: dark)"),
): () => void {
  const apply = (dark: boolean) => root.classList.toggle("dark", dark);
  const onChange = (e: { matches: boolean }) => apply(e.matches);
  apply(media.matches);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
