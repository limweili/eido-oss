# Codex cross-vendor review (gpt-5.6-terra, mid tier, codex exec read-only, 2026-07-16)

## Findings

No blockers found.

### Major

- Compiler card/section drags leak and can strand a dragged element on `pointercancel`. Both paths move the live element to `document.body`, then register only document `pointermove`, `pointerup`, and Escape handlers—no `pointercancel`. A cancelled touch/pen gesture can leave the card/section detached and retain listeners until a later pointer-up. [mod-workbench-v2.html:5390](../../../../docs/design/prototypes/mod-workbench-v2.html), [mod-workbench-v2.html:5479](../../../../docs/design/prototypes/mod-workbench-v2.html), [mod-workbench-v2.html:5493](../../../../docs/design/prototypes/mod-workbench-v2.html), [mod-workbench-v2.html:5566](../../../../docs/design/prototypes/mod-workbench-v2.html), [mod-workbench-v2.html:5580](../../../../docs/design/prototypes/mod-workbench-v2.html).

- The mandatory type ladder is not actually enforced. The contract permits only 9/10/11/13px except instrument numerals, but active UI uses 12/14/16px: palette caret, pack-menu button, tidy caret, add-section ghost, generic chrome button, and count button. [04-grammar-spec.md:133](./04-grammar-spec.md), [mod-workbench-v2.html:105](../../../../docs/design/prototypes/mod-workbench-v2.html), [mod-workbench-v2.html:206](../../../../docs/design/prototypes/mod-workbench-v2.html), [mod-workbench-v2.html:875](../../../../docs/design/prototypes/mod-workbench-v2.html), [mod-workbench-v2.html:956](../../../../docs/design/prototypes/mod-workbench-v2.html), [mod-ui.css:298](../../../../docs/design/prototypes/lib/mod-ui.css), [mod-ui.css:595](../../../../docs/design/prototypes/lib/mod-ui.css).

### Minor

- The shipped library gallery and design reference contradict the new grammar, so future prototype work can readily restore deleted concepts. The gallery still describes RANGE as a capsule/span jack and CURVE as a series jack, and calls OFF “silent”; the grammar bans those signal silhouettes and spelling. [gallery.html:554](../../../../docs/design/prototypes/lib/gallery.html), [gallery.html:628](../../../../docs/design/prototypes/lib/gallery.html), [gallery.html:841](../../../../docs/design/prototypes/lib/gallery.html), [04-grammar-spec.md:413](./04-grammar-spec.md).

- `DESIGN.md` and the gallery still document the old fidelity language (`ONE PASS · IN STAGES · AUTO`, `FAST/PRECISE`) rather than the journey’s renamed RUNS vocabulary. This is documentation/demo drift rather than active workbench behavior. [DESIGN.md:562](../../../../docs/design/prototypes/lib/DESIGN.md), [gallery.html:850](../../../../docs/design/prototypes/lib/gallery.html), [06-journey-redesign.md:286](./06-journey-redesign.md).

- Dead CSS remains from the settings restructuring: `.wb-config-preview` has no producer or consumer; live settings use the lib popup “says now” surface instead. [mod-workbench-v2.html:115](../../../../docs/design/prototypes/mod-workbench-v2.html), [mod-workbench-v2.html:2222](../../../../docs/design/prototypes/mod-workbench-v2.html).

### Nit

- A nearby CSS comment still references the removed `.wb-ghost-say` overlay. [mod-workbench-v2.html:333](../../../../docs/design/prototypes/mod-workbench-v2.html).

## Checked clean

- The extracted workbench script passes Node syntax checking.
- No active `renderPackRack`, `packRack`, or MOD PACK INSTANCES strip remains; `packInstances` is live model state for frames/presets/remove/undo.
- No rendered PREVIEW chrome found. Remaining hits are comments, generic “preview” prose, or the dead CSS noted above.
- NOTE is not included in `cardSpecs`, therefore does not compile. [mod-workbench-v2.html:4396](../../../../docs/design/prototypes/mod-workbench-v2.html).
- Main workbench state chips use `OFF`, `UNWIRED`, `CONFLICT`, `AUTO`, `READY`, and `NEEDS …`; no active alternate state-chip spelling found.
- THE RUN is always rendered and its one-call, empty-staged, and staged-card paths match the journey copy. [mod-workbench-v2.html:5060](../../../../docs/design/prototypes/mod-workbench-v2.html).
- FLIP regroup ghosts are capped at 12 and removed after 760ms; no unbounded accumulation found. [mod-workbench-v2.html:8042](../../../../docs/design/prototypes/mod-workbench-v2.html).
