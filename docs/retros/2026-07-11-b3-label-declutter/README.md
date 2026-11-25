# B3 label declutter — acceptance screenshots (#311, PR #339)

Dense-board panning band captured in the real app at head `f3a256f`, for the
[MANUAL] taste gate: the B2 colliding-label wall reading as a calm
decluttered field.

## Capture conditions

- Head: `f3a256f735c23c3a91d12d3ce26a41f2362e792c`, dev server on a scratch
  save (`EIDO_DATA_FILE`, under the then-current legacy JSON safety rules; real save
  untouched).
- Capture-lock window 2026-07-11T03:54:16Z → 03:59:29Z. Quiesce rule
  (amendment 11): load averages 2.81 / 3.23 / 3.48 at start (15-min 3.48 ≤
  3.9; 1-min 2.81 ≤ 3.48 × 1.25), 3.16 / 3.36 / 3.48 at end.
- Fixture: deterministic (seed 311) 34×33 = 1,122-card board — past
  `MASSIVE_BOARD_CARD_COUNT`, so the canvas paints the field — mixed
  user-authored/system-generated titles, plus a pinned group region.
  Viewport 1280×800, zoom 0.35 (mid Overview band), panned by 0 / 4 / 150 /
  300 screen px.

## Frozen-counter readings per frame (identity holds on every frame)

| pan(px) | eligible | drawn | ramped | dropped | drawn+ramped+dropped | cache misses |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 301 | 133 | 26 | 142 | 301 | 0 |
| 4 | 301 | 133 | 26 | 142 | 301 | 0 |
| 150 | 332 | 138 | 23 | 171 | 332 | 0 |
| 300 | 346 | 145 | 16 | 185 | 346 | 0 |

The 0px and 4px frames read identical counters and pixel-identical labels
(modulo the 4px shift) — the digest-stability property, live. Zero cache
misses across the whole pan: every painted label blits a warm bitmap.
