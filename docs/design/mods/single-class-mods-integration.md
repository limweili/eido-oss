# Single-class mods — production integration spec

**Status:** approved direction (founder, 2026-07-23). **Reference implementation:**
[`docs/design/prototypes/mod-cards.html`](../prototypes/mod-cards.html) (v37) — the
behavioral truth for every gesture, prompt, and default in this spec.
**Supersedes:** the control/target mod engine of ADR 0022 and the
packs/controllers/visualizers direction in `docs/design/mods/` round-5 explorations.

## What changes

One class, called **mods**. Every mod is both the control and the visualizer — you
change the value by touching the picture of the value. Eleven kinds: mixer, filter,
slider, dial, count, switch, pad, select, order, radar, matrix. Each mod stands
alone (mods never connect to mods) and speaks through its own tiny prompt engine:

- **Value sentences** — one per option, built live from state (`frame + {value}`;
  the label speaks when no frame is written; silence is visible, never hidden).
- **The treatment line** — a per-kind mini system prompt saying how to READ the
  values, sent ahead of the sentences. **First principle: the default treatment
  never repeats user-editable words.** Names, ends, and stop values reach the AI
  only through the sentences, which cannot go stale. Treatments may cite
  structural facts (a mode, a count) but never editable text. Overrides are
  stored only when they differ from the computed default.

This replaces the current system entirely — no compatibility layer, no dual mode.

## Replacement map (current seam → new owner)

| Current | Replacement |
| --- | --- |
| `ModSpec` / `ModControl` union (10 control kinds) in `src/graph/types.ts` | one `Mod` shape: `{ kind, title, accent, state, treatOverride }`; per-kind `state` exactly as the prototype seeds define |
| `ModEditor.tsx` workbench + `ModCard.tsx` use-mode split | gone — the card face IS the editor; gear popover holds settings + option prompts, eye popover holds context (sentences + treatment) |
| `modControlRenderers.tsx` registry | per-kind registry `{ build, paint, paintLite, tape, settings, treatment }` ported from the prototype's `KINDS` table |
| `applyMods` + `emitModControl` four-target emission (`src/brain/applyMods.ts`, `modControlEmitters.ts`) | one emission per mod: treatment line, then its sentences, as a single block. The four `ModEmissionTarget` buckets retire (decision below) |
| `modNormalizer.ts` load-time coercion | new normalizer for the 11 kind states; keep the hard rule that a valid spec returns the same object (source fingerprints) |
| `BUILT_IN_MOD_TEMPLATES` in `modLibrary.ts` | re-seeded as the 11 kinds' prototype seeds |

**Unchanged seams:** `gatherConnectedThought` in `src/brain/compiler.ts` still
collects mod cards over `modifies` connections (ADR 0011/0012/0017 untouched);
`openRouter.ts` stays the only egress; store mutations stay in `src/graph/store.ts`
(the mutation list shrinks to per-kind value/structure actions).

## Reuse, don't rebuild

The prototype is not a sketch — it is the refined implementation, already
performance-proven and founder-approved gesture by gesture. Teams port it; they
do not reimplement it.

- **Lift verbatim (pure logic → typed modules):** the prompt engine (`say`,
  `spoken`, `snap`, each kind's `tape`), the `TREATS` table with the
  `treatment()` override rule, and each kind's seed, growth rule (`add`, max
  counts) and invariants (mixer `normalize`, matrix cell stepping). These become
  `src/mods/` TypeScript modules with types added and zero behavioral edits.
- **Lift with a thin host (the faces):** each kind's `build` / `paint` /
  `paintLite` and the shared rAF-coalescing `drag()` helper are
  framework-agnostic DOM code, already tuned to the performance grammar. Mount
  each face as an imperative island inside the React card shell (container ref;
  React owns head, foot and chrome — the face owns its own DOM and per-frame
  paints). Rewriting the faces in JSX is explicitly out of scope: it rebuilds
  from scratch and re-risks the measured gesture performance.
- **Lift the CSS:** the instrument recipes (`.i-*`), the removal circle
  (`.row-x`), the node dot (`.mod-node*`), the inline rename (`.e-edit`) and the
  popover field/accordion patterns already speak design-system tokens — they
  move into the app stylesheet under design-system review with names intact.
- **Value flow at the store seam:** mid-drag frames stay local to the face
  (`paintLite`, exactly as prototyped); the store action commits on gesture end
  or discrete step, so undo/redo and the revision funnel see one atomic change
  per gesture.
- **Stable nested identity:** every option, item, lane, axis, row, and column has
  a durable nested ID. A Mod document has no second root ID: the containing Card
  or Profile record owns root identity. Template stamping allocates fresh nested
  IDs and preserves immutable source-to-instance provenance.
- **Not carried over:** the prototype's board dealer (`layoutBoard` — the canvas
  replaces it), the flat swatch well (identity palette well instead), and the
  private `h()`/`sv()` helpers, which stay internal to face modules.

## Canvas & design system

- Obey `docs/design/design-system/SYSTEM.md`; tokens and roles only, no raw values.
- **Color picker:** use the approved User identity palette well (SYSTEM.md §1.5,
  `docs/design/design-system/eido-design-system.html`) — the shared 12 identities
  as `{solid, on-solid, tint}` sets in column-major kindred pairs. The Mod UI has
  no custom-hex entry; existing data outside the palette still renders through
  the shared resolver. The
  prototype's flat 6×2 swatch popover is NOT carried over.
- **Title editing:** keep the prototype's inline `e-edit` rename (invisible at
  rest, underline on hover, go-line on focus, Enter/Escape) — an explicit founder
  decision; do not conform mod cards to the current Eido card title editing.
- Carry over as system pieces (add to PROPOSALS.md): the `e-edit` inline rename,
  the removal circle standard (16px light chip, floats on top, spacing created
  per host), and the connector node dot (13px ink ring, −8px overhang, accent
  fill on hover, **no tooltip**).
- **Performance grammar is an invariant, not advice:** continuous gestures animate
  compositor properties only; decoration builds once; pointermoves are
  rAF-coalesced; rects cached at drag start; cards use `contain: layout style`
  (with z-index lift on hover); mods never live inside multicol/auto-balancing
  containers. The free-positioned canvas satisfies this. Prototype baseline:
  0.08–0.52 ms/frame per gesture including a forced layout flush.

## Persistence (SQLite Profile)

No DDL change. Cards remain `profile_records` rows; the mod instance lives in the
card row's `payload_json` and in the native mod records.

- `PROFILE_MOD_RECORD_VERSION` is 2 in `src/persistence/profileModRecords.ts`;
  the v2 document is the new `Mod` shape (kind, title, accent identity, per-kind
  state, treatment override). Keep the typed failure codes
  (`invalid` / `unsupported-future-version` / `immutable-built-in`).
- **No migration path:** fresh Profiles start at record axis 2. An existing
  axis-1 native Profile is refused during read preflight before DDL or mutation;
  there is no upgrader, dual reader, migration ledger, or v1-to-v2 mapping.
- Legacy browser `Card.mod` payloads are dropped by SavedBoard normalization while
  adjacent Cards, Connections, outputs, and settings are retained. A legacy Mod
  is not converted into a current Mod.
- Portable archives retain their envelope-v1 contract but must embed
  record-axis-2 Profile data. An archive containing record-axis-1 Profile data
  is rejected; no import translation exists.
- Persistence proof uses synthetic fixtures and disposable Profile roots under
  `eido-profile-safety`; it never experiments on the installed Profile.
- Agent compatibility: `profileAgentModCommandPlan.ts` and the current
  surface-v5 raw exact-22 consume the v2 Mod shape. Agent command discovery
  publishes the exact-15 bounded Idea, Board, and research commands, while
  ergonomic CLI Mod verbs compile to validated raw Mod commands. Historical
  surfaces v1, v2, v3, and v4 remain exact-replay-only.
  The existing surface-v5 `card.set-identity` command also accepts Mod Cards:
  selecting a preset atomically aligns the Card header and Mod accent to the
  preset solid in both `Card.modV2` and its one native instance record, while
  clear removes only the Card fill. Direct provenance and stamped
  source/version/`idMap` provenance remain unchanged.
  Composed packaged certification is tracked separately.

## Evidence (ADR 0028 — proportional)

- One seam test per kind at the prompt boundary: given a seed state, the emitted
  treatment + sentences are character-identical to prototype v37's (this is the
  product contract, and the proof that the port reused rather than rewrote).
- One treatment-principle test: no default treatment contains any user-editable
  word from its own state (the prototype's leak check, ported).
- Persistence round-trip for a v2 record per kind; one Board-load seam proof that
  legacy Mod payload disappears while adjacent Board data survives.
- One browser smoke per gesture family (drag, click-step, seam-drag, vertex-drag)
  — not per kind.

## Decisions folded in

1. **The four emission targets retire.** The new engine speaks one voice per mod
   (treatment, then sentences). The compiler preserves connected Mod order in one
   `MODS` block; every Mod's treatment is immediately followed by its sentences,
   and repeated kinds are not deduplicated. ADR 0030 supersedes ADR 0022.
2. **A mod is the whole card** — no more `Card.mod` attached to a generic card
   with a separate editor; the card kind is `mod`, its face is the kind's face.
3. **Old Mod payloads drop cleanly.** Current normalizers read v2 only. Browser
   saves retain adjacent Board data while discarding `Card.mod`; native record
   axis 1 and v1 Portable archives are refused without conversion.

## Out of scope

Wiring changes (mods still feed via `modifies`), execution-plan changes
(ADR 0013), the design-system rebuild itself, and any new mod kinds.
