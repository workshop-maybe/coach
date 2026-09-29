// Names each file the app could not read (R22), and each file whose badge
// settings fall back to defaults. The files are never rewritten.

import type { LoadError } from "../domain/types";

export function LoadErrors({ errors }: { errors: LoadError[] }) {
  if (errors.length === 0) return null;
  return (
    <section className="banner banner-error" role="alert">
      <p className="banner-title">
        {errors.length === 1 ? "One file could not be read." : `${errors.length} files could not be read.`} They are
        left as they are.
      </p>
      <ul>
        {errors.map((e) => (
          <li key={e.path}>
            <code>{e.path}</code>
            <span className="banner-detail">{e.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Readable files whose badge settings fall back to defaults (KTD3). Non-blocking. */
export function LoadWarnings({ warnings }: { warnings: LoadError[] }) {
  if (warnings.length === 0) return null;
  return (
    <section className="banner banner-warning" role="status">
      <p className="banner-title">Some badge settings could not be read and are shown with defaults.</p>
      <ul>
        {warnings.map((w, i) => (
          <li key={`${w.path}:${i}`}>
            <code>{w.path}</code>
            <span className="banner-detail">{w.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
