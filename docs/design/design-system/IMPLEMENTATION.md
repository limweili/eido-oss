# Implementation plan · bringing Eido into the design system

Status: completed v1 delivery map for slices 00–17, reconciled against the
running app and the approved PROPOSALS.md scope. Issue #510 owns the final
source integration onto current `main`; this map records the delivered seams
and dependency intent rather than prescribing new per-slice ceremony.

## Strategy

1. **One color authority.** The token sheet lives in a small TS module
   that generates the CSS `:root` AND feeds the canvas painter palettes
   (`BoardOverviewLayer`, silhouettes, painted edges): the painted world
   below Reading zoom must move in the same slice or DOM and canvas render
   different colors (they have already drifted: painted `rgba(191,96,54)`
   vs `--warn #b4532a`). Old vars are re-pointed to new values
   (`--paper: var(--e-surface-card)` …) so the whole app shifts onto the
   warm ladder in one reviewable diff before any component is touched.
2. **Create ownership seams before fan-out.** The monolithic stylesheet is
   first split mechanically into imported foundation and surface sheets.
   Tokens and primitives land before their consumers. Compatibility rules
   remain only until their owning surface migrates; cleanup deletes the last
   adapters. This makes the later surface lanes genuinely disjoint instead
   of asking several workers to edit `styles.css` at once.
3. **Every meaningful boundary is evidence-gated.** Evidence is
   proportional to consequence and reused across slices that share a
   primitive. Seeded Reading/crossfade/Overview/Map captures, interaction
   checks, and performance runs belong only where those risks change.
   Required CI proves the exact integration/landing head; optional canaries
   do not force unrelated slices to repeat broad or CPU-heavy validation.
4. **Copy stays in `words.ts`.** Label changes ride the slice that
   restyles their surface, reviewed against SYSTEM.md §9. The final copy
   pass audits only user-visible values, keeps chips to one word with
   tooltip detail, and renders running words through the shared pulse with
   no ellipsis.

## Font delivery

- Self-host JetBrains Mono (400/500/700) and Open Sans (variable,
  normal+italic) as woff2 under `src/assets/fonts/`, `@font-face` with
  `font-display: swap`, preloaded in `index.html`. (target ~130KB, measured, with subset coverage, at slice 02; the
  prototype's base64 embedding is prototype-only.)
- `font-feature-settings: "calt" 0` globally for mono.

## Slices and dependency graph

| # | Slice | Primary ownership | Depends on | Exit gate |
|---|---|---|---|---|
| 00 | Contract reconciliation | this directory + #491 tracker wording | - | docs and tracker agree with source and founder decisions |
| 01 | Mechanical CSS ownership split + characterization | `styles.css`, new imported style sheets, visual characterization tests | 00 | byte-for-byte-equivalent rendered baseline; no design changes |
| 02 | Fonts + token authority + bridge + painter parity | `src/ui/tokens.ts`, `virtual:eido-design-tokens.css`, Vite token plugin, font assets, `BoardOverviewLayer`, `labelLayer` | 01 | both-theme DOM/painter parity; theme-separated label caches; offline fonts packaged |
| 03 | Primitive control kit | Button, IconButton, Field, Segmented, Picker, ColourPicker, Chip/Badge, Menu, Tooltip, DockKey, compatibility adapters | 02 | state matrix, full Picker keyboard/listbox contract, and shared ColourPicker radio contract |
| 04 | Overlay stack + confirm/prompt service | shared modal shell, `useOverlayContract`, dialog service | 03 | topmost Escape, focus enter/trap/return, nested overlays, serialized destructive prompts |
| 05 | Theme preference + app-wide reduced motion + board ground | device-local settings, startup theme bootstrap, `App.tsx`, `Board.tsx`, React Flow chrome, theme painter input | 02, 03 | Light/Dark/Match-system with no flash; absent from saves; camera jumps and pulses hold under reduced motion |
| 06 | Top bar + empty state | `App.tsx` top bar/empty state and its owned sheet | 03, 05 | D4/D6, save state adjacent to Idea, responsive ghost-graph screenshots |
| 07 | Bottom dock + contextual tray | `BottomDock.tsx`, Mod-library dock surface, dock sheet | 03, 04, 05 | D1, stable bar geometry, 600ms tooltips, converted delete confirm |
| 08 | Card identity + shell | pure identity resolver, `CardShell`, `PlaybackCard`, shell sheet | 03 | forward-only opaque-hex input and safe fallback; exact theme/body readable AA roles; faint decoration-only; exact shell geometry; live resize readout |
| 09 | Shared prose/editor metrics | Note/Ask/Conversation editable prose, MDX overrides, prose sheet | 02, 08 | loaded Open Sans; passive/editor geometry equal at S/M/L 14/15/18 |
| 10 | AI/result/conversation cards | Ask, Result, Conversation, Group-compatible shared version/meta/foot chrome | 03, 04, 08, 09 | one-signal states; Picker journeys; 48px auto-follow and exact copy behavior preserved |
| 11 | Connections · sole Board renderer lane | connection DOM/painter/hit geometry, popover, `Board.tsx`, `boardScene`, `zoomChrome` | 04, 05 | whole-wire editor journey in every band; shared hit==paint; beats remain store-owned |
| 12 | Legacy Mod controls (superseded by ADR 0030 / #750) | historical `ModCard`, `ModEditor`, `modControlRenderers`, Mod-owned sheet | 03, 04 | replaced by the eleven single-class Mod faces and one `MODS` prompt block |
| 13 | Overlays + shared context rows | Settings, Context/Chain/Version, Gallery, Group details, Idea manager | 04, 05, 06, 10 | one ContextRow recipe; D5; nested keyboard/focus journeys at desktop and sheet breakpoints |
| 14 | Highlights | Highlights panel/tray, highlight theme tokens, shared ColourPicker consumer, two confirm call sites | 02, 03, 04 | tag IDs/order preserved; both-theme washes; shared two-row colour chooser; menu Escape/focus return |
| 15 | Playback transport + App integration | `TimelinePlayback`, playback-owned `App.tsx` seam | 03, 05, 06, 13 | D3; compact Picker; scrub, keyboard, and automatic playback share equal event-order progression |
| 16 | Copy, legacy cleanup, raw-value gate, docs-sync | shared words modules, remaining adapters/styles, CI gate, nearby docs | 06–15 | no stale visible copy, legacy classes, or authored raw values outside named geometry/data owners; prototype and nearby docs match the final contracts |
| 17 | Combined design integration gate | integration branch only | 02–16 and the production renderer train | #510 integrates one exact source head and reuses authoritative proof under ADR 0028; added evidence must be capable of changing the ship decision |

Slices 00–04 form the foundation train, but a downstream lane may start as
soon as every dependency listed in its row is complete; an independent
surface such as slice 08 may therefore run beside slice 04. Lanes run in
parallel only when their primary ownership is disjoint: for example 07,
08, 12, and 14. `App.tsx`, `Board.tsx`, `BottomDock.tsx`, `GroupCard.tsx`,
and shared copy remain explicitly serial through the dependency edges.
Slice 11 is the sole
Board-renderer lane. Slice 17 is the terminal native dependency gate and blocks the Alpha
release tracker.

## Current integration ownership

- #510 is the sole writer for reconciling this completed design train with
  current `main`. It preserves the production renderer, search/copy, focus,
  accessibility, and Electron/toolchain truth while composing the designed
  tokens, primitives, overlays, painter, motion, and copy.
- The final #510 refresh is merged from live `main`, not reconstructed with a
  cherry-pick stack. One additional live-main merge follows #561 so the final
  source head contains the complete renderer train.
- Required exact-head CI is the shared source-integration proof. Existing
  primitive, renderer, accessibility, and design-authority evidence is reused
  until a relevant semantic change invalidates it; optional canaries and broad
  performance runs are not repeated for an unchanged claim.
- Packaged release certification remains owned by #471. #510 preserves its
  source prerequisites but does not duplicate packaged-host proof or block on
  evidence that cannot change this source integration decision.

## Risks & their guards

- **Font metrics change card geometry** (Open Sans ≠ system stack; mono
  titles ≠ 600-weight sans). The passive-render/editor geometry contract
  is guarded by `cardEditing.browser.test.ts`; slice 09 must land both
  sides in one commit. Result-card heights will shift ⇒ growth-cap logic
  is viewport-derived and self-corrects, but screenshots must confirm no
  clipped feet. **Measured Reading-band footprints persist for unmounted
  cards** (they feed connection endpoints and hit tests): first prove the
  failure with a font-ready/offscreen-footprint test, then add only the
  invalidation it demonstrates and keep the overview-ghosting alignment
  test green.
- **Removing the resting card shadow** changes perceived separation;
  compensated by the darker ground (#e8e4dc). If cards feel flat in real
  density, the sanctioned fallback is a stronger `--e-line-strong` border,
  never a shadow.
- **Edge styling lives in store-driven remount world**: any new
  pill/edge affectation must live in store state or CSS, never component
  state (invariant 6).
- **Pill/port sizes are geometry contracts.** `zoomChrome.ts` owns the
  pill clamp and the connector's 13–24px close-up curve;
  `CONNECTOR_NODE_METRICS` owns its stable 24px target, 1.5px base stroke,
  and 1px go focus ring; `CONNECTION_ARROW_METRICS` owns the compact arrow,
  while `ConnectionEdge` derives the connector centre from each endpoint's
  reactive measured node frame (never cached, transform-sensitive handle
  bounds). Its coalesced mount registry hands an incident wire to the bounded
  painter when the remote Card leaves DOM residency;
  the low-detail port remains hit==paint.
  Restyle only through those shared owners.
- **Environment-sensitive evidence is conditional.** A host-explainable
  timing or browser failure is classified at the narrowest seam and does not
  trigger a new harness or broad rerun. ADR 0028 governs any remaining choice.
- **P5 is forward-only.** New/default palette choices produce opaque
  six-digit hex input; previously saved custom values remain readable.
  Unsupported legacy shapes and invalid values render the safe default
  without any save mutation. One resolver
  supplies assigned header on-colors, warm-role endpoint tightening for the
  custom mid-gap, and theme-aware foreground roles against the exact 50%
  body tint to live and playback cards. Faint remains the unmodified theme
  decoration role and never carries readable text. Historical color
  migration or preservation is not required; no storage-version change,
  backup lane, or #464 dependency is part of P5.
- **Renderer proof is inherited.** The production P/S/L, long-Card,
  focus-continuity, and image-lifetime seams retain their existing proof;
  #510 adds evidence only when its composition changes one of those claims.
- **No split-face product:** slices 01–07 land within one release train so
  chrome never ships half-themed; card slices 08–10 likewise.
- **Slice-16 gates follow ownership.** The raw-value gate covers authored
  CSS/TS literals only; saved user hexes and test fixtures are exempt by
  path. The vocabulary gate covers user-visible values from `words.ts` and
  rendered copy, not internal identifiers, comments, or test names.
- **Token module API (slice 02):** `src/ui/tokens.ts` exports the semantic
  map as plain resolved values (no color-mix at runtime for canvas). A Vite
  plugin exposes the named build/dev artifact
  `virtual:eido-design-tokens.css`; `main.tsx` imports it. The same renderer
  function is exercised in tests, which assert painter palettes equal its
  CSS custom properties in both themes.
- **Theme dimension (P7):** the token module carries both
  modes from day one: `:root` and `[data-theme="dark"]` generated from
  one table (SYSTEM.md §1.7), painter palettes resolved per theme, parity
  test runs against both. Slice 05 ships the device-local setting; the
  seam costs nothing at slice 02 and retrofitting it later costs a repaint
  audit.
- **Theme caches are data, not ambient CSS.** Theme identity is an explicit
  painter input and redraw trigger. It dimensions label ink resolution and
  bitmap cache keys so a live switch cannot reuse a light halo in dark mode.
- **P6 has four current uses.** The approved compact Picker serves Ask model,
  Conversation style, Group model, and playback speed. Single-class Mod faces
  retire the old choice/target consumers. Settings uses radio option cards.
- **P1 has seven call sites.** Destructive mutations capture their target
  before awaiting the shared dialog. The stack serializes prompts and only
  the topmost overlay handles Escape.
- **#510 owns the final composition.** Its exact-head required proof and
  source review decide source readiness; #471 separately owns packaged-host
  certification.

## Follow-ups owned here (promised by SYSTEM.md)

- **Focus traps**: P2's escape/focus contract plus a real Tab trap on every
  `aria-modal` surface. The retired expanded Mod editor is not an overlay owner.
- **rem migration**: the type scale ships px-locked; converting the type
  classes to rem (with px-locked hairlines/geometry) is a post-migration
  slice so OS font-size scaling works.
- **Scrollbars**: thin warm scrollbars (`scrollbar-color: var(--e-ink-faint) transparent`)
  on every internal scroller: default cool scrollbars read foreign on paper.
- **`tb-btn.primary-soft`** maps to the quiet variant + go-wash active
  state (the Highlights-open state): decided here so slice 03 doesn't
  improvise.

## What done looks like

- `main.tsx` imports `virtual:eido-design-tokens.css` before `styles.css`.
  The compiled CSS contains exactly one generated `:root`/dark token block;
  authored surface sheets declare no duplicate token values and consume
  semantic variables only.
- The living reference (`docs/design/design-system/eido-design-system.html`)
  and the app render parity-tested outcomes from the same named token and
  component recipes. The reference remains a static living gallery rather
  than an app dependency; its token region is generated from
  `src/ui/tokens.ts` (`npm run design:sync`, checked by
  `ci:design-system`), and screenshot/computed-style parity is the contract
  that prevents its intentionally duplicated gallery CSS from drifting.
  Its canvas specimen keeps the 28px whole-wire hit stroke, 200×120 card
  minimum, fixed-height body scrolling, approved P1–P7 posture, and the
  exact four-consumer Picker inventory.
- PR #443's docs are superseded by this directory; PR #442's language
  lives on in the single-class Mod faces and, through this system, everywhere else.
