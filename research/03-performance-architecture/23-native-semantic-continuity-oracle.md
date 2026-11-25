# Native-Semantic Continuity Oracle for an Extreme Card (#1153)

Status: **ARCHIVED — DELETE for adoption (#1157); oracle retained as durable decision evidence.**

This is the source-grounded contract for the disposable Chromium soft-containment
investigation owned by [#1152](https://github.com/limweili/eido/issues/1152).
It never chose a CSS primitive, changed production behavior, or revived a
second renderer. The investigation is now resolved: [#1157](https://github.com/limweili/eido/issues/1157)
selected DELETE, and [#1168](https://github.com/limweili/eido/issues/1168) removed
the four repository-owned #1156 experiment artifacts. This note preserves the
oracle and its durable evidence so the rejected seam is not reopened.

## Decision in one sentence

The candidate would have been admissible only for one exact-visible, individually
oversized, fixed-height, inactive Card whose complete native DOM remained mounted.
Every semantic, geometry, focus, or owner uncertainty failed open to the ordinary
rich renderer. The Card-root negative control passed its observed arms, but the
mandatory headed/native Find gate was not measured; no lawful same-DOM mechanism
therefore earned adoption. #1157's binary disposition is **DELETE**, not an open
BLOCK as a fatal adoption gate; more stress proof cannot repair the missing
headed/native Find observation or create a lawful candidate.

## Current production closeout (2026-08-21)

This archived oracle is not the production renderer decision. The adopted path
retains one complete native Card DOM for every resident Card kind; the proposed
soft-containment, own-drag blank/fade, and gesture raster-cover candidates are
rejected or deleted. Selection authorizes editor entry only after the shared
click/drag threshold; once focused, an editor survives dragging another Card and
ends only on real blur, a tool/scope change, or a stationary click on another
Card. Scroll continuity is a separate true LRU keyed by `(Idea id, Card id)`.

The current motion authority uses raw paired `AB` and `BA` control/stress runs.
Stress max is compared with the same-run short-control envelope
`max(control max + 2 cadence + 2, control max × 1.5)`, with corresponding
control-relative p95, missed-frame, long-task, and completion bounds. The old
absolute host maximum and strict `<50 ms` candidate condition remain historical
rejection gates only; neither is an adopted absolute host cutoff. Packaged drag
persistence captures after the released geometry paints, with coalescing and
checkpoint flush preserving the latest exact state.

For native browser toolbar Find, the complete mounted DOM is the inherited
authority; it is not independently automated in the current browser evidence.
The `window.find` checks are DOM smoke only, not toolbar automation, and Board
Search remains the explicit product route for unmounted content.

## Contract being tested

ADR 0023 separates viewport visibility (`V`), cold rich residency (`P`), exact
visible oversize residency (`O`), additive Live owners (`L`), editors (`E`),
gesture/proximity producers (`G`), and the Board-wide safety representation
(`S`). Rich DOM is `P ∪ O ∪ L`; `E` is already inside `L`, `G` is not rich DOM,
and Live owners are not capped by the proxy limit ([ADR 0023](../../docs/adr/0023-buffered-passive-cards-and-hover-activation.md)).
While mounted, native DOM remains the hit, focus, selection, scroll, media,
browser Find, and accessibility authority; motion-only visibility suppression,
within-Card virtualization, and a DOM-to-canvas overlay are explicitly not used
([ADR 0023](../../docs/adr/0023-buffered-passive-cards-and-hover-activation.md)).

The motion reconciliation is especially important: geometry must stay on the
shallow React Flow plane, semantic subscriptions must exclude position and
stacking, and crossfade opacity must be non-inherited ([ADR 0023](../../docs/adr/0023-buffered-passive-cards-and-hover-activation.md)).
The existing code expresses that boundary in `memoCardNode` ([source](../../src/canvas/memoCardNode.tsx)) and the geometry-isolation tests
([unit authority](../../src/canvas/cards/CardGeometryIsolation.test.tsx)).

The rejected soft-containment candidate could have skipped browser paint only if
it did not become a new semantic or rendering authority. A passing result would
have been an observed browser optimization around the existing DOM, not permission
to hide, detach, truncate, replace, or mirror the Card. No such production
mechanism remains.

## Canonical fixture and lifecycle

The deleted #1156 probe used one deterministic synthetic fixture for all
correctness arms:

1. One fixed-height Note is exact-visible and individually oversized (`text
   weight > 100,000`), with exactly 1,000,000 user-content characters. Put
   unique sentinels at the beginning, deep middle, and final text position;
   include multiple Markdown blocks, a same-tab Card link, an external link,
   and ordinary native controls in the shell. The complete content must remain
   connected; no helper may truncate, detach, replace, restyle, or add a
   semantic reservoir. `giantNoteSelection.browser.test.ts` is the closest
   existing fixture and already constructs exactly 1,000,000 Markdown
   characters ([source](../../src/canvas/giantNoteSelection.browser.test.ts)).
2. The body is deeply scrollable. Record the body and semantic-root element
   identities, Card and body bounds, `scrollTop`, `scrollLeft`, both max offsets,
   `scrollHeight`, `scrollWidth`, `clientHeight`, `clientWidth`, and a visible
   paragraph anchor (text plus its top offset relative to the body).
3. Warm the ordinary and candidate arms with the same viewport, Card geometry,
   browser build, and gesture choreography. The candidate arm starts inactive:
   no selected Card, focus, editor/IME, native selection, internal scroll,
   gesture, active media, streaming state, or other Live owner. The card is
   exact-visible and fixed-height. The test must record the candidate's
   eligibility decision without making that decision from a per-frame text scan.
4. Run the candidate through pan, zoom, candidate enter/exit, and release. Take
   the continuity snapshot at every boundary (before, first transition frame,
   steady state, release, and post-release), not only at the end.
5. Run each unsupported condition independently, repeating promotion and
   fail-open cycles. The ordinary renderer must remain the only visible and
   semantic owner whenever a condition is unsupported.

The existing long-Card performance fixture already proves useful completeness
infrastructure: it checks exact state text lengths, terminal follow-up and
transcript content, connected root identity, scroll offsets, Card bounds,
visibility, scrollability, and destructive instrumentation markers
([assertCompleteFixtureArm](../../src/performance/longResultMotion.perf.ts)).
It is not by itself this oracle: its stress arm is a multi-Card motion fixture,
not a browser-semantic interaction matrix for one extreme Card.

## Observable invariants

Each row below is a binary gate. “Not measured” is **BLOCK**, never a pass by
inference from a nearby test.

| Area | Observable invariant and smallest probe | Existing authoritative evidence | PASS / BLOCK |
| --- | --- | --- | --- |
| Scroll geometry and anchor | The same Card, body, and semantic-root objects remain connected. Card/body width and height, scroll dimensions, and exact offsets do not change by more than 1 CSS pixel for same-DOM candidate transitions. The sentinel paragraph remains the same text at the same body-relative anchor offset. A same-surface remount may use the existing exact-offset retention; only a passive/editor representation change may use relative retention. | `cardScrollRetention.browser.test.ts` records `scrollTop`, max offset, anchor text, and anchor offset, and checks repeated drags plus residency exit/re-entry. `cardEditing.browser.test.ts` covers Note, Ask AI, and Conversation relative restoration. | Any offset, max, dimension, anchor, identity, or first-frame drift is BLOCK. A candidate that changes intrinsic scroll geometry (including a spacer/intrinsic-size approximation) fails. |
| Native selection | Mouse-select a range spanning two complete Markdown blocks, assert the exact selected text and that Card transform/position is unchanged. Repeat after candidate entry/exit and a pan/zoom. Selection must remain a browser Range inside the mounted root; no custom selection model may replace it. | `resultFollowUp.browser.test.ts` preserves the Card transform during follow-up selection; `highlightConfine.browser.test.ts` confines and saves cross-Card highlight selection; `keyboard.test.ts` leaves visible text selection to native copy. | Empty, retargeted, clamped-to-wrong-node, or lost selection is BLOCK. Selection that works only after a second click is BLOCK. |
| Native copy | With the giant root selected, press the platform copy shortcut and read the real clipboard. It must equal the selected text exactly, including newlines; the logical Board-copy route must not intercept it. Repeat after motion while the Range remains active. | `resultFollowUp.browser.test.ts` covers exact Result and follow-up button copy; `markdownClipboardRoundTrip.browser.test.ts` covers full Markdown copy/paste; the keyboard unit proves routing but not giant native clipboard bytes. | No giant same-DOM native-copy assertion existed for the discarded candidate. Any clipboard mismatch, interception, or permission-dependent “sentinel” pass would have been BLOCK for #1156; the missing gate was not a reason to extend the experiment after #1157. |
| Trusted links and controls | Click a same-tab Card link, external link, `_blank` link, file/media/control target, and shell control. Each native event must reach its original target once; no synthetic replay or delayed retargeting. `_blank`, file, media, and modifier-click uncertainty must fail open to the ordinary complete DOM. | `markdownLinks.browser.test.ts` covers passive/edit link URL, appearance, compact editor, keyboard focus, and unsafe-link behavior; `cardLinkNavigation.browser.test.ts` covers Card-link navigation and Back; `giantNoteSelection.browser.test.ts` covers the release-gated giant drag and no-editor path. The rejected raster candidate and its trusted-target runtime were deleted; the ordinary native Card path remains the sole event owner. | Any duplicate, consumed, replayed, or retargeted event is BLOCK. Candidate eligibility must be withdrawn before an uncertain target is activated. |
| Caret and editor intent | One stationary click on the complete body opens the actual editor at the clicked caret, with the same first click carrying typing intent. Pointer travel beyond the shared 5 px threshold selects/moves without mounting an editor. A focused editor survives dragging another Card and ends only on real blur, a tool/scope change, or a stationary click on another Card. Candidate entry/exit must not move the caret or mount a competing root-end selection. | `giantEditableCardIntent.browser.test.ts` covers Ask AI and Conversation first-drag versus stationary-caret journeys; `cardEditing.browser.test.ts` covers the Note first-click handoff, identity, focus, contained selection, and typing intent; `cardInteraction.ts` owns the click-intent decision without synthetic replay. | Any second-click requirement, root-end caret, editor mount during drag, or lost IME/selection is BLOCK. |
| Browser Find | With the same complete DOM mounted, find the start, deep-middle, and terminal sentinels using Chromium’s native Find path. The found Range/active match must resolve to text inside the same semantic root after candidate entry, pan, zoom, and exit. The body must not be `display:none`, `visibility:hidden`, `content-visibility:hidden`, detached, or replaced. Board Search is not a substitute: it is the product route for unmounted content. | Production retains complete visible native DOM through motion. #1166 records `window.find` smoke across the giant-card journeys, but not independent browser-toolbar automation. The toolbar is inherited from the unchanged mounted DOM; `boardSearchPanel.browser.test.ts` reaches an off-window Card and focuses the exact Card. | The deleted #1156 probe could not observe the required headed/native path, so that candidate gate was BLOCK and #1157 selected DELETE. Do not describe `window.find` smoke as toolbar proof. |
| Highlights | In Highlight mode, the native Range stays confined to the Card, the exact marker/occurrence is saved, the painted `<mark>` remains visible inside links/quotes, and the Card does not pan or move. Repeat after candidate exit and re-entry. | `highlightConfine.browser.test.ts` covers cross-Card confinement and release; `highlightPainter.test.ts` covers selection clamping and semantic ink cascade; `resultFollowUp.browser.test.ts` covers Result and follow-up highlighter journeys. | No 1M same-DOM highlight journey exists. Wrong occurrence, cross-Card text, lost mark, or canvas movement is BLOCK. |
| Focus and keyboard | The focused Card/control element identity and `document.activeElement` survive candidate transitions and motion. Tab remains within the real controls in order; Enter/Space activates the focused native control once; Escape follows the current owner/recovery contract; Delete/Backspace do not delete while an editable has focus. | `cardFocusOwnership.test.tsx` waits for an exact Card mount and recovers the Board without stealing replacement focus; `Board.controlledNodes.test.ts` covers mounted Card groups and proxy exclusion from AT/keyboard traversal; `boardSearchPanel.browser.test.ts` focuses a far Card; `cardEditing.browser.test.ts` covers editor focus retention. | Any focus loss, focus steal, hidden proxy focus, duplicate activation, or keyboard command leak is BLOCK. |
| Accessibility | Before and after candidate transitions, Chromium’s AX tree exposes the same named Card group, role/roledescription, title, links, controls, and selected state. The semantic body is not `aria-hidden` or inert. `G` proxies remain aria-hidden and unfocusable; they cannot become a second AX or hit owner. | `cardAccessibility.test.ts` handles untitled 1M/high-block-count Cards without rescanning on geometry; `Board.controlledNodes.test.ts` asserts controlled-node role/name/focusability and proxy exclusion; `CardShell.tsx` provides the native Card frame, controls, children, and connectors as ordinary HTML. | Any AX node disappearance, name/role drift, `aria-hidden`/inert semantic body, proxy focus, or duplicate AX tree is BLOCK. No DOM role query alone proves the complete tree; use Chromium AX inspection or mark the gate not measured. |
| Streaming | A concurrent Result stream appends a chunk and keeps the streaming indicator/status and terminal content correct. A reader scrolled away from the end stays at its exact position; a reader at the end follows the stream. The giant candidate target’s DOM identity, anchor, and scroll do not change. A streaming/actively changing Card is Live/unsupported and must not receive soft containment. | `resultFollowUp.browser.test.ts` covers follow-up streaming, composer usability, and reader position; `ResultComposition.test.tsx` covers streaming indicators, settled-action suppression, late links, and follow-to-end versus reader ownership. | Any stale stream, scroll steal, missing terminal content, candidate activation on a streaming/Live Card, or unrelated giant-root churn is BLOCK for #1155. |
| Multiple Live owners | Owners are additive by reason and by Card: selected, editing, hover/activation, focused, scrolling, gesture, and media owners each pin their Card; releasing one reason cannot evict a Card held by another. There is one rich DOM owner per Card and no arbitrary one/five-card cap. | `cardInteraction.test.ts` covers the owner snapshot vocabulary, individual reasons, independent release, and below-Reading disablement; `boardScene.test.ts` covers an off-window owner mounting as a full Card and preserving node collections. | No browser test currently combines the giant candidate with a streaming Result, editor, focus, selection, scrolling, and media owners. Any owner cap, eviction, duplicate mount, or release-order failure is BLOCK for #1155. |
| Unsupported-state fail-open | For each unsupported condition—offscreen/not exact-visible, non-fixed or unstable geometry, unknown Card kind/content, any focus/selection/edit/IME/native Range, internal scroll, pointer gesture, active media, streaming/execution activity, modifier/popup/file intent, browser primitive unavailable, or uncertain AX/paint state—the candidate is disabled and the ordinary complete rich DOM remains visible, connected, selectable, findable, focusable, and accessible. | ADR 0023 defines additive Live pins and the safety representation; `cardInteraction.test.ts` covers disabled owner state; native Card browser journeys keep uncertain interaction on the ordinary complete DOM. The rejected raster candidate, readiness seam, and trusted-target runtime were deleted with no production replacement. | Any candidate attempt under an unsupported condition, blank/hidden semantic body, lost native behavior, or silent uncertainty is BLOCK. Add one browser probe per condition family; do not infer the matrix from the owner unit alone. |
| Transition timing | The deleted candidate required a strict `<50 ms` transition condition and no longtask entry, but the adopted native path uses raw paired `AB` + `BA` control/stress runs. Stress max is bounded by `max(control max + 2 cadence + 2, control max × 1.5)` with control-relative p95, missed-frame, long-task, and completion bounds; the old absolute host maximum is not a production cutoff. | `longResultMotion.perf.ts` owns the pan, zoom, Note/Result/Conversation drag arms, and paired control-relative comparison; the deterministic 1M fixture contract is covered by `perfFixtures.test.ts`. | The deleted soft-containment candidate showed no exact-visible skipped state or material win, and headed/native Find was not measured. Its strict candidate gate remained BLOCK and #1157 selected DELETE; the adopted native path is judged by the raw paired envelope. |
| Complete DOM proof | Every arm checks exact state character counts, start/middle/end sentinels, terminal result/follow-up/transcript content where present, same Card/body/root identities, no destructive probe markers, and the same shell bounds. Content verification must be outside the motion loop; no helper may “prove” completeness by detaching or replacing the thing being measured. | `assertCompleteFixtureArm` in `longResultMotion.perf.ts` rejects detached, truncated, replaced, hidden, restyled, disconnected, non-scrollable, identity-changed, or bound-changed roots; the deterministic fixture contract lives in `perfFixtures.ts` and its unit test. | Missing any sentinel, changed root, destructive marker, or fixture/helper mutation is BLOCK even if the timing arm is green. |

## Unmeasured probes that made #1156 BLOCK

The decision contract identified one vertical browser oracle, not a new test
framework. The following gaps remained in the deleted #1156/#1155 experiment;
they are retained as evidence of why the branch was BLOCK, not as authorization
to reopen or extend it:

1. **Giant native copy probe (not measured).** In the exact 1M Note, the missing probe would have selected a known multi-block range and copied through the platform shortcut. Logical Board copy tests do not cover giant native clipboard bytes.
2. **Native Find probe (partially measured).** The deleted probe exercised the automatable native `window.find` path but could not inspect Chromium Find in a supported headed path. It recorded **not measured** and blocked rather than substituting Board Search. Current production inherits toolbar Find from unchanged complete visible DOM; no independent toolbar automation is claimed.
3. **AX continuity probe.** The probe captured diagnostic AX slices; a full Chromium accessibility-tree continuity assertion would have been required for adoption. Existing role-query checks are not the sole proof.
4. **Giant highlight probe.** A full Highlight-mode journey on the extreme DOM remained unmeasured; existing selection confinement and painter coverage are preserved as ordinary production evidence.
5. **Focus/intent probe.** Focus a native control and then the body/editor at an exact caret; run Tab, Enter/Space, Escape, and a >5 px drag. Assert element identity, one activation, caret offset, and no editor mount on drag. Include `_blank`, file, media, and modifier targets as fail-open arms.
6. **Fail-open matrix probe.** A browser matrix for each unsupported condition remained unmeasured. The current owner unit and native interaction journeys are policy evidence; no deleted candidate test is treated as browser proof.
7. **Concurrent Live probe (#1155).** The concurrent-owner scenario belongs to ordinary production proof (#1167), not a soft-containment adoption path. No candidate promotion/fail-open cycle remains to run.
8. **Strict timing assertion (#1156).** The deleted probe reused the warm-up and phase recorder and measured the paired arms; its exact-visible Card-root arm produced no material win, while the mandatory headed/native Find gate remained not measured. Middle-of-gesture smoothness could not override that BLOCK. The adopted native path instead uses raw `AB` + `BA` control-relative envelopes; the old absolute max and `<50 ms` gate are historical candidate criteria only.

## Recorded adoption gates for #1156 (not met)

### PASS

All of the following must be true on the same supported Chromium/Electron build:

- The 1M exact-visible fixed-height Note is the only eligible candidate. Its complete native DOM, shell, links, controls, and semantic roots remain connected with one identity per root; start/middle/end sentinels and exact state lengths survive every measured arm.
- Same-DOM geometry and anchor snapshots pass at every transition. No scroll dimension, exact offset, Card bound, or anchor offset changes beyond the stated 1 px observation tolerance.
- Native selection, exact clipboard copy, trusted link/control activation, caret placement, browser Find, highlights, focus/keyboard, and AX probes all pass. Any probe that cannot be observed is not a pass.
- Pan and zoom stress are paired with the short control using the existing phase recorder. Every boundary, steady, release, and post-release frame interval was `<50 ms` for the deleted candidate gate; adopted production acceptance uses the raw `AB` + `BA` control-relative p95/max/missed/long-task/completion envelope instead of an absolute host maximum.
- The candidate is disabled for every unsupported arm and the ordinary complete renderer remains the only semantic/hit owner. No hidden, blank, detached, truncated, mirrored, or synthetic path appears.

### BLOCK

One failure is enough for the deleted candidate: semantic or AX loss; Find/copy not measured; changed geometry/anchor/identity; any `>=50 ms` transition or longtask; missing sentinel; candidate activation while any owner or uncertain state exists; synthetic/replayed trusted intent; or inability to establish a reproducible supported browser run. A timing win cannot override a correctness failure. This follows the retired content-visibility decision in [the research archaeology](17-within-card-virtualization-candidate.md). It is not the adopted renderer's absolute host cutoff.

## Recorded concurrent-owner gates for #1155 (separate production proof)

### PASS

- The giant Card remains ordinary complete native DOM whenever it has a focus, native selection, editor/IME, internal-scroll, gesture, active-media, streaming, or other Live owner. It never becomes a candidate merely because it is oversized.
- Streaming Result content and status remain correct; a reader away from the end keeps its position, while an end-pinned reader follows the stream. The giant Card’s identity, geometry, and anchor remain stable.
- Multiple selected Cards, an editor elsewhere, a focused control, body scrolling, and media all coexist as additive owners. Releasing hover, focus, selection, or another reason removes only that reason; no unrelated Card is evicted and no arbitrary Live cap appears.
- Every promotion and fail-open cycle restores the same native interaction matrix and strict timing gate. There is one rich DOM root per Card and no duplicate canvas/DOM hit authority.

### BLOCK condition retained for the record

Any candidate activation on a Live/streaming/uncertain Card, owner eviction or cap, stream scroll theft/staleness, editor/caret/focus loss, duplicate mount, semantic blanking, trusted-intent failure, or any strict timing failure would block #1155. “The stream still runs” is insufficient if the reader’s anchor, focus, AX tree, or owner lifecycle changes. The soft-containment branch is already deleted; ordinary concurrent-owner proof remains #1167.

## Durable evidence and final conclusion

The repository has strong production seams and archived candidate evidence:

- Geometry isolation, memo identity, scroll retention, release-gated editing,
  links, highlights, focus ownership, Board Search, streaming, and additive
  owner policy each have authoritative tests listed above.
- `longResultMotion.perf.ts` now has the paired `AB`/`BA` fixture, phase model,
  control-relative envelope, and completeness checks. #1166 records the final
  giant native suites and the explicit boundary that `window.find` smoke is not
  headed/browser-toolbar automation; toolbar behavior is inherited from the
  unchanged complete visible DOM.
- The archived candidate still lacks independent headed/native toolbar Find
  observation, giant native clipboard bytes, full Chromium AX continuity, giant
  highlight continuity, and a browser-level unsupported-state fail-open matrix.
  Those omissions preserve DELETE for #1156; they do not reopen a candidate.

Therefore the oracle remains durable evidence rejecting soft-containment adoption:
the required headed/native Find observation was not measured, the exact-visible
Card-root arm showed no material win, and the binary #1157 decision selected
**DELETE**. #1168 removed the #1156 fixture, runner, partial evidence, and
disposable decision note. The ordinary native renderer and additive-owner proof
remain the production path; no soft-containment mechanism, own-drag blank/fade,
gesture raster cover, flag, or second renderer is pending.
