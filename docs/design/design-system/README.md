# The Eido design system · canon

This folder is the canonical design system. Every pixel of UI the app
renders is governed from here. Approved 2026-07-17; promoted from
prototype to canon 2026-07-22.

## The map

| Artifact | Role |
| --- | --- |
| [`SYSTEM.md`](SYSTEM.md) | The rule book: normative prose for color, type, space, motion, components, states, canvas surfaces, and copy. Read the relevant section before any UI change. |
| [`eido-design-system.html`](eido-design-system.html) | The living reference: a standalone, file://-safe rendering of every key surface in both themes. When SYSTEM.md prose and this page disagree, the rendered result is the intent; flag the drift. Serve via the `design-system` launch config (port 8642). |
| [`BRIEF.md`](BRIEF.md) | The taste anchor: why the system looks and behaves the way it does. |
| [`PROPOSALS.md`](PROPOSALS.md) | The approved function-change scope (P1–P7 + D1–D15, all approved). |
| [`IMPLEMENTATION.md`](IMPLEMENTATION.md) | The delivered migration map: which slice owns which seam. |

## Source of truth and propagation

Design-token **values** live in exactly one editable place:
[`src/ui/tokens.ts`](../../../src/ui/tokens.ts). From that module:

1. **The app's CSS**: `virtual:eido-design-tokens.css`
   (`scripts/vite/designTokensPlugin.ts`) renders the `:root` light block,
   the `[data-theme="dark"]` block, and the reduced-motion overrides that
   `src/main.tsx` imports before every stylesheet.
2. **The canvas painters**: `painterPaletteForTheme()` feeds the painted
   world below Reading zoom (Overview, Map, silhouettes, painted edges),
   so DOM chrome and canvas painting cannot render different colors.
3. **The living reference**: the reference's token region is generated between
   markers. After editing `tokens.ts`, run `npm run design:sync` to regenerate it
   (`scripts/design/sync-design-reference.mjs`).

Change a token value in `tokens.ts` and nowhere else; everything above
moves with it. `npm run ci:design-system` fails while any consumer is
stale.

Everything downstream consumes **names, never values**:

- `src/styles/*.css`: the surface sheets; components reference `--e-*`
  semantic tokens and the `.t-*` type-role classes only.
- `src/ui/primitives/`: the shared control kit (buttons, fields, picker,
  chips, menus, tooltips…); import the primitive instead of rebuilding its
  states.
- `src/ui/overlays/`: the modal/dialog foundation.
- `src/ui/theme*.ts`, `src/ui/motion.ts`: the theme and motion runtime.
- `src/ui/cardIdentity.ts`: the user identity palette (user data, not
  chrome; the one sanctioned raw-color module beside `tokens.ts`).

## What is enforced mechanically

`npm run ci:design-system` runs on every change:

- `scripts/ci/design-system-drift.mjs`: no raw colors, off-ladder sizes,
  radii, weights, durations, or non-`--e-*` custom properties anywhere in
  production `src/`; forbidden copy vocabulary; retired classes; native
  `<select>`/`window.confirm`; plus invariant checks on the living
  reference itself. Exemptions are exact, per-file evidence records inside
  that script, never patterns.
- `scripts/design/sync-design-reference.mjs --check`: the reference's
  token region matches `tokens.ts`.

## What propagates by judgment, not machinery

The rule book governs more than tokens. These change by editing SYSTEM.md
and the surfaces that implement them, reviewed against each other:

- **Component recipes**: the reference's gallery CSS is intentionally a
  second rendering of the recipes, kept honest by review and the drift
  scanner's invariant checks, not by generation.
- **Copy**: the copy sheet (SYSTEM.md §9) and `src/shared/words.ts`; the
  scanner catches the known failure modes (SaaS vocabulary, running
  ellipses, multi-word chips), taste does the rest.
- **Grammar rules**: one-signal-per-event, the foot-action grammar, the
  height ladder's "who rides it" column. A new surface picks existing
  roles; a genuinely new role is a SYSTEM.md change first.

## Changing the system

1. **A token value** (retune a color, a duration): edit `tokens.ts`, run
   `npm run design:sync`, done: app, painters, console, and reference all move.
2. **A rule or recipe** (new component state, spacing rule, copy): update
   SYSTEM.md and the living reference together with the implementing
   surface; `ci:design-system` guards the invariants it can see.
3. **A new token, ladder step, or functional hue**: SYSTEM.md first (for a
   hue, follow §1.3's minting checklist), then `tokens.ts`, then
   consumers. Never introduce a value outside the ladders: the scanner
   will reject it anyway.
