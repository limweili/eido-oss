# Within-Card Virtualization / Content-Visibility Candidate (#404)

Status: **terminally rejected; executable candidate and dedicated evidence workflow retired by #597.**

## Evidence lineage

- Exact implementation base: `b72316f996a274475b95aff9277dd1b19437efb0`.
- B control: **not captured**.
- C candidate: **not captured**.
- Local Chromium was deliberately not retried: Chromium cannot launch on the managed Mac; provider execution belongs to the supervisor after review.
- No historical #402/#403 timing is relabelled as #404 evidence.

This file is retained as decision archaeology. The former issue-specific workflow accepted only an atomic **candidate-ineligible** bundle after B control, C's machine-readable negative result, C observation, trusted lineage, correctness, and privacy gates all passed. The candidate was non-selectable: `architectureSelectable: false`. Issue #597 removed that executable branch, its feature flag, and its dedicated capture/publication machinery; ordinary rich DOM is now the only within-Card rendering path.

Under the retired evidence contract, accepted B/C had to share the provider run URL, run attempt, job identity, exact head, stable synthetic-fixture digest, stable choreography digest, runner, viewport, and Chromium build. The candidate also had to carry direct provider observations for passive-visible, passive-off-internal, and live states across the Note, Conversation topic, Result, follow-up, and transcript regions.

## Candidate semantics

The candidate used CSS `content-visibility: auto` on semantic Markdown blocks, follow-ups, and transcript messages, with `contain-intrinsic-block-size` for passive chunks. It **retained and eagerly constructed the DOM**. It could let Chromium skip off-internal-viewport layout and paint; Chromium exposed no authoritative per-element “actually skipped” bit, so the retired harness recorded materialized chunks, passive-auto chunks, live-eager chunks, and off-internal-viewport skip-eligible chunks separately. This was not a DOM-reduction claim.

## Current conclusion

ADR 0023 records three correctness failures from the candidate evaluation: scroll drift, live-to-passive re-entry drift, and first-intent retargeting. They made the candidate ineligible and non-selectable; no timing result could override them, but the provider B/C evidence bundle described above was never captured. Issue #597 subsequently removed the candidate from runtime rather than retaining a disabled alternative. No equivalent content-visibility alternative remains open; any future work needs a distinct architecture and evidence contract. The candidate did not optimize images, alter stored image references, or claim #413 rendition evidence.
