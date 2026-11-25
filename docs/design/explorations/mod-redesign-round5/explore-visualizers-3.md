# Mod workbench — visualizer set, third pass (the no-cap round)

Design exploration, 2026-07-16. Concept only — no implementation.
Builds on: `explore-visualizers.md` (contract + first-pass specs),
`explore-visualizers-2.md` (exhaustion argument, STEPS spec, three failure
categories), `explore-round5-primitives.md` (ORDER/MIXER/SELECT/GROUP
VOICE + category-4 item identity), `explore-controllers.md` (STAGE, curve
POSITION jack, steps, FORK/REVISE, THE PLAN strip), `round5-synthesis.md`.

Mandate change (weili): **the 10-viz cap is removed.** "Keep adding."
What stays: the one-question rule, motion-is-a-slot, no viz accent of its
own, deterministic from board state, payload honesty, and — most binding —
*ship only what a user would reach for*. A gadget drawer is still failure;
the cap was a proxy for that judgment, and removing it transfers the
judgment to each candidate individually. This pass evaluates **21
candidates** against the round-5 surface. **2 ship as new/restored
visualizers, 1 ships as a slot amendment to an incumbent, 1 ships as a
readout rider.** 17 are rejected — every rejection on structural grounds
that the cap's removal does not touch.

## The incumbent roster this pass tests against

Twelve lenses + one compiler region:

- **10 standing:** WAVE, RADAR, LEVELS, LIGHT GRID, BANDINGS, MATRIX,
  CONSTELLATION, BRANCHES, WINDOW, SCORE.
- **2 restored by the cap's removal** (cut by count, not on merit —
  restored as specced, no re-design): **READOUT** (+ PAIR), **BEAM**.
- **THE PLAN strip** — not a visualizer (compiler region, reads plan
  structure not wires) but an incumbent for the one-question test: it
  owns "what calls will run."

---

## 0 · What round 5 actually changed for lenses

The exhaustion claim (pass 2) was: every new lens dies on duplicate
question, missing payload, or missing runtime; reopening requires new
signal-model surface. Round 5 then added four speech kinds and a process
axis — so did the space reopen? Mostly **no**, for one deliberate reason:
**every round-5 jack is an ordinary scalar** (ORDER's displacement,
MIXER's per-channel shares, STAGE's position, FORK's lean, REVISE's
passes) or absent (SELECT, GROUP). Plain scalars feed the existing scalar
lenses — that was the point of keeping the coercion matrix untouched. The
new pieces mostly multiply *compositions* (MIXER × BANDINGS, STAGE →
LEVELS lane, FORK lean → BEAM end), not lens *questions*.

Five genuinely new surfaces did appear, and each got hunted:

| New surface | What it could unlock | Outcome |
| --- | --- | --- |
| Sum-to-100 invariant (MIXER) | proportion lenses beyond BANDINGS | nothing survives (§3.1) |
| Permutation value (ORDER) | relational order lenses | category 4 stands, sharpened (§3.2) |
| Fusion + silence gating (GROUP) | a "who's speaking" lens | wrong layer; card affordance instead (§3.3) |
| Process state (stages/forks/loops) | pipeline/fork/loop lenses | THE PLAN strip is the only honest home (§3.4) |
| Lifecycle scalar (STAGE) + curve POSITION | a persistent cross-section | **SHIPS — as a SCORE slot** (§2.1) |

Plus one surface round 5 created *socially* rather than technically: the
packs era makes every board an **authored artifact with defaults**, and
"where have I departed from the author" becomes a question a real user
asks. That yields the one wholly new lens this pass ships (TRIM, §2.3).

And one restoration re-argued on merit: **STEPS** (§2.2) — cut by D9's
cap, and the round-5 speech work has since *raised* its value.

---

## 1 · Verdict table — 21 candidates

| # | Candidate | Question it would answer | Verdict |
| --- | --- | --- | --- |
| 1 | SCORE **POSITION slot** (wired cursor) | what is every quality's value *at this point in the work* — persistently, not under the hand | **SHIP (slot amendment)** |
| 2 | **STEPS** (restore; pass-2 spec) | what the prompt will actually *say* about the shape | **SHIP (restored, with deltas)** |
| 3 | **TRIM** (deviation from authored default) | where have I *departed from the author's setup*, which way, how much | **SHIP (new)** |
| 4 | READOUT **named-stop rider** | the headline, in the stop's word | **SHIP (rider, not a viz)** |
| 5 | Balance point / gimbal over MIXER shares | which way the blend leans, as one point | REJECT — BANDINGS' question re-inked; donut precedent verbatim |
| 6 | Ternary pad lens (3 shares) | where in blend-space the mix sits | REJECT — same, plus arity-3-only is a broken input contract |
| 7 | Concentration / entropy readout | committed blend or hedged blend | REJECT — derived READOUT with a weak theory (sum-bus precedent); the read is free in BANDINGS' gestalt (one thick band = committed) |
| 8 | Two-way proportion lens (share painting) | — | REJECT — sum invariant is state; vizzes hold no state; already the crispest-proof rejection (r5 §5.13); MIXER × LIGHT GRID is the composition |
| 9 | Bump/slope chart, 2+ ORDERs (pack-vocabulary challenge) | where two priority orders disagree | REJECT — category 4 stands even inside a pack (§3.2); reopening key sharpened |
| 10 | Order stability / churn under drag | how settled is this ranking | REJECT — memory ≠ state, category 3, permanent |
| 11 | PODIUM / SEQUENCE (re-test under no-cap) | who ranks where | REJECT — died as a face-duplicate, not on the cap; nothing to restore |
| 12 | Fusion / sentence-assembly lens (GROUP) | how the group sentence assembles from members | REJECT — the card IS the sentence made visible (r5 §4); membership isn't wire payload |
| 13 | "Who's muting the voice" lens | which member silenced the group | REJECT as viz — silence is speech-layer, GROUP is jackless; **recommend a card-side affordance instead** (§3.3) |
| 14 | Pipeline / flow lens (stage progression) | what calls will run, in what order | REJECT — THE PLAN strip's question verbatim; plan structure isn't wire payload |
| 15 | Fork-outcome tree lens | which paths exist, on what conditions | REJECT — FORK's face draws the junction; multi-fork tree pictures a branching one call doesn't have (the branch-cards rejection, re-run) |
| 16 | Revision-loop lens | passes, thresholds, loop shape | REJECT — REVISE's face (count + arcs) is the picture; passes is a count, READOUT speaks it |
| 17 | Lifecycle dial / arc | where the work is in its life | REJECT — STAGE's own face (slider + named stops) is exactly this picture |
| 18 | NOW panel (sampled values as a module) | values at the current stage | FOLD — this is SCORE's cross-section given a wire; ships as #1, not as a module |
| 19 | Spectrogram-over-stages (qualities × stage heat) | when each quality is intense | REJECT — SCORE's question in heat ink; no two viz share a question. Note: a *heat rendering mode* on SCORE for high lane counts is a size-class question (meter-bridge precedent), deferred, not a viz |
| 20 | History / trajectory family (re-test) | where values have been | REJECT — category 3 is a property of the medium; no cap regime changes it; permanent |
| 21 | Pack face / mod summary lens | the whole mod at a glance | REJECT — reads every control, not a wired subset (completeness-capsule rejection); the Simple face story is READOUT + preset chips + the card stack |

Also swept without full rows: trend-tick lens ("what changes next" —
readable from SCORE's lines at the cursor; folded, then dropped from the
POSITION spec for purity), signal-vs-artifact topology lens (the cables
already are the diagram — re-rejected), QUORUM/switch-count (LIGHT GRID's
gestalt already), MIXER × ORDER cross-lens (category 4 — channels and
items are different name spaces even in one pack).

---

## 2 · Spec sheets

### 2.1 · SCORE POSITION slot — the cursor becomes a wire

Not a new visualizer: a **fixed-labeled slot added to SCORE**, the same
hybrid-rail move the constellation made for DRIFT (variable lanes + one
fixed slot, sanctioned pattern). It is the round-5 envelope story's
missing lens-side half: STAGE emits where the work is; the curve face
samples itself there; SCORE — the only relational time lens — should
show *all* lanes sampled at that moment, persistently.

```
SCORE                            + − ⚙ ×
      ┌─────┆───────╂───────┆───────┆─────┐   ╂ = wired cursor,
  ∿── │ WARM┆    ___╂ 6     ┆       ┆     │   full-height accent
      │  ___┆___/   ╂\___   ┆_______┆___  │   hairline + per-lane
  ∿── │ DETL┆       ╂ 4  ___┆___    ┆     │   sample chips
      │  ___┆______/╂__/    ┆   \___┆___  │
  o── │ PACE┆═══════╂═5═════┆═══════┆═══  │
      └─────┆───────╂───────┆───────┆─────┘
       START    ¼   │  MID      ¾     END
  POSITION ──●      └─ x = wired value (STAGE the legible source)
```

**Semantic job (delta).** SCORE's question grows one clause: "…and what
is happening *right now*, where the work actually is." The hover
cross-section answered this momentarily, under the hand, dying with it —
honest because gesture-owned. The POSITION slot answers it persistently —
honest because **wire-owned**: STAGE emits ("we are at the organising
stage" is a true, spoken fact about the session), so a cursor bound to it
depicts a value that reaches the compiler. This is the exact line the
playhead rejection drew: the playhead pretended *execution* had a
position (board-owned fiction, never emitted); this cursor shows a
position the *user declared and the prompt speaks*. Same doctrine that
legalized the curve's own POSITION jack — extended from one face to the
relational lens, which is where it pays most: the curve face samples one
quality; SCORE's cursor samples the whole arrangement at once.

**Input contract.** One fixed-labeled slot, `POSITION`, on the left rail
beneath the variable lane dots (constellation-DRIFT anatomy: variable +
one fixed motion/cursor slot). Scalar in; total coercion applies (span →
midpoint, series → refuse? No — matrix rows apply unchanged); STAGE is
the *legible* source, any scalar is an honest one. Unwired: no cursor at
all — SCORE renders exactly as today, hover cross-section unchanged.

**Rendering.** Wired: a full-height vertical hairline at x = value,
wearing the **wired control's accent** (the cursor is owned; ownership
shows in the ink — the momentary hand cursor stays plain ink, so the two
never impersonate each other). Per-lane sample chips ride the cursor
using the **same chip anatomy as the hover cross-section** — one
rendering, two owners (the hand or the wire). Chips collapse under `sm`
to hover, per the standard label-collapse rule.

**Two-way.** Yes — dragging the cursor writes back through `slot.set`
with slider mechanics, quantizing to the wired control's steps/stops
(STAGE's named stops snap). One state, many handles: dragging the cursor
across the SCORE rides the whole mod through its lifecycle while STAGE's
own handle visibly moves — the most instrument-like gesture the process
axis has. Existing write-back helper; zero new write surface.

**Motion owner.** The POSITION slot owns the cursor's glide
(`--mui-t-move`/`ease-settle` on value change) — motion-is-a-slot,
literally. No idle motion; an unwired SCORE stays exactly as still as
today. Reduced motion: cursor snaps.

**Min size / geometry / ink.** SCORE's own spec unchanged (min 4×3,
recessed well, detent hairlines in `--mui-line`); cursor hairline 2px
accent, above detents, below lane lines? No — **above lane lines**: the
cursor is the newest, most intentional mark. Chips per cross-section
spec.

**One-question audit.** vs curve face + POSITION: one quality vs all
lanes aligned (SCORE's charter distinction, re-applied). vs hover
cross-section: momentary/hand vs persistent/wire — same anatomy, not the
same owner. vs THE PLAN strip: the strip shows *calls*; the cursor shows
*values at a declared position within one call's arc*. No collisions.

### 2.2 · STEPS — restored, and stronger than when it was cut

**Re-evaluation verdict: SHIP.** The pass-2 spec (`explore-visualizers-2.md`
§3.3) stands verbatim — fixed-inheriting 1 slot, 10-notch point columns
at their t, spoken integers + timebase words, hold ties, one-way v1,
collapse predicate shared with the D6 speller as the acceptance test.
Not re-specced here; deltas only.

**Why the cut is worth reversing (not just "the cap is gone").** D9 cut
STEPS by count, and the primitives report then cited that cut as
precedent that "drawn-vs-said alone doesn't earn a slot." Under no-cap
that precedent inverts *only if* the question got more valuable — and it
did, three times over in round 5:

1. **Spoken values are now load-bearing beyond the card.** GROUP VOICE
   splices members' spoken values into authored sentences; the named-stops
   rider makes the spoken form the *user-facing* form. The gap between
   drawn and said is no longer a curiosity — it propagates into every
   group sentence a pack author writes. A lens that shows the speller's
   actual resolution *before the prompt runs* is the debugging surface
   for the whole speech round.
2. **Renamable x-detents give STEPS its real words.** "EXPLORE 9 ·
   ORGANISE 6 · COMMIT 2" under the ladders is a stage plan you can read
   at arm's length — pass 2's START/MID/END row was the weakest part of
   the spec, and round 5 fixed it from the outside.
3. **The `5 5 5 5` read now has an audience.** Pack authors shipping
   curve-carrying packs need exactly this check ("my expressive curve is
   below the speller's resolution") during authoring, which is when a
   board lens gets reached for.

**Deltas to the pass-2 spec (all additive):**

- **Timebase words** inherit renamed x-detents when the wired curve's
  timebase defines them (stage names print; fallback to the neutral
  detent words — the pass-2 rule, now with a real source).
- **POSITION awareness, optional:** when the wired curve has its
  POSITION jack wired, STEPS renders a quiet accent underline beneath the
  column nearest the sampled position — the "we are here" of the spoken
  plan. Same honesty as §2.1 (wire-owned, emits); costs one hairline.
  Explicitly NOT a cursor between columns — STEPS is quantized speech,
  and the underline snaps to the column the speller would attribute.
- **Question line unchanged:** "What the prompt will actually say about
  the shape."

**One-question re-audit** (vs the two arrivals since the cut): vs THE
PLAN strip — the strip shows calls and sampled values per *stage of the
plan*; STEPS shows the *compiled sentence's* quantization of one series,
which exists at FAST where the strip doesn't render at all. vs GROUP
VOICE card — the card shows the fused sentence's words; STEPS shows the
notch resolution behind one member's contribution. No collisions.

Build note (unchanged from pass 2): ships only after the D6 speller
stabilizes; sharing the collapse predicate is the acceptance test.

### 2.3 · TRIM — where you've moved off the author's setup

```
TRIM                             + − ⚙ ×
      ┌───────────────────────────────┐
  o── │ WARM        │▓▓▓▓▓▓▓ +18      │   center spine = the
  o── │ PACE   −9 ▓▓│                 │   authored default
  o── │ DETL        │  ·0             │   bar = signed offset
  o── │ LNGT        │▓▓▓▓▓▓▓▓▓▓ +32   │   from that default
      └─────────────┴─────────────────┘
                 AS AUTHORED
```

**Semantic job.** *Departure from the author.* The packs round turns
every board into an authored artifact: a pack ships with a creator's
values, and the user's whole relationship to it is *adjustment*. No
incumbent answers "what have I changed, which direction, and how much" —
LEVELS shows magnitudes with no reference point; the tuner was rejected
because its target was board-wide (completeness capsule) or pairwise
(BEAM); TRIM's target is neither: **each lane's reference is its own
wired control's authored default**, read through the slot, no second
wire, no board-wide sweep. ORDER already ships exactly this question for
one kind (its displacement jack — "how re-prioritized from authored");
TRIM is the same honest question for the scalar kinds, as a lens. The
gestalt read: a pack fresh from the shelf is a silent spine; a
personalized pack is a fingerprint — *my* version of NARRATOR is warmer
and much shorter, at a glance.

**The instrument word.** "Trim" is the audio term for offset-from-nominal
(trim pots). Instrument-flat, plain, and not a metaphor stretch.

**Input contract.** Variable-inheriting, one dot per lane, min 2 (one
delta is a readout, not a fingerprint; and the relational read — *which*
of my changes is the big one — is the question). Each lane needs the
wired control's **authored default**, which requires one addition to the
slot record: an optional `base` field (the config default the creator
shipped). This is the pass's one piece of new contract surface, and it is
honest payload: config is board state, deterministic, already what packs
serialize. Controls without a meaningful base (words — jackless anyway)
never arrive. Coercion: scalar native; span → midpoint delta, series →
mean delta per the existing matrix rows (weakly informative, honest,
total). Unwired lane: a faint dot on the spine, no bar, no label.

**Geometry.** Horizontal diverging bars from a center spine: right =
above authored, left = below. Bar length ∝ |offset| on a shared scale
(the max wired |offset| sets the scale, so the biggest change always
fills its half — rank is the read, not absolute pixels; the signed mono
readout `+18` carries the number). Lane labels micro caps left, readouts
riding bar tips. Foot label `AS AUTHORED` under the spine, dropped under
`sm`. Min 3×2. Under `sm`: readouts drop first, labels to hover chips —
the spine and bars are the last thing standing.

**One-way, v1.** Deliberately — dragging a bar is just moving the value
(a duplicate control handle with a strange mapping). One designed upgrade,
not bought: click a lane's spine-dot to **reset that control to
authored** (a write of `base` through `slot.set` — the one gesture that
belongs to this lens and no other surface). Ships one-way; the reset
lands only if prototype use begs for it.

**Motion.** Bars re-flow at `--mui-t-move`/`ease-settle` on value change;
the shared scale re-normalizes in the same beat (FLIP-like, all bars
glide). No idle motion. No motion slot.

**Ink.** Ground-recessed well. Spine: 2px ink hairline (the reference is
the author's, so it wears ink, not any accent — same logic as WINDOW's
intersection). Bars: the wired control's `--accent-tint` with a solid
accent cap at the tip; zero-offset lanes show the `--mui-dot` speck on
the spine (the detent dot — "untouched" stays visible as texture, never
blank). Readouts mono tabular, signed.

**One flag, recorded honestly.** TRIM's question is about *settings
versus the author's settings*, not directly about the idea being shaped —
the most meta question in the set (LIGHT GRID's "how committed is the
board" is the precedent that meta-reads are admissible). It earns the
slot anyway because in the packs era "how is mine different" *is* a
shaping question — it is what adjusting a preset means. If prototype use
shows people read it once and never again, demote to a pack-authoring
surface without redesign.

**Question line.** "Where you've moved off the author's setup — and by
how much."

### 2.4 · READOUT rider — speak the stop

Not a viz; one rendering branch on the restored READOUT. When the wired
control defines named stops (the round-5 rider on stepped dial/slider,
or range/filter's existing stops), READOUT renders the **stop word**
(`THOROUGH`) as the headline with the numeral demoted to the micro-caps
line (`7 OF 10`), instead of the bare number. Rationale: READOUT's job is
"the headline"; after round 5 the headline of a stopped control *is its
word* — the card, the group sentence, and the control's own readout all
speak it, and a lens that says `72` where everything else says
`THOROUGH` is the only surface off-message. Config toggle (`WORD ·
NUMBER`) in the ⚙, defaulting to WORD when stops exist. Two-way drag
mechanics unchanged (snaps stop-to-stop, the word ticks — odometer roll
becomes a word roll, same `--mui-t-move`).

---

## 3 · The challenges, answered honestly

### 3.1 · MIXER: does sum-to-100 open a proportion lens beyond BANDINGS?

No. The sum invariant is genuinely new *state*, but every picture of it
answers BANDINGS' question — "what dominates the blend, by what
proportion" — in different ink: donut (rejected r5), gimbal/balance point
(the centroid of the shares *is* the proportions, re-projected), ternary
pad (same, and arity-locked to 3). The one candidate question that isn't
BANDINGS' — "how *committed* vs hedged is the blend" (concentration) —
fails the derived-READOUT test: a single entropy number is a weak theory
(the sum-bus rejection, re-run), and the read is already free in
BANDINGS' gestalt: one thick stratum = committed, even strata = hedged.
The honest finding is the one the primitives report predicted: **MIXER's
lens story is composition, not new lenses** — wire all N jacks into
BANDINGS and normalization becomes the identity function; the lens
finally shows exactly what is spoken. Two-way share painting stays dead
on "visualizers hold no state" — the rejection that proves MIXER's
kindhood cuts both ways forever.

### 3.2 · ORDER: does the pack world dissolve category 4?

Challenged as instructed; the answer is still no, but the key is sharper.
The tempting argument: a pack's controls are authored by one creator, so
two ORDER controls in one pack *can* share an item vocabulary by
construction — string-match the item sets and a bump chart ("where do my
draft priorities and my revision priorities disagree?") becomes
joinable, with refuse-at-connect for non-matching sets (refusal precedent
exists: words × radar vertex, artifact × signal jacks).

Why it still dies, honestly:

1. **The join is still unprincipled.** String equality is a coincidence
   the lens elevates to identity. The system has no first-class shared
   vocabulary; a creator renaming one item in one control silently breaks
   a join the user was relying on — a lens whose truth depends on
   spelling is not honest, it is lucky.
2. **The payload doesn't exist.** ORDER's jack is a displacement scalar;
   a relational order lens needs the deferred `order` payload. Shipping
   the lens would force the fourth shape in — and the deferral's own
   test ("build the moment a native consumer exists") should be passed by
   a consumer users *need*, not one constructed to pass it.
3. **The reach-for test fails.** Two ORDER controls ranking the *same
   items along different dimensions in one mod* is a pattern no shipped
   or planned pack exhibits. Shipping a lens ahead of its board pattern
   is the gadget drawer.

**Sharpened reopening key** (recorded so the next pass doesn't re-argue
from scratch): when the packs round lands a **first-class mod-level
vocabulary** (shared item registry that controls reference instead of
re-authoring), category 4 dissolves *by construction* — items become
referents, not strings. At that moment: un-defer the `order` payload, and
the two-order divergence lens (working name AGENDA) becomes buildable and
should be re-tested against real pack patterns. Until then the entire
multi-order family stays structurally dead, exactly as r5 §4 ruled.

### 3.3 · GROUP VOICE: does fusion earn a lens?

No — twice over, and the second reason is the interesting one.

1. **The sentence assembling** is the card: r5 §4 already ruled "the
   card/tape IS the sentence made visible," and no-cap doesn't touch a
   duplicate-question rejection.
2. **Which member is muting the voice** — the genuinely new diagnostic
   the silence rule creates ("the group is as silent as its most silent
   member") — *cannot be a visualizer at all*: silence is a speech-layer
   fact (empty frame, switch off, empty words) and the speech layer
   doesn't flow through jacks; GROUP itself is jackless by design. A
   lens would have to read board/speech structure, which visualizers are
   forbidden to do (they read wired control values only — the C4 rule).

**Recommendation routed to its honest home** (compiler, not viz — noted
for the packs wave): when a voiced group is muted, its card should render
in the muted register *naming the muting member* ("— silent: EXAMPLES is
off"), instead of vanishing. The bidirectional-transparency guarantee
already implies it; this makes the silence rule debuggable where speech
lives. Zero lens surface.

### 3.4 · The process axis: what board lenses does it unlock?

None — and the reason is structural, not taste. Process state (fidelity
resolutions, artifact-cable order, check blocks, plan derivation) is not
wire payload: artifact cables carry engine-surface contents, fidelity
lives in foot chips, and the plan is a *derivation* from board state that
only the compiler performs. A board lens showing pipeline progression,
fork trees, or revision loops would have to read plan structure, which is
exactly the line C4 drew between BRANCHES and EXPLORE: **the lens
pictures the prompt; the plan strip pictures the plan.** Every process
lens candidate is either a control-face duplicate (FORK's junction,
REVISE's arcs, STAGE's slider) or THE PLAN strip's question re-inked.
The strip is the only honest home, as suspected in the brief.

What the process axis *does* give lenses is its **signal-side shadow**:
STAGE/FORK/REVISE all emit ordinary scalars, so LEVELS can rank a lean
against a strictness, BEAM can show a fork's lean as a trade-off, READOUT
can headline passes — compositions, free, already paid for. And one
scalar is special enough to earn dedicated anatomy: STAGE's lifecycle
position, which ships as SCORE's POSITION slot (§2.1) because *there* it
answers a question (all lanes sampled at the declared moment) that no
face and no strip answers.

### 3.5 · Spectrogram, history, pack faces — the permanent rejections

- **Spectrogram-over-stages**: SCORE's question in heat ink; the
  one-question rule is indifferent to rendering. The honest residue: if
  real boards grow SCOREs past ~6 lanes, a *heat rendering mode* on SCORE
  itself (config, like LIGHT GRID's row/column flip — presentation, not
  wiring) is the meter-bridge answer: a size class, not a new question.
  Deferred until lane counts demand it.
- **History/trajectory**: category 3 is a property of the medium — the
  board has no transport and memory ≠ state. No cap regime, payload, or
  pack changes this. Marked permanent; future passes should not re-sweep
  it.
- **Pack face / mod summary**: reads every control, not a wired subset —
  the completeness-capsule rejection is about the *contract* (lenses read
  wires), not about count. The Simple-face story is owned by READOUT +
  preset chips + the card stack, exactly as the engine doc always said.

---

## 4 · Rejection register (this pass)

For the record, one line each, full reasoning above:

gimbal/balance point (BANDINGS re-inked), ternary pad lens (same +
arity-locked), concentration/entropy readout (derived READOUT, weak
theory), two-way share painting (state in a lens), bump/slope chart of
orders (category 4; key = mod-level vocabulary), order churn (memory ≠
state, permanent), PODIUM/SEQUENCE re-test (face duplicate — cap was
never the grounds), sentence-assembly lens (card owns it), group-mute
lens (speech layer has no jacks; card affordance recommended instead),
pipeline/flow lens (PLAN strip's question), fork-tree lens (face + strip;
pictures branching one call lacks), revision-loop lens (face + READOUT),
lifecycle dial (STAGE's face), NOW module (folded into SCORE POSITION),
spectrogram (SCORE re-inked; heat mode deferred as a size class),
history family (category 3, permanent), pack summary lens (reads all
controls, contract violation), trend-tick cursor chips (readable from the
lines; dropped for purity), signal/artifact topology lens (cables are the
diagram), QUORUM (LIGHT GRID gestalt), MIXER × ORDER cross-lens
(category 4).

---

## 5 · System fit

- **Contract surface: one field.** TRIM adds optional `base` (authored
  default) to the slot record — deterministic config state that packs
  already serialize. No new slot mode, no new rail edge. SCORE POSITION
  reuses the hybrid-rail pattern (constellation DRIFT) and the existing
  write-back helper. STEPS was already contract-clean. The READOUT rider
  is a rendering branch.
- **Roster after this pass: 13 visualizers** — the standing 10 + READOUT
  + BEAM (restored by the cap's removal) + STEPS (restored on merit).
  Plus two amendments (SCORE POSITION slot, READOUT stop-words) and one
  new lens (TRIM) pending its packs-wave taste check → **14** if TRIM
  survives in hand.
- **Question lines** (palette tooltips, plain words):
  - SCORE (updated): "When each quality rises and falls — and where the
    work is right now, if you've told it."
  - STEPS: "What the prompt will actually say about the shape."
  - TRIM: "Where you've moved off the author's setup — and by how much."

### Ranked build order (by user value per unit build)

1. **SCORE POSITION slot** — smallest build in the set (one slot, one
   hairline, chip anatomy already exists, write-back helper already
   paid for) and it completes the round-5 envelope story: STAGE → curve
   → SCORE is the demo that sells the whole process axis. Ship in wave 3
   alongside STAGE + curve POSITION, same round (the controllers report's
   own risk note — "STAGE without the POSITION wire looks pointless" —
   extends to the lens side).
2. **READOUT stop-word rider** — near-zero cost, ships with the restored
   READOUT + the named-stops rider; keeps the one lens that speaks
   numbers on-message with the speech round.
3. **STEPS** — spec done, but gated behind D6 speller stability (the
   shared collapse predicate is the acceptance test) and best timed with
   renamable x-detents so its word row ships with real words. Wave 3.
4. **TRIM** — the only genuinely new build; wants the packs wave (its
   question doesn't exist until authored defaults are in users' hands)
   and a taste check in hand before the roster counts it. Build last;
   demote without redesign if it reads once and never again.

---

## 6 · The state of the space, restated for the no-cap era

The exhaustion argument survives the cap's removal intact — because it
never rested on the cap. Four structural failure categories now stand:
**duplicate question** (the one-question rule), **missing payload**
(lenses read wires; speech, plan structure, and board topology don't flow
through them), **missing runtime** (memory ≠ state, no transport —
permanent), and **cross-control item identity** (no shared name space —
until a mod-level vocabulary ships). Removing the cap changed exactly
two things: it restored what the cap alone had cut (READOUT, BEAM,
STEPS), and it converted the count ceiling into a per-candidate
reach-for test — which this pass applied and which killed 17 of 21
candidates anyway.

The forward-looking keys, consolidated:

| Key (future surface) | What it reopens |
| --- | --- |
| Mod-level shared vocabulary (packs round) | multi-order lenses (AGENDA), MIXER × ORDER cross-reads; un-defers the `order` payload |
| D6 speller stability | STEPS ships (gated, not blocked) |
| SCOREs past ~6 lanes in real boards | SCORE heat rendering mode (size class) |
| Real runtime / artifact execution (PRD, post-cut-one) | nothing on the board — execution reads live in THE PLAN's successor surfaces, never in lenses |

The set stays a workbench, not a gadget drawer: every lens still answers
one question no other answers, and the no-cap rule that matters was never
the number — it is that a user reaches for each one.
