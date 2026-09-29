// One badge as an <img> with an SVG data URI (KTD6), so ids never collide and the
// embedded fonts load the same way they do outside the app. Shows a same-size
// placeholder until the async fingerprints and art resolve.

import { useEffect, useMemo, useState } from "react";
import { buildBadgeInput } from "../badge/resolve";
import { badgeDataUri, renderBadgeSvg } from "../badge/render";
import type { Collection, Credential } from "../domain/types";
import { useFolder } from "./useFolderState";

export interface BadgeProps {
  /** The collection, possibly a draft copy carrying unsaved badge settings. */
  collection: Collection;
  credential: Pick<Credential, "slug" | "name">;
  /** Rendered width and height in pixels. */
  size: number;
  className?: string;
  /** Reports whether the settings name an art file that could not be read. */
  onArtMissing?(missing: boolean): void;
}

export function Badge({ collection, credential, size, className, onArtMissing }: BadgeProps) {
  const { storage, artGeneration } = useFolder();
  const [svg, setSvg] = useState<string | null>(null);
  const deps = JSON.stringify([collection.slug, collection.name, collection.badge ?? null, collection.badgeOverrides?.[credential.slug] ?? null, credential.slug, credential.name]);

  useEffect(() => {
    let live = true;
    buildBadgeInput(storage, collection, credential)
      .then(({ input, artMissing }) => {
        if (!live) return;
        setSvg(renderBadgeSvg(input));
        onArtMissing?.(artMissing);
      })
      .catch(() => {
        // Leave the placeholder; a badge that cannot render must not break the screen.
      });
    return () => {
      live = false;
    };
    // `deps` captures every input that changes the rendered badge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage, deps, artGeneration]);

  const src = useMemo(() => (svg ? badgeDataUri(svg) : null), [svg]);
  const label = `Badge for ${credential.name}`;
  if (!src) return <span className={`badge-placeholder ${className ?? ""}`} style={{ width: size, height: size }} role="img" aria-label={label} aria-busy="true" />;
  return <img className={className} src={src} width={size} height={size} alt={label} />;
}
