# 07 — Orchestrator decisions (conflicts from Stream 5)

Rulings on `05-part-specs.md` "CONFLICTS FOR ORCHESTRATOR", 2026-07-16.
Binding on implementation waves.

1. **NOTE never compiles.** Notes are author annotations; speaking them is a
   surprise (prediction test). Drop the journey's "note is being read out"
   lint row — it lints a leak that no longer exists.
2. **OFF ghost sentence: ratified** as a grammar amendment. Faces of OFF/
   silent parts MAY show a ghosted "would say" sentence (wash + OFF chip per
   grammar R4.3). Compiler cards still never fabricate sentences (R6.2
   holds). Documented exception → no longer an exception.
3. **MIXER inert STOP NAMES field: remove.** A field that does nothing is
   not capability; it is decoration. Rename its STOPS → SNAP as specced.
4. **EXPLORER value presets + pack variation picker coexist** on the frame
   tab as two visually distinct rows (presets = toggle chips per chip
   taxonomy; variations = the picker). If the tab crowds at code time,
   value presets move into the frame popover — never merged into the
   variation picker.
5. **One frame base class, two variants.** Pack halo and GROUP VOICE share
   base frame styling; tabs differ: voice variant → sentence-builder gear,
   pack variant → preset picker + status. No popover inheritance.
6. **All Stream-5 renames approved** (LADDER, Work steps, STOPS, SNAP, NOW,
   ACROSS, VALUE STOPS, MOMENT NAMES, HOW TO DECIDE, CHECK AGAINST,
   SENTENCE, MAKE THIS THE DEFAULT, WHAT IT SAYS NOW, NOTE). Label-only.
7. **Demo board re-seed approved** — wave (c) re-seeds the demo to fit the
   grown default sizes (SELECT 3×2, speech rows).

## Implementation order (sequential, same branch — files overlap)

- **Wave A** — grammar foundations: tokens, jacks + teach-on-drag, chip
  taxonomy, type ladder, card shell, state words, anchored feedback.
  Scope: lib/* + workbench chrome, per 04 §replaces tables.
- **Wave B** — part faces + settings popovers per 05 (incl. renames,
  coercion word-labels, size-shedding, sibling disambiguation).
- **Wave C** — journey surfaces per 06: right-panel page + THE RUN,
  pack staging ghost + halo frames, lint notices row, nav truth,
  demo re-seed.
- Each wave: worker verifies in browser, commits in logical chunks.
- **Gate after C** (and spot-gate after A): fresh-eyes browser review
  (builder ≠ reviewer) + codex cross-vendor code review → verdicts in
  `08-review-verdicts.md`; fail → rework or kill.
