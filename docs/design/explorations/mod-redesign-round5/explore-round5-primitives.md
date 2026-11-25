# Mod workbench — round 5, new primitives (the speech round)

Design exploration, 2026-07-16. Concept only — no implementation.
Builds on: `lib/DESIGN.md` (SPEC 03 — signal model, coercion matrix,
control anatomy, visualizer contract, rejected/deferred register),
`explore-visualizers-2.md` (the exhaustion claim and its reopening keys),
`round4-synthesis.md` (D1–D9, the 10-viz cap), `mod-prompt-engine.md`
(five parts of a control, frames-with-slots, old catalog).

Mandate (weili, post round 4): "Keep pushing for more control types, and
more creative visualisers... But only if it is worthwhile. Think about
Lego. The individual pieces can be simple and unique, but together they
form something elegant."

## 0 · The worthwhile test, applied brutally

A piece ships only if BOTH hold:

- **(a) New speech or new carriage.** It emits something no current
  control can say, or its cable carries a payload no current cable can.
- **(b) Lego.** New piece × existing pieces = new sentences/pictures with
  zero special-casing.

**Headline finding.** Round 5 is a *speech* round, not a picture round.
Four pieces pass; every one of them is about what a mod can SAY — order,
proportion, choice, fusion. **Zero new visualizers pass**, the 10-viz cap
stands untouched, and — the elegant part — **the coercion matrix is
untouched too**: every shipped jack is an ordinary scalar (or absent).
The exhaustion report's reopening key (an order payload) was tried and
found not yet earned: a single order's best picture is its own face, and
every relational order-lens dies on a new structural ground (§4).

## 1 · Verdict table

| # | Candidate | Verdict | One-line reason |
| --- | --- | --- | --- |
| 1 | ORDER control (drag-to-rank) | **SHIP** | relative priority is unsayable today; face is its own picture |
| 2 | MIXER control (normalized shares) | **SHIP** | share-of-whole is unsayable; sum-invariant must be control state; × BANDINGS for free |
| 3 | SELECT control (one-of-N, nominal) | **SHIP** | per-option frames on a nominal choice; jackless is the honest shape |
| 4 | GROUP VOICE (composite emitter) | **SHIP** | one fused sentence from N members; multiplies every existing piece |
| r | Named stops for stepped dial/slider | **SHIP (rider)** | config extension, not a kind; makes GROUP sentences read human |
| 5 | `order` cable payload (4th shape) | **DEFER** | no native consumer survived §4; ORDER's jack is a plain scalar until one does |
| 6 | Curve GAIN input jack | **DEFER (keep)** | opens the control-input seam (cycles, topology) — its own round |
| 7 | Per-segment curvature | **DEFER (keep)** | nuance below the speller's resolution; already designed, not blocked on |
| 8 | Order-native visualizers (all) | **REJECT** | §4 — face-duplicate or cross-control item-identity failure |
| 9 | Donut / proportion visualizer | **REJECT** | BANDINGS' question verbatim; MIXER × BANDINGS is the composition |
| 10 | Everything else swept | **REJECT** | register, §5 |

## 2 · Spec sheets

### 2.1 · ORDER — priorities you can grab

```
ORDER                          ⚙ ×          dragging:
  ┌───────────────────────────┐
  │ 1  ▐ CLARITY           ▌  │             1  ▐ CLARITY  ▌
  │ 2  ▐ DEPTH             ▌  │            ~~~▐ BREVITY ▌~~~   ← lifted:
  │ 3  ▐ BREVITY           ▌  │             2  ▐ DEPTH    ▌      scale-lift
  │ 4  ▐ SPEED             ▌  │             3  ▐ SPEED    ▌      + shadow-lift
  └───────────────────────────┘                (FLIP settle)
    CLARITY › DEPTH › …        ●── scalar jack (SHUFFLE)
```

**Semantic job.** *Relative order, first-class.* Nothing on the board can
say "X before Y". N dials give magnitudes and leave order derivative and
tie-ridden; ORDER makes the permutation the value. One control, one new
speech act: priority / sequence / preference.

**Face & gestures.** A vertical stack of capsule tokens in a recessed
well; faint rank numerals left of each token (`--mui-ink-faint`, mono).
Tokens are full capsules (instrument anatomy — round). Drag a token: it
lifts (`--mui-scale-lift` + `--mui-shadow-lift`), siblings FLIP-displace
at `--mui-t-move`/`ease-settle`, release settles with weight. The motion
charter was built for exactly this gesture; ORDER is its showcase.
Keyboard: up/down selects, shift+up/down moves. Reduced motion: reorder
snaps, no lift transforms.

**Items.** Creator-authored in config (comma list, 2–7), exactly like
radar axis names / pad end names. Users reorder; `relabel` permission may
allow renaming, never adding (a growing ORDER is the growing-list kind's
job, out of scope).

**Value & jack.** Value = the permutation (array of item indices). The
jack is an ORDINARY SCALAR — no fourth payload shape (deferred, §5):
it emits **displacement** — normalized Kendall-tau distance from the
authored order (0 = as authored, 100 = fully reversed). Hover chip
`LABEL · SHUFFLE 33`. Honest ("how re-prioritized"), total, admittedly
weak — the register records it as the piece's one thin stud. Coercion:
none needed; it's a scalar, the existing matrix rows apply.

**Emission.** One card. Canonical spoken value: `X, then Y, then Z`.
Frame with `{value}`: "When goals conflict, prefer {value}." →
"When goals conflict, prefer clarity, then depth, then brevity."
Fallback: "Priorities: clarity, then depth, then brevity." An untouched
(authored-default) order still speaks — the flat-at-default-curve
precedent (D6). Card pill: top item, truncated (`CLARITY ›`).

**Config.** Title, description, items list. No steps, no stops.

**Min size.** 2×2 (names need width; 4 items need rows). Under `sm`,
numerals drop first; token text ellipsizes per the named-stop fallback
spirit; hover chip carries the full order.

**Accent.** One accent: token fills are `--accent-tint`, the rank-1 token
alone wears solid accent (the podium is in the ink, not a viz).

**Unlocks.** GROUP slots ("Structure the answer as {ORDER}"); the
deferred renamable-x-detents synergy (§5.12); and — checked honestly —
no visualizer (§4).

### 2.2 · MIXER — the balance that always sums

```
MIXER                          ⚙ ×
  ┌──────────────────────────────┐        ●── EVID   (scalar jack)
  │  ▐█▌     ▐ ▌     ▐ ▌         │        ●── EXMP   (scalar jack)
  │  ▐█▌     ▐█▌     ▐ ▌         │        ●── INTU   (scalar jack)
  │  ▐█▌     ▐█▌     ▐█▌         │
  │  ▐█▌     ▐█▌     ▐█▌         │    drag one fader up →
  │ EVID    EXMP    INTU         │    the others yield
  └──────────────────────────────┘    proportionally, live
        50 · 30 · 20
```

**Semantic job.** *Share-of-whole.* N sliders speak absolutes ("7 of
10"); nothing can say "weight evidence 50%, examples 30%, intuition 20%"
— a zero-sum trade. And the mechanic cannot be assembled: the `scale`
wire (one control shifting another's value) was rejected because B would
show one value and speak another. Inside ONE control, rebalance is
honest — the faders show exactly what the sentence says. This is also
why MIXER can't be a two-way BANDINGS: the sum invariant is *state*, and
visualizers hold no state (rejected, §5.13).

**Face & gestures.** N slim vertical capsule tracks in one shared well
(the slider's anatomy, rotated and multiplied), fills in `--accent-tint`
running cap-to-handle per the fill rule; channel sublabels in micro caps
beneath (never rotated). Drag one fader: it takes the value, siblings
rebalance proportionally in the same frame — the whole face moves under
one finger, which is the control's picture of its own semantics.
Keyboard: left/right selects channel, up/down adjusts. A channel dragged
to 0 stays 0 during others' rebalances (a silenced channel is a
decision, not a rounding casualty).

**Value & jacks.** Value = `{channel: share}` summing to 100. **One
scalar jack per channel** — the multi-jack primitive (D3), extended from
pad's fixed 2 to config-driven N (2–5). This is the round's one new lib
surface: variable multi-jack count; the workbench's normalizer already
drops dangling wires when a channel is removed. Each jack is an ordinary
scalar; downstream needs no knowledge of the sum.

**Emission.** ONE card, descending order: "Weigh the answer 50% on
evidence, 30% on examples, 20% on intuition." Zero-share channels are
omitted from the sentence. Speller special case at 100: "Weigh the
answer entirely on evidence." Frame with `{value}` supported; fallback
uses the label. Card pill: dominant share (`EVID 50`).

**Config.** Title, description, channels (comma list, 2–5), steps
(OFF/2–10, quantizing shares — rebalance then re-rounds to keep the sum
exact; largest-remainder method, deterministic).

**Min size.** 2×2 (up to 5 faders). Under `sm` the share readout row
drops; hover chip carries `LABEL · 50·30·20`.

**Accent.** One accent for all fills; channel identity is the sublabel.
Downstream, BANDINGS differentiates by rank-derived shades — division of
labor, not duplication.

**Unlocks.** MIXER × BANDINGS is the flagship Lego sentence: wire all N
jacks in and BANDINGS' normalization becomes the identity function — the
lens finally shows exactly what is spoken, no derivation gap. MIXER ×
LEVELS = ranked shares with peak ticks; MIXER × LIGHT GRID = two-way
share painting (write-back through slot.set → control.set rebalances the
whole mixer, all faders visibly move — one state, many handles, and the
most alive write-back in the system). GROUP slots: "...leaning {MIXER}."

### 2.3 · SELECT — the named choice

```
SELECT (≤4 options: segmented)         (5+: stack)
  AUDIENCE            ⚙ ×               AUDIENCE      ⚙ ×
  ┌─────┬─────┬──────┐                  ┌───────────────┐
  │FNDER│▓TEAM▓│CLIENT│                 │  FOUNDER      │
  └─────┴──▲──┴──────┘                  │ ▓TEAMMATE▓    │
           │                            │  CLIENT       │
     picked cell: solid accent,         │  BOARD        │
     inkFor() text                      └───────────────┘
```

**Semantic job.** *One-of-N, nominal.* The current 9 are all magnitude,
shape, or free text. The single most common real prompt control —
audience, format, language — is a discrete NAMED choice where each
option carries its own creator-written frame ("Write for a busy
founder." / "Write for a teammate who knows the context."). Words can't
do it (freeform, no frames, no discreteness); a stepped slider with
stops covers only ORDINAL choices (short/medium/long — see the rider,
§3). SELECT owns the nominal case.

**Face & gestures.** 2–4 options: a segmented capsule track, cells
separated by hairlines; the picked cell wears solid accent with
`inkFor()` text; click or drag-across; arrow keys cycle. 5–7 options: a
vertical stack of quiet option rows (auto-switch by count), picked row
accent-filled. Instrument-flat: the pick is shown by fill, never by a
floating indicator.

**Value & jack.** Value = the picked option index. **No output jack.**
A nominal choice has no honest scalar (CLIENT is not "50 between FOUNDER
and BOARD"), and total coercion would force that lie. Precedent: words
already emits no cable payload (absent from the D1 emitter table) — the
system sanctions speech-only controls. SELECT's composition channels are
its sentence, GROUP slots, and — when the wiring round lands — the
`select` wire it is named for (A's choice swaps B's frames,
`mod-prompt-engine.md`). Jacklessness recorded in the register as a
design statement, not an omission (§5.8).

**Emission.** The picked option's frame, verbatim. Fallback:
"Audience: teammate." Silence: an option with an empty frame says
nothing (the engine's silence guarantee) — the creator's "none" option
costs zero new mechanics. Card pill: the option name.

**Config.** Title, description, options (comma list, 2–7), per-option
frames (one field each, appearing under the options list).

**Min size.** 2×1 segmented; 2×2 stack. Option text ellipsizes; hover
chip carries `LABEL · OPTION` (named-stop fallback pattern).

**Unlocks.** SELECT × GROUP is the sentence factory: "Write a {FORMAT}
for {AUDIENCE}, keeping it {LENGTH}." — three simple pieces, one fluent
instruction. This pairing is half the argument for shipping both now.

### 2.4 · GROUP VOICE — one sentence, many hands

```
┌╌ APPROACH ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ⚙ × ╌┐   dashed hairline +
╎   ┌────────┐  ┌────────┐  ┌───────┐  ╎   accent wash — the
╎   │BREADTH │  │ DEPTH  │  │ TONE  │  ╎   ghost-growth grammar,
╎   │ count 3│  │dial 70 │  │select │  ╎   promoted to a frame
╎   └────────┘  └────────┘  └───────┘  ╎
└╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
  voice: "Consider {BREADTH} approaches, developing
          each {DEPTH}, in a {TONE} register."
  card:  "Consider 3 approaches, developing each
          thoroughly, in a warm register."
```

**Semantic job.** *Fusion.* Today a three-control mod speaks three
staccato lines. GROUP VOICE is a board frame that holds member controls
and one creator-authored sentence with named slots — each slot filled by
a member's own spoken value. It is the old catalog's "Group / Voice
block (layout only)" finally given the voice half, and it is the piece
the packs round wants: authored packs read as prose, not as a settings
dump. Lego verdict: this is the baseplate — it makes sentences out of
pieces and multiplies the value of every control that exists or ever
ships.

**Mechanics.** A group is a frame on the board (dashed hairline,
`--accent-wash` fill — the ghost-growth grammar at rest, solidifying to
a quiet hairline once populated). Head row: accent dot + title + hover
chrome (⚙ ×). Drop a control in → its title becomes an available slot
name. The voice is authored in config: a textarea where `{` summons a
member-title picker; slots render as accent chips inline. Members keep
their own jacks and faces — **cables see members individually; speech
sees the fusion.** No group jack (a sentence is not a signal).

**The two-speakers answer.** Members inside a voiced group NEVER also
speak alone — one card per VOICE (the one-card-per-control rule,
restated at the speaker level; consistent with why per-point cards were
rejected: members surrender addressability to the group). Transparency
is bidirectional: hovering the group's card glows the member controls on
the board; the tooltip at any member shows the full group sentence with
that member's contribution underlined. Every sentence remains
inspectable at the control and at the mod — the guarantee stands.

**Silence rule.** The group is as silent as its most silent member: any
slotted member that would say nothing (switch off, empty words, empty
select frame) mutes the whole sentence — a sentence with a hole is not
spoken. This is deliberate and load-bearing: it gives grouped controls
gate semantics for free ("include examples" off silences the whole
examples clause). Authoring warns (yellow state mark, its second
sanctioned job) when a slot's member can be silent. Members with values
but no slot in the voice: authoring warning; they speak alone (they
never fell under the voice).

**Emission.** One card; accent = the group's own (a group is a speaker,
so it gets the identity dot — the one frame-like thing on the board
that does, precisely because it speaks). Eyebrow = group title; pill =
member count (`3 VOICES`? no — `3 PARTS`). Each slot is spelled by its
member's own engine speller — which is why the named-stops rider (§3)
matters: "developing each {DEPTH}" reads "thoroughly", not "7 of 10",
when the dial defines stops.

**Scope, v1.** Flat groups only (no nesting); members are controls only
(never visualizers — lenses don't speak); one voice per group; the
group addresses one section (creator-set, like any control).

**Min size.** Head row + members' own footprints; the frame has no
minimum of its own beyond 2×1 for the head.

**Verdict on "is now the time?"** Yes — design now, build in the packs
round's first wave. Every week it doesn't exist, pack authors write
staccato mods and users learn the wrong idiom.

## 3 · The rider — named stops for stepped dial/slider

Range and filter already own named stops ("no longer than A PARAGRAPH").
Extend the same config field to stepped dial and slider: when stop names
are defined (count = steps), the readout and the spoken value use them
("THOROUGH" / "developing each thoroughly"), with the existing
named-stop fallback rule for overflow. Not a new kind, no new payload,
no new anatomy — one config field and one speller branch. It ships
because GROUP sentences are only as good as their members' spoken
values, and it dissolves the old catalog's "Blend" control entirely
(§5.6): a 2-stop slider with end-named stops IS a blend.

## 4 · Visualizer re-run — the space stays closed

The exhaustion report named the reopening key: an order payload. Tried
here, against all 10 incumbents (wave, radar, LEVELS, MATRIX, LIGHT
GRID, BANDINGS, CONSTELLATION, BRANCHES, WINDOW, SCORE) and the
one-question test:

| Candidate | Question | Verdict |
| --- | --- | --- |
| SEQUENCE / arpeggiator preview | in what order things happen | REJECT — duplicate: a single order's picture IS the ORDER face; a ranked list is its own best visualization |
| PODIUM | who ranks where | REJECT — the face again; and LEVELS already ranks wired scalars by magnitude |
| Bump/slope chart (2+ orders) | where do two priorities disagree | REJECT — **category 4** (below): item sets don't align across controls |
| Sankey / flow (order × weights) | how weight flows through priority | REJECT — category 4, plus fuses payloads that share no key |
| Consensus ring (N orders) | do the orders agree | REJECT — category 4 |
| Donut / proportion dial (mixer) | what dominates the blend | REJECT — BANDINGS' question verbatim; the sanctioned composition is MIXER × BANDINGS (where normalization becomes identity) |
| "Sentence assembling" viz (group) | what will be said | REJECT — the card/tape already IS the sentence made visible; STEPS' cut (D9) is precedent that drawn-vs-said alone doesn't earn a slot |

**Category 4 — cross-control item identity.** The exhaustion report's
three failure grounds (duplicate question, missing payload, missing
runtime) gain a fourth, exposed by trying order: *the board has no
shared name space*. Two ORDER controls rank different creator-authored
item sets; no lens can honestly join "CLARITY" in one to "CLARITY" in
another (same string ≠ same referent, and usually not even same string).
Every relational order-lens needs that join. Until the system has a
first-class shared-items concept (a mod-level vocabulary — a packs-round
question at the earliest), the entire multi-order viz family is
structurally dead, not just untasteful.

**Consequence.** The 10-viz cap (D9) stands untouched. And since no
native consumer for an `order` cable survived, the fourth payload shape
itself is DEFERRED (§5.5) — ORDER ships with a plain scalar jack, and
the coercion matrix gains zero cells this round. The Lego reading: round
4 built the picture system; round 5 discovered the missing pieces were
all in the speech system, and the pictures already composed.

## 5 · Rejection / deferral register (round 5)

**REJECTED — do not build:**

1. **Order-native visualizers** (SEQUENCE, arpeggiator preview, PODIUM,
   bump chart, Sankey, consensus ring) — face-duplicate or category-4
   item-identity failure (§4).
2. **Donut / proportion visualizer** — BANDINGS' question; MIXER wired
   into BANDINGS is the honest composition.
3. **Per-item rank jacks on ORDER** — rank-as-magnitude lies in every
   weight lens (a rank is not a share); and variable multi-jack is
   earned only where the values ARE magnitudes (MIXER).
4. **Symbol payload (select's option as a cable)** — nominal→scalar has
   no honest coercion cell; total coercion would institutionalize a lie.
   Jackless SELECT is the design statement.
5. **Dice / surprise control** — breaks the determinism guarantee as a
   control; as a button it's the old catalog's Actions (never speaks).
   If wanted later: a reroll ACTION on existing controls, not a kind.
6. **Blend control** (old catalog) — dissolved by the named-stops rider:
   a 2-stop slider with end names is a blend, one kind fewer.
7. **ORDER × MIXER fused** (weighted ranking mega-control) — anti-Lego;
   compose ORDER + MIXER + GROUP VOICE instead ("Prioritize {ORDER},
   weighing {MIXER}").
8. **Two-way BANDINGS as the mixer** — the sum-to-100 invariant is
   state; visualizers hold no state; normalization-as-state needs a
   control. (This rejection is the crispest proof MIXER earns kindhood.)
9. **Group jack / group as signal** — a sentence is not a signal; cables
   see members individually by design.
10. **Nested groups, viz-in-group** — v2 questions at the earliest;
    nesting multiplies the silence rule's edge cases for no pack need
    yet shown.

**DEFERRED:**

11. **`order` cable payload (fourth shape)** — designed shape: a
    permutation of named items; glyph: three stacked dashes of
    decreasing length in the jack ring; coercion into value slots via
    its displacement scalar (one new cell, then existing rows compose).
    Build the moment a native consumer exists; none does (§4).
12. **ORDER → renamable x-detents feed** — an order of task stages
    naming SCORE's/curve's detent columns is the deferred
    renamable-detents item plus a config-feed wire; a wiring-round
    question. The synergy is recorded so neither piece is designed into
    a corner.
13. **Curve GAIN input jack** — keep deferred: first input jack on a
    control opens the consumer-controls seam (cycle rules, topology),
    a round of its own; nothing in round 5 is blocked on it.
14. **Per-segment curvature** — keep deferred as designed; nuance below
    the speller's resolution until the speller grows a curvature word.
15. **Growing ORDER (user-added items)** — belongs with the growing-list
    kind and the addRows permission, not in ORDER v1.

## 6 · System fit

- **Coercion matrix: zero new cells.** ORDER and MIXER jacks are plain
  scalars; SELECT and GROUP have none.
- **New lib surface: one item** — variable multi-jack count (MIXER's
  N channel jacks, 2–5, config-driven). Pad's fixed-2 generalizes; the
  workbench normalizer already drops dangling wires.
- **New workbench surface:** GROUP frame + slot-voice authoring +
  speaker-level card rule + member-silence gating; the ORDER/MIXER/
  SELECT spellers; the named-stops rider on dial/slider.
- **Contract untouched:** no new viz, no new slot mode, no new rail
  edge, no write-back extension (MIXER × LIGHT GRID uses the existing
  slot.set path; the rebalance lives inside control.set).
- **Build order:** SELECT (cheapest, immediate pack value) → ORDER (the
  motion showcase) → MIXER (+ variable multi-jack) → GROUP VOICE (wants
  the other three's spellers mature; first wave of the packs round) →
  named-stops rider (any time; before GROUP ships).
- **Speech space, after round 5:** magnitude (dial/slider), on/off
  (switch), count, text (words), position (pad), constraint
  (range/filter), shape (curve), **order (ORDER), proportion (MIXER),
  choice (SELECT), fusion (GROUP)**. Each verb owned by exactly one
  piece; no piece owns two. That is the Lego elegance the round was
  asked for — and the honest place to stop: the next genuinely new
  verbs (probability, reference/attachment, shared vocabularies) all
  need engine or runtime surface no control can smuggle in.
