/**
 * Andamio Design Tokens — SHARED LAYER
 * =================================================================
 * ⟢ THIS FILE IS HALF OF THE COPYABLE UNIT. It pairs with `./tokens.css`: this
 *   file holds the token NAMES, that one holds the VALUES they resolve to. A
 *   second Andamio surface takes BOTH, wholesale — do not cherry-pick, do not
 *   reformat. Taking only this file gives you a system that resolves to nothing.
 *   Everything here is intended to survive a second product diverging completely
 *   in components.
 *
 *   Full consumer contract: `landing-page-and-blog/src/ui/system/SHARED-TOKENS.md`
 *   (repo-qualified on purpose — a bare filename will not resolve once this
 *   file has been copied into another repo).
 *
 *   Synced from: repo `landing-page-and-blog` · branch `main` · commit 093ad94b
 *   A consumer updates that line on every sync. Without it, the second sync's
 *   diff shows what differs but not which side moved.
 *
 * ⟢ THIS FILE IMPORTS NOTHING. IT IS A LEAF. Not `./tokens.landing`, not any
 *   other relative sibling, not a `~/` alias path — none of those resolve once
 *   this file is copied into another repo, so any import breaks the copy. (The
 *   landing layer depends on this file; never the reverse.) Nothing
 *   machine-checks this; review does.
 *
 * THE RULES THIS LAYER ENCODES (numbered independently of the landing layer's
 * list — these are the shared layer's own; the pre-split file numbered them 1-3):
 *
 *  1. Type is Inter semibold (600) for display — the refined "12 cut":
 *     tight tracking (~-0.045em), leading ~0.92. JetBrains Mono ONLY for
 *     small labels, section numbers, and data readouts. Never a serif.
 *  2. Color discipline — a 3-color theme on ink/paper neutrals:
 *       • ORANGE is the Andamio brand signal, used SPARINGLY. Allowed on:
 *         the brand mark, the single primary CTA, the live pulse, and the
 *         VERIFIED stamp. NEVER on kickers, numerals, headings, or body.
 *       • BLUE is secondary — wayfinding + data only (the rail, links).
 *       • CORAL is a tint, used in exactly one zone (the specimen plate).
 *     ⚠️ These sentences name LANDING surfaces (rail, live pulse, VERIFIED
 *     stamp, specimen plate). A second consumer restates the rule against its
 *     own surfaces rather than porting the wording verbatim.
 *  3. Measure and grid are systemic: a 1320px measure on a 12-column field
 *     (see `measure`). Spacing is ROLE-DRIVEN on a 4px grid (see `spaceScale`):
 *     one role → one step, never eyeballed. Canonical steps (px): 4·8·12·16·
 *     24·32·40·48·64·96. The off-rhythm strays (20·28·56·80) migrate to the
 *     nearest role.
 */

/* ── Color ──────────────────────────────────────────────────────────────
 * Values resolve to CSS vars defined in globals.css (`--sys-*`), so the whole
 * design system flips with the global light/dark toggle (next-themes `.dark`).
 * The ink neutrals derive their alpha tints from a single channel triplet
 * (`--sys-ink-rgb`) so muted/faint/ghost/watermark/cell/grid/hairline all invert
 * from one source. (`--sys-paper-rgb` is declared alongside it in globals.css but
 * no token here reads it — it is a kit.tsx read.) Editing a hex here does
 * nothing — change the var in globals.css.
 *
 * A consumer declares its own `--sys-*` values in its own globals.css, in ALL
 * THREE sites: `:root`, `.dark`, and the forced-light island selector PAIR
 * `.sys-light, .dark .sys-light`. The alpha ratios below are literal by design —
 * they are the tint ramp, not colours. A hex here would be a bug. */
export const color = {
  paper: "var(--sys-paper)",
  ink: "var(--sys-ink)",
  /** Body / secondary text on paper. */
  inkMuted: "rgb(var(--sys-ink-rgb) / 0.60)",
  inkFaint: "rgb(var(--sys-ink-rgb) / 0.45)",
  inkGhost: "rgb(var(--sys-ink-rgb) / 0.30)",
  /** Big tabular watermark numerals. */
  inkWatermark: "rgb(var(--sys-ink-rgb) / 0.10)",

  /** Solid ink rule between full-bleed sections (softened in dark). */
  rule: "var(--sys-rule)",
  /** Inner cell / sub-divider. */
  cell: "rgb(var(--sys-ink-rgb) / 0.15)",
  /** Faint fixed grid field. */
  grid: "rgb(var(--sys-ink-rgb) / 0.05)",
  /** Hairline panel edge. */
  hairline: "rgb(var(--sys-ink-rgb) / 0.10)",

  /** Contrast pair for ink-emphasis surfaces (ink button, emphasized layer). */
  onInk: "var(--sys-on-ink)",

  /** Brand signal — sparing. Brand mark · primary CTA · live · verified. */
  orange: "var(--sys-orange)",
  /** Secondary — wayfinding + data only. */
  blue: "var(--sys-blue)",
  /** Tertiary tint — the specimen plate only. */
  coralTint: "var(--sys-coral-tint)",
  /** Opaque artifact-plate fill: paper nudged toward ink — slightly darker
   *  than the page in light mode, slightly lighter in dark mode. */
  plate: "color-mix(in srgb, var(--sys-paper) 95%, var(--sys-ink))",
  /** Soft lift for floating cards (artifact plate, demo container). Black-based
   *  so it stays a shadow (not a glow) in dark mode — which is why the var is
   *  declared once in `:root` with no `.dark` override. */
  cardShadow: "var(--sys-card-shadow)",
} as const;

/** Where each accent is allowed — enforced by convention + reviewed in /explore/system.
 *  Documentation in a typed const, NOT enforcement: these three fields are English
 *  sentences and nothing checks them. They also name landing surfaces — see rule 2. */
export const accentPolicy = {
  orange: "Brand mark, the single primary CTA, the live pulse dot, the VERIFIED stamp. Nothing else.",
  blue: "Wayfinding (editorial rail) and data readouts/links. Never a heading or body color.",
  coral: "A background tint for the one specimen plate. Never type.",
} as const;

/* ── Typography ─────────────────────────────────────────────────────── */
export const font = {
  sans: "'Inter', system-ui, -apple-system, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

/** Display weight + metrics — the "12 cut". */
export const display = {
  weight: 600,
  tracking: "-0.045em",
  leading: "0.92",
} as const;

/** Fluid type scale (clamp). Use via the Display/Heading helpers in kit.
 *  DISPLAY type only — the shared layer carries no small-label / UI type
 *  metric. Those live as Tailwind literals in
 *  landing-page-and-blog/src/ui/system/kit.tsx, which a consumer does not take;
 *  it supplies its own label scale. */
export const typeScale = {
  hero: "clamp(2.9rem, 8.5vw, 7rem)",
  xl: "clamp(2.6rem, 7vw, 5.5rem)", // section titles (Issuer, API, closing)
  lg: "clamp(2rem, 4.5vw, 3.5rem)", // problem heading
  md: "clamp(1.9rem, 4vw, 2.9rem)", // demo title
  sm: "clamp(1.6rem, 3.4vw, 2.6rem)", // ecosystem lead
} as const;

/* `kicker` (mono label: 11px, uppercase, tracking 0.18em) removed 2026-08-20 —
 * it had zero consumers AND described a treatment retired 2026-07-02: the
 * all-caps letterspaced eyebrow is gone, replaced by the Kicker component in
 * kit.tsx (sentence case + orange square). It is not reinstated here, and a
 * consumer must not implement the retired treatment. NOTE: the brand guide
 * (landing-page-and-blog/docs/design-system/andamio-brand-guide.md) still
 * specifies the old rule and predates the retirement — see
 * landing-page-and-blog/src/ui/system/SHARED-TOKENS.md. */

/* ── Measure & grid ─────────────────────────────────────────────────── */
/** The systemic half of layout: content measure and column count. A consumer
 *  takes THIS, not `layout` — `layout` adds landing's opinionated padding. */
export const measure = {
  /** Content measure. */
  maxWidth: 1320,
  /** Grid columns. */
  columns: 12,
} as const;

/* ── Spacing scale ──────────────────────────────────────────────────── */
/**
 * 4px base grid (Tailwind-native, so every step is already a 4px multiple). The
 * system's rule is not "use 4px" — it's "one ROLE → one STEP", so spacing is
 * intentional rather than eyeballed. Reach for a role in components; use a raw
 * step only for genuine one-offs. Governs LAYOUT spacing (padding, gaps, vertical
 * rhythm) — not 1–2px optical nudges. Avoid the off-rhythm strays the audit
 * found (20·28·56·80 → migrate to the nearest role).
 *
 * This is the framework-neutral half: px integers. The named ROLES that bind
 * these steps to Tailwind class strings live in `tokens.landing.ts`, because a
 * consumer on a different styling system cannot use them.
 */
export const spaceScale = {
  xs: 4, //  1
  sm: 8, //  2
  md: 12, //  3
  base: 16, //  4
  lg: 24, //  6
  xl: 32, //  8
  "2xl": 40, // 10
  "3xl": 48, // 12
  "4xl": 64, // 16
  "5xl": 96, // 24
} as const;
