# Epic #300 Retro: Zoom Bands Rework

## Outcome

The epic replaced board-class rendering patches with three viewport-derived detail bands: Reading, Overview, and Map. Reading owns visual DOM cards; Overview and Map use canvas representations, with bounded zoom-pure crossfades between adjacent bands. A screen-space label layer now preserves readable names through explicit priority and collision rules. Card selection, dragging, connecting, and connection-badge editing work across every band through painted hit geometry and bounded invisible gesture proxies. Visual decay and its opacity coupling were removed; intent signals and the intent log remain intact.

## What we learned

The epic's original performance premise was wrong. The removed freshness projection was O(cards + events) on the edit path, not the last order-of-board operation on interaction frames. The real navigation-path offender was `createBoardScene`'s `cardSummaryKey`, which serialised all board text on every pan. `summaryComputations` still reported zero because it counted only the summary body, not the expensive key construction in front of it. A counter that guards the wrong half of a function is worse than no counter: it gives a precise-looking false assurance and delays inspection of the unmeasured work. Counters now cover scene derivations, card-metric visits/full rebuilds, cap omissions, and label outcome identities at the actual seams.

Adversarial review rounds materially improved the result. Cross-vendor reviews caught false density-cap accounting, gates that could not go red, a constructed 32-bit hash collision, O(board) work still occurring on interaction frames, and C3's below-window escape hatch. The pattern was consistent: executable claims needed a deliberately failing control or invariant identity, and performance claims needed counters around the complete operation rather than the intended fast half.

The sharpest catch came last, and it generalises. C5's fixture for "a painted card over a badge wins the press" asserted the store outcome after a real mouse click — and passed for the wrong reason. A real click first emits a pointer move that arms the hover gesture proxy, so the press can be taken either by the proxy's node body (React Flow selects the card) or by the pane handler (the painted-card hit test selects the card). Both paths leave *identical* store state, so the assertion could not have failed even if the pane resolver had started preferring badges over cards. The rule: **when two code paths can produce the same observable outcome, an outcome assertion cannot gate which path ran** — address the path directly. The fixture now dispatches at the pane element, removing the proxy from the picture, and was proven red by reversing the resolver order.

One process note worth keeping. A worker died mid-slice when its model hit a usage limit, and the reflex — redispatch from scratch — would have thrown away a complete fix round. A worktree is just a directory: a dead agent leaves its edits sitting in it. Re-derive with `git status` in the worktree *before* assuming loss. In this case the dead worker had in fact landed every fix, while its last message claimed it was still mid-task; the agent's self-report understated its own progress. Trust the tree, not the transcript.

## Delivery and verification

Orchestration moved from omnigent/Multy to Claude Code on 2026-07-13. That harness switch happened during the epic endgame; it did not change the contracts or ownership boundaries. The owner waived the heavy browser and performance suites for the final landings, while retaining CI and slice-specific static proofs.

Timing measurements remain deferred. By founder ruling on 2026-07-11, timing gates are not hard gates on this host: noisy captures would create false confidence rather than a trustworthy baseline. Fresh captures are deferred to a quiet host, with the follow-up tracker item filed at epic close.

## Keep

- Derive one global viewport band and keep pointer state out of the cold scene.
- Treat invisible `gestureProxy` nodes as interaction mounts, never visual card mounts or painter suppression inputs.
- Share paint and hit membership through pure geometry/planning functions, and count every planned omission.
- Require adversarial gates to demonstrate that they fail for the defect they claim to catch.
