# Living Retro — Epic #749: Text-heavy Board performance

Canonical specification: [#749](https://github.com/limweili/eido/issues/749).
Grounding report: [Epic #570 founder review](../../reports/2026-07-22-epic-570-founder-review.html).
Field-repair review: [Canvas ownership founder review](../../reports/2026-07-23-epic-749-canvas-ownership-review.html).
Delivery lineage: [Epic #410 rich-card rendering](../2026-07-14-epic-410-rich-card-rendering/RETRO.md).

> **Living record, not a completion report.** The founder authorised landing
> without another manual gate. The merged train and starvation repair now have
> exact-main Required proof through `6ed9a0f`. The canvas-ownership repair is
> open as [PR #807](https://github.com/limweili/eido/pull/807); its pre-follow-up
> `dab2dad` head passed Required run `29949717795` and Browser run `29949717547`.
> Exact-head checks must rerun after any amendment. Browser timing, fast-pan
> behavior, and perceived fluidity remain unmeasured by agents.

## Delivery state

| Slice | State | Evidence boundary |
| --- | --- | --- |
| [F1 #751](https://github.com/limweili/eido/issues/751) / [PR #779](https://github.com/limweili/eido/pull/779) | Landed as `6252f77` | Deterministic synthetic 30-Note fixture and cheap structural assertions; browser/timing/feel not measured. |
| F0 support [#782](https://github.com/limweili/eido/issues/782) / [PR #784](https://github.com/limweili/eido/pull/784) | Landed as `b908d53` | Rejected cached-passive modules compile out of the default production bundle; explicit experiment builds remain available. |
| [F3 #753](https://github.com/limweili/eido/issues/753) / [PR #787](https://github.com/limweili/eido/pull/787) | Landed as `1c7edf5` | Cold `P` applies the 300,000-unit text-weight ceiling; overflow remains painted `S`; independently owned `L` remains exempt. Focused planner/painter proof passed before merge. |
| [F4 #754](https://github.com/limweili/eido/issues/754) / [PR #780](https://github.com/limweili/eido/pull/780) | Landed as `3f3883d` | Exact scene look-ahead keys feed idle, single-flight rendition prewarm under unchanged budgets. Focused lifecycle proof passed before merge. |
| [F5 #755](https://github.com/limweili/eido/issues/755) / [PR #791](https://github.com/limweili/eido/pull/791) | Landed as `7ba60f6` | Device-local, default-off packaged numeric counters; focused UI, privacy, type/build/bundle, and Required proof passed before merge. |
| Founder starvation repair [PR #803](https://github.com/limweili/eido/pull/803) | Landed as `6ed9a0f` | Cold residency skips individual oversize blockers and uses a 600,000-unit ceiling; exact-main Required run `29947015436` is green, while founder-felt performance remains manual. |
| Canvas ownership repair [PR #807](https://github.com/limweili/eido/pull/807) | Open; implementation `7376b44`, review baseline `dab2dad` | Required run `29949717795` and Browser run `29949717547` passed on `dab2dad`; amendments require fresh exact-head proof before merge. |
| [F7 #757](https://github.com/limweili/eido/issues/757) | Landed closeout; ready for human | Composed broad compatibility passed 8 files / 49 tests and exact-main Required run `29942658890` is green; the issue remains open for the packaged founder verdict. |
| [F2 #752](https://github.com/limweili/eido/issues/752) | Deferred backlog | Content-visibility body bounding remains unimplemented. The separate viewport-local oversize pool is an ownership repair and did not reactivate F2. |
| [F6 #756](https://github.com/limweili/eido/issues/756) | Deferred backlog | Motion-scoped painted demotion remains unimplemented; this ownership repair did not reactivate it. |

## Evidence boundary

Agents reuse the existing planner, rendition, semantic-copy, accessibility,
and persistence authorities. They do not create or run visual-feel,
high-speed pan/zoom, FPS, timing, or performance tests for this closeout. The
F1 browser probe and every diagnostic timing signal remain `not-measured`.
The final broad compatibility selection passed 8 files / 49 tests under Node
v24.12.0 and npm 11.6.2 on the source composition at `7ba60f6`, covering the
synthetic fixture, saved-graph search/copy, keyboard/focus continuity, and
load/save/reload/export authority. Exact-main Required then passed on `8c5dc29`
(run `29942658890`) and again after the 600,000-unit starvation repair at
`6ed9a0f` (run `29947015436`). PR #807's ownership implementation at `7376b44`
has local unit, type, design-system, and marquee-interaction proof. Its review
baseline `dab2dad` passed hosted Required run `29949717795` and Browser run
`29949717547`; any amended head must re-earn those exact-head gates.

## Friction and decisions

- The epic body still described F2/F6 as active after the founder deferred
  them. Reading the live amendment before dispatch prevented work on the wrong
  frontier.
- The F4 audit premise was partly stale: passive rendition purposes already
  had production consumers. The real remaining gap was exact look-ahead to
  idle prewarm, so the slice narrowed rather than duplicating policy.
- F4 exposed a real default-bundle failure. F0 removed the rejected candidate
  from ordinary production instead of raising the budget or weakening proof.
- Independent review caught missing counter/lifecycle cases and kept F5's
  packaged surface numeric-only, read-only, and identity-free.
- Founder testing exposed strict-prefix starvation directly in those counters:
  one oversize Card stopped at 120,363 of 300,000 units and hid 13 later tiny
  Cards until hover. The #803 repair keeps the historical tier/hysteresis
  order, skips only weight misses, and raises the cold ceiling to 600,000;
  perceived performance remains founder-owned.
- The same mixed Reading ownership exposed two old single-plane assumptions:
  marquee availability required every visible Card to be DOM-mounted, and the
  motion underlay painted a second Card border. The repair unions `P ∪ O ∪ L`
  and `S` marquee geometry while making the mounted silhouette fill-only. A stale
  selected-stroke browser gate was retired; deterministic painter recording
  owns the geometry proof and pixel feel stays with founder testing.
- The founder's 609,000-unit Card was just over the raised ordinary ceiling but
  still unreadable at rest. Exact-visible Cards above that ceiling now enter a
  separate 10-Card native pool, share the 540-Card count, and never preload or
  retain offscreen. The suggested 100-Card cap would permit at least 60 million
  units of rich DOM; the next rung waits for a real founder verdict on 10 giant
  Cards in one viewport.
- Replacing the fixed 20,000-unit image-asset heuristic with a rendition-aware
  cost and counting Result follow-up/transcript text remain nonblocking
  follow-ups; neither was widened into this ownership repair.

## Optional founder field follow-up

On the exact packaged build produced after the ownership-repair PR lands:

1. Open the founder's roughly 30 auto-sized long Notes in one Reading viewport.
2. Confirm no counter panel appears by default. Open Settings → Board →
   Performance and enable **Show counters**.
3. Observe total Rich, Passive, oversized-visible, and limit-exempt Live Cards;
   Board/ordinary/oversize text weight and demoted count; scene/metric counters;
   and rendition entries/bytes while creating or pasting a long Note,
   panning/zooming, settling, and revisiting image Cards.
4. Check at-rest readability plus whole-Board search, copy, and keyboard focus.
   Explicitly try touch/stylus or a mouse press on a descendant link, control,
   or caret with no prior pointer movement: F3 cannot replay that first intent
   while its painted `S` Card promotes to `L`.
5. Record **fluid** or **not fluid**, any counter observation that explains the
   result, and whether the 10-Card oversize cap needs evidence-led tuning. Keep
   #752/#756 deferred unless a new finding maps directly to their mechanisms.

No agent opens or inspects the founder's real Profile for this handoff.

## Adopted rules

- Re-read live scope amendments before dispatch; issue bodies can lag decisions.
- Re-derive audit premises from current source before implementing them.
- Compile rejected experiments out of ordinary production rather than paying
  their bundle cost indefinitely.
- Keep structural automation and founder-felt acceptance separate and label
  every unmeasured signal honestly.

#757's exact composed proof is recorded above. #749 and #757 remain open for
the final packaged founder verdict on the repaired ownership boundary.
