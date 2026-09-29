// Badge settings controls (U5, R5-R10). Controlled: edits a BadgeSettings draft and
// never writes. In credential mode each control is inherited from the collection or
// overridden, and "Use collection setting" clears the override. Palette and colors
// are one control there, because they resolve as a pair (KTD3).

import { useEffect, useState } from "react";
import { collectionFingerprint } from "../badge/fingerprint";
import { PALETTES } from "../badge/palettes";
import { tokensFor } from "../badge/resolve";
import { resolveBadgeSettings, type BadgeColors, type BadgeSettings, type BadgeTitle } from "../badge/settings";
import type { Collection, Slug } from "../domain/types";

export interface BadgeControlsProps {
  /** "collection" edits the collection's settings. "credential" edits one credential's override. */
  mode: "collection" | "credential";
  /** The collection's settings, shown by inherited controls in credential mode. */
  collectionSettings: BadgeSettings;
  value: BadgeSettings;
  onChange(next: BadgeSettings): void;
  /** Ring hues in effect for the value, or null until the fingerprint resolves. */
  ringHues: BadgeColors | null;
  /** Default plate text, shown as placeholders. */
  titleDefaults: { main: string; eyebrow: string };
  /** Opens the image picker. The caller copies the file in and sets `art`. */
  onPickArt(): void;
  pickingArt?: boolean;
  artError?: string | null;
  artMissing?: boolean;
}

const HEX6 = /^#?([0-9a-fA-F]{6})$/;

/** Drops empty parts so an empty field is stored as absent. */
export function cleanSettings(s: BadgeSettings): BadgeSettings {
  const out: BadgeSettings = {};
  if (s.palette !== undefined) out.palette = s.palette;
  if (s.colors !== undefined) out.colors = { ...s.colors };
  if (s.art !== undefined) out.art = s.art;
  if (s.title !== undefined) {
    const title: BadgeTitle = {};
    if (s.title.main) title.main = s.title.main;
    if (s.title.eyebrow) title.eyebrow = s.title.eyebrow;
    if (Object.keys(title).length > 0) out.title = title;
  }
  return out;
}

export function isEmptySettings(s: BadgeSettings): boolean {
  return Object.keys(cleanSettings(s)).length === 0;
}

/** The ring hues a credential's badge shows, from possibly-draft settings. */
export function useRingHues(collection: Collection | null, credentialSlug: Slug): BadgeColors | null {
  const slug = collection?.slug ?? null;
  const [outer, setOuter] = useState<{ slug: string; hex: string } | null>(null);
  useEffect(() => {
    if (slug === null) return;
    let live = true;
    void collectionFingerprint(slug).then((hex) => live && setOuter({ slug, hex }));
    return () => {
      live = false;
    };
  }, [slug]);
  if (!collection || outer?.slug !== collection.slug) return null;
  const tokens = tokensFor(resolveBadgeSettings(collection, credentialSlug), outer.hex);
  return { ring: tokens.prim, innerRing: tokens.sec };
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function BadgeControls(props: BadgeControlsProps) {
  const { mode, collectionSettings, value, onChange, ringHues, titleDefaults } = props;
  const credential = mode === "credential";

  // Colors: palette plus custom ring hues, one pair.
  const pairInherited = credential && value.palette === undefined && value.colors === undefined;
  const pair = pairInherited ? collectionSettings : value;
  const shownColors = pair.colors ?? ringHues;
  const editPair = (patch: Pick<BadgeSettings, "palette" | "colors">) => {
    // The first edit of an inherited pair copies the collection's pair into the override.
    const merged = { palette: pair.palette, colors: pair.colors, ...patch };
    const { palette: _p, colors: _c, ...rest } = value;
    const next: BadgeSettings = { ...rest };
    if (merged.palette !== undefined) next.palette = merged.palette;
    if (merged.colors !== undefined) next.colors = merged.colors;
    onChange(next);
  };
  const editColor = (key: keyof BadgeColors, hex: string) => {
    if (!shownColors) return;
    editPair({ colors: { ...shownColors, [key]: hex } });
  };

  // Art: undefined inherits in credential mode, null is "no art".
  const artInherited = credential && value.art === undefined;
  const art = artInherited ? (collectionSettings.art ?? null) : (value.art ?? null);
  const setArt = (next: string | null | undefined) => {
    const { art: _a, ...rest } = value;
    onChange(next === undefined ? rest : { ...rest, art: next });
  };

  // Title: two fields; editing one copies the other's inherited value.
  const titleInherited = credential && value.title === undefined;
  const title = (titleInherited ? collectionSettings.title : value.title) ?? {};
  const setTitle = (key: keyof BadgeTitle, text: string) => {
    const { title: _t, ...rest } = value;
    onChange(cleanSettings({ ...rest, title: { ...title, [key]: text } }));
  };
  const clearOverride = (key: "title") => {
    const { [key]: _drop, ...rest } = value;
    onChange(rest);
  };

  return (
    <div className="badge-controls">
      <fieldset className="field">
        <legend>Colors</legend>
        {credential && <InheritState inherited={pairInherited} onUseCollection={() => editPairClear(value, onChange)} />}
        <label className="field">
          <span>Palette</span>
          <select value={pair.palette ?? ""} onChange={(e) => editPair({ palette: e.target.value === "" ? undefined : e.target.value })}>
            <option value="">Default for this collection</option>
            {PALETTES.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {shownColors ? (
          <div className="badge-swatches">
            <ColorField label="Outer ring" value={shownColors.ring} onCommit={(hex) => editColor("ring", hex)} />
            <ColorField label="Inner ring" value={shownColors.innerRing} onCommit={(hex) => editColor("innerRing", hex)} />
            {pair.colors && (
              <button type="button" onClick={() => editPair({ colors: undefined })}>
                Reset colors
              </button>
            )}
          </div>
        ) : (
          <p className="muted">Loading colors…</p>
        )}
      </fieldset>

      <fieldset className="field">
        <legend>Art</legend>
        {credential && <InheritState inherited={artInherited} onUseCollection={() => setArt(undefined)} />}
        <p className="badge-art-name">{art ? fileName(art) : credential && !artInherited ? "No art for this credential" : "No art"}</p>
        {props.artMissing && <p className="badge-note">Art file missing</p>}
        {props.artError && (
          <p className="form-error" role="alert">
            {props.artError}
          </p>
        )}
        <div className="row">
          <button type="button" onClick={props.onPickArt} disabled={props.pickingArt}>
            Choose image…
          </button>
          {credential
            ? value.art !== null && (
                <button type="button" onClick={() => setArt(null)}>
                  No art
                </button>
              )
            : value.art && (
                <button type="button" onClick={() => setArt(undefined)}>
                  Remove art
                </button>
              )}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>Title</legend>
        {credential && <InheritState inherited={titleInherited} onUseCollection={() => clearOverride("title")} />}
        <label className="field">
          <span>Title</span>
          <input value={title.main ?? ""} placeholder={titleDefaults.main} onChange={(e) => setTitle("main", e.target.value)} />
        </label>
        <label className="field">
          <span>Text above the title</span>
          <input value={title.eyebrow ?? ""} placeholder={titleDefaults.eyebrow} onChange={(e) => setTitle("eyebrow", e.target.value)} />
        </label>
      </fieldset>
    </div>
  );
}

function editPairClear(value: BadgeSettings, onChange: (next: BadgeSettings) => void) {
  const { palette: _p, colors: _c, ...rest } = value;
  onChange(rest);
}

function InheritState({ inherited, onUseCollection }: { inherited: boolean; onUseCollection(): void }) {
  if (inherited) return <p className="muted badge-inherit">Using collection setting</p>;
  return (
    <p className="badge-inherit">
      <span className="muted">Set for this credential. </span>
      <button type="button" className="link" onClick={onUseCollection}>
        Use collection setting
      </button>
    </p>
  );
}

/** A swatch plus a hex field. The hex field commits only six-digit values and otherwise keeps the last valid one. */
function ColorField({ label, value, onCommit }: { label: string; value: string; onCommit(hex: string): void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="badge-swatch">
      <label>
        <span>{label} color</span>
        <input type="color" value={value.toLowerCase()} onChange={(e) => onCommit(e.target.value.toUpperCase())} />
      </label>
      <label>
        <span className="visually-hidden">{label} hex</span>
        <input
          className="badge-hex"
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            const m = HEX6.exec(e.target.value.trim());
            if (m) onCommit(`#${m[1].toUpperCase()}`);
          }}
          onBlur={() => setText(value)}
        />
      </label>
    </div>
  );
}
