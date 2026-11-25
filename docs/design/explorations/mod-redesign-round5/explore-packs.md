# Preset mod packs — six instruments after EXPLORER (concept)

Design exploration for the Mod workbench. Extends the EXPLORER mechanic
(pre-wired cluster + authored per-band frames + auto-created section,
`dropExplorer()` in `mod-workbench-v2.html`) into a shelf of preset packs.

The Lego rule applied throughout: every piece is a stock control from the
inventory; the pack is only **wiring + authored frames + placement**. Zero new
engine surface for five of the six packs (one one-line spec note on TRANSLATOR).

Accent palette used below (the 8 accents in the prototype seed):
amber `#eca23b` · blue `#3f78df` · purple `#a946c8` · green `#24986a` ·
sky `#48a2ef` · pink `#d66be8` · coral `#f1666d` · ink `#222222`.

Frame-authoring bar (from explore-branching §4): imperative sentences a model
actually obeys; concrete quantities where they help; **deliberate silence at
the default band** — a mid-position control that matches model default says
nothing, so an untouched pack emits a short, sharp prompt, not boilerplate.
Band split as implemented: value <34 low, 34–66 mid, >66 high; `null` = silent.

---

## The set at a glance

| Pack | Job (one line / shelf tooltip question) | Visualizer(s) | Section |
| --- | --- | --- | --- |
| NARRATOR | shapes how the answer sounds — "How should it sound?" | SEMANTIC WAVE (+ RADAR as the hands) | VOICE |
| EDITOR | sets the hard limits and catches contradictions — "Where are the walls?" | WINDOW | RULES |
| SKEPTIC | sets how much proof the answer must carry — "What must it prove?" | LEVELS | PROOF (new) |
| STORYTELLER | shapes how the answer moves from start to end — "How should it move?" | SCORE | SHAPE OF THE ANSWER |
| TRANSLATOR | fits the answer to who's reading — "Who is this for?" | BANDINGS | READER (new) |
| ANCHOR | keeps the answer tied to one point — "What must it serve?" | CONSTELLATION | APPROACH (shared with EXPLORER) |

Roster overlap across packs: no two packs share more than one control title or
the same visualizer. EXPLORER + ANCHOR share only the APPROACH address, which
is the point — sections are shared mail slots, not pack property.

---

## 1 · NARRATOR — shapes how the answer sounds

The seed scene already *is* this pack, unwired-into-a-preset: five voice
controls feeding the wave and radar. NARRATOR formalizes it and fixes its one
real weakness — the seed dials have no band frames, so they emit the weak
"Warmth: 7 of 10". Near-free to build.

### Roster + wiring

| Control | Kind | Accent | Wave input | Radar |
| --- | --- | --- | --- | --- |
| WARMTH | dial | amber | HEIGHT | axis 1 |
| PACE | dial | blue | SPEED | axis 2 |
| DETAIL | dial | purple | RIPPLE | axis 3 |
| CONFIDENCE | slider | green | STEADY | axis 4 |
| FORMALITY | slider | sky | GRID | axis 5 |
| WRITE AS IF FOR | words | coral | — | — |

WAVES input stays unwired (living default). Two visualizers, two roles:
**RADAR is the hands** (two-way — drag a vertex, the dial follows), **WAVE is
the ears** (one-way texture read). Advanced users can delete either; the pack
still works.

### Frames (defaults all mid; silences marked)

- WARMTH — low: "Keep the tone cool and matter-of-fact." · mid: *silent* ·
  high: "Write warmly, like a colleague who wants this to land."
- PACE — low: "Take it slowly — short steps, one idea at a time." ·
  mid: *silent* · high: "Move briskly — assume the reader keeps up."
- DETAIL — low: "Stay at the headline level; skip fine detail." ·
  mid: "Give enough detail to act on, no more." ·
  high: "Go into fine detail wherever it earns its place."
- CONFIDENCE — low: "Present options rather than verdicts; flag uncertainty
  plainly." · mid: "Take positions, and say how sure you are." ·
  high: "Take firm positions; state them as decisions, not suggestions."
- FORMALITY — low: "Write informally — contractions, plain talk." ·
  mid: *silent* · high: "Keep it formal and polished throughout."
- WRITE AS IF FOR — frame `Write as if for {value}.` (empty = silent).

Dropped untouched, NARRATOR says only the DETAIL and CONFIDENCE mid lines —
two sentences, both useful. That's the silence discipline paying rent.

### Board layout (roughly 13×5)

```
[WAVE 8×4        ] [WARMTH][PACE ]
[                ] [DETAIL][CONF ]
[RADAR 5×5][FORMALITY][WRITE AS IF FOR 3w]
```
Wave top-left (the face), radar below, the six controls in a 2-col rack on the
right so cables run left into both visualizers. Reads as one desk: knobs right,
meters left.

### Why it's a pack

Any one dial is a sentence. Wired together, the wave shows the *composite
texture* of the voice — turn FORMALITY up and the whole surface snaps to the
grid while the sentence changes in the same beat — and the radar gives the
voice a *shape you can grab*. Picture, handle, and words are one state.

---

## 2 · EDITOR — sets the hard limits and catches contradictions

The only pack whose visualizer computes a *relationship* between controls
rather than displaying them side by side. WINDOW draws the intersection of
every span; the yellow seam appears when limits disagree — the contradiction
is caught on the board, before the AI ever sees the prompt.

### Roster + wiring

| Control | Kind | Accent | Config | Window |
| --- | --- | --- | --- | --- |
| LENGTH | filter | green | NO MORE THAN; stops: A SENTENCE / A PARAGRAPH / A SECTION / A PAGE / AN ESSAY | lane 1 |
| NOVELTY | range | purple | BETWEEN; stops: PROVEN / FAMILIAR / FRESH / UNTESTED / WILD | lane 2 |
| JARGON | filter | sky | NO MORE THAN; stops: NONE / A FEW TERMS, EXPLAINED / WORKING VOCABULARY / FULL TECHNICAL | lane 3 |
| NO HEDGING | switch | ink | off by default | — |
| NOTHING INVENTED | switch | coral | **on** by default | — |

### Frames

Filters and ranges speak span phrases through the engine's named stops — the
frame's job is to make the phrase land as an order:

- LENGTH — `Keep the whole answer to {value}.` → "…to no more than a page."
- NOVELTY — `Keep the ideas {value}.` → "…between familiar and fresh."
- JARGON — `Technical language: {value}.` → "…no more than a few terms,
  explained."
- NO HEDGING — on: "Do not hedge." · off: *silent*.
- NOTHING INVENTED — on: "If you don't know, say so — never invent." ·
  off: *silent*.

No band frames needed: named stops make every span sentence read authored.
This pack is the proof that the stop-naming mechanic *is* frame authoring for
span kinds.

### Board layout (roughly 9×5)

```
[LENGTH  3w][NOVELTY 3w]
[JARGON  3w][NO HEDG][NOTHING INV]
[WINDOW 6×2                      ]
```
Three span controls stacked as rails, window beneath them as the sum — the
layout literally reads "these lanes, intersected."

### Why it's a pack

Each limit alone is obvious. Together the window shows what nobody can see
control-by-control: *how much room is left* once every wall is up, and the
seam the moment two walls cross. It's the only place in the system where
turning one control changes the meaning of another visibly.

---

## 3 · SKEPTIC — sets how much proof the answer must carry

The rigor desk. LEVELS is the right lens because rigor is a budget: 10-seg
bars show which quality dominates and how much headroom is left before the
prompt becomes a demand for a literature review.

### Roster + wiring (all → PROOF, auto-created)

| Control | Kind | Accent | Levels bar |
| --- | --- | --- | --- |
| EVIDENCE | dial | green | bar 1 |
| SHOW DOUBT | dial | amber | bar 2 |
| SOURCES | count | blue | bar 3 |
| SPECULATION | filter | purple | bar 4 (hi bound) |
| COUNTERCASE | switch | coral | — |

### Frames

- EVIDENCE — low: "Assertions are fine; skip citations." ·
  mid: "Back key claims with evidence or a source." ·
  high: "Back every claim with evidence; cite as you go."
- SHOW DOUBT — low: *silent* ·
  mid: "Flag genuine uncertainty wherever it's material." ·
  high: "Attach a confidence level to every claim."
- SOURCES — `Draw on at least {value} distinct sources.` (0 = silent).
- SPECULATION — NO MORE THAN; stops: NONE / CLEARLY LABELED / A LITTLE /
  FREE. Frame `Speculation allowed: {value}.`
- COUNTERCASE — on: "Steelman the strongest case against your answer before
  concluding." · off: *silent*.

### Board layout (roughly 8×5)

```
[EVIDENCE][SHOW DOUBT]  [LEVELS 4×4]
[SOURCES ][COUNTERCASE] [          ]
[SPECULATION 3w      ]  [          ]
```

### Why it's a pack

"Be rigorous" is the vaguest instruction in prompting. Decomposed into four
independent budgets with one meter, rigor becomes *dosable* — you can ask for
heavy evidence with zero doubt-marking, or light evidence with a steelman,
and the bars show the recipe at a glance. The pieces alone are nags; together
they're a standard of proof.

---

## 4 · STORYTELLER — shapes how the answer moves from start to end

The time instrument. Three curves on the same timebase ("across the answer")
stacked in SCORE — the visualizer built for exactly this and used nowhere
else. Addresses SHAPE OF THE ANSWER.

### Roster + wiring

| Control | Kind | Accent | Config | Score |
| --- | --- | --- | --- | --- |
| TENSION | curve | coral | timebase: the answer, 3pt, default low→peak→settle | lane 1 |
| DETAIL | curve | purple | timebase: the answer, 3pt, default flat-mid | lane 2 |
| WARMTH | curve | amber | timebase: the answer, 3pt, default rise-late | lane 3 |
| OPEN WITH | words | blue | placeholder "a hook, not a summary" | — |
| CLOSE WITH | words | green | placeholder "one thing to do next" | — |

### Frames

Curves speak through `spellSeries` ("opens low, rises to a peak, settles");
the frame turns the shape into an instruction:

- TENSION — `Shape the tension across the answer: {value}.`
- DETAIL — `Let the level of detail move across the answer: {value}.`
- WARMTH — `Let the warmth move across the answer: {value}.`
- OPEN WITH — `Open with {value}.` · CLOSE WITH — `Close with {value}.`
  (empty = silent)

Note the engine rule already covers the subtlety: a flat curve is NOT silent
— "hold the detail steady" is a choice, and the score shows a flat lane as
exactly that.

### Board layout (roughly 9×6)

```
[TENSION 3w][SCORE 6×4    ]
[DETAIL  3w][             ]
[WARMTH  3w][             ]
[OPEN WITH 3w][CLOSE WITH 3w]
```
Curves stacked left in the same vertical order as their score lanes — control
n is beside lane n; the wiring is legible with zero cable-tracing.

### Why it's a pack

One curve is a wiggle. Three curves on one timebase, stacked, are a
**storyboard**: you can see the climax (all three peak together), the cold
open (tension high while warmth is low), the soft landing. No other
combination in the inventory makes *time* visible, and time is the one
dimension prose instructions handle worst.

---

## 5 · TRANSLATOR — fits the answer to who's reading

The audience desk. WHO (words) + WHERE THEY ARE (pad) + THE MIX (three dials
into BANDINGS). Bandings is right because an audience decision is a
share-of-whole decision: more examples means less of something else, and
strata show that trade honestly.

### Roster + wiring (all → READER, auto-created)

| Control | Kind | Accent | Config | Bandings |
| --- | --- | --- | --- | --- |
| THE READER | words | coral | placeholder "a new team member" | — |
| MEET THEM | pad | blue | X: NEWCOMER↔EXPERT · Y: SKIMMING↔STUDYING | — |
| EXAMPLES | dial | purple | | band 1 |
| TECHNICAL DEPTH | dial | ink | | band 2 |
| BIG PICTURE | dial | amber | | band 3 |

### Frames

- THE READER — `The reader is {value}.`
- MEET THEM, X axis — low: "Assume no background — explain everything from
  scratch." · mid: *silent* · high: "Assume deep expertise — skip the basics
  entirely."
- MEET THEM, Y axis — low: "Write for a skimmer: front-load the point, make
  the load-bearing lines findable." · mid: *silent* · high: "Write for close
  study — the reader will weigh every word."
- EXAMPLES — low: *silent* · mid: "Ground each main point in one concrete
  example." · high: "Lead with examples — teach through cases, then
  generalize."
- TECHNICAL DEPTH — low: "Keep technical machinery out of view." ·
  mid: *silent* · high: "Show the technical machinery — the reader wants the
  internals."
- BIG PICTURE — low: *silent* · mid: "Anchor details to the big picture as
  you go." · high: "Keep returning to why this matters — the big picture
  leads."

**One-line spec note:** pad axes currently take one frame per axis with a
`{value}`% slot; the quality bar wants per-band frames per axis. The engine
doc already grants bands to ranges ("may get one per band") — extend the same
optional `bands` to pad axes. Data-only, same emission path as dials.

### Board layout (roughly 9×5)

```
[THE READER 3w ][EXAMPLES][TECH DEPTH]
[MEET THEM 3×3 ][BIG PICT][BANDINGS 4×3]
[              ][         (strata)    ]
```

### Why it's a pack

WHO, WHERE THEY ARE, and WHAT MIX THEY GET are three different questions that
only make sense answered together — an expert skimmer and a studying newcomer
need opposite mixes. The bandings strata make the mix a single object you
balance, instead of three dials you forget interact.

---

## 6 · ANCHOR — keeps the answer tied to one point

The focus desk, addressed to APPROACH (EXPLORER's section — they compose:
EXPLORER says how to search, ANCHOR says what the search must serve).
CONSTELLATION is the lens: node agreement = coherence, and the DRIFT slot —
the one input in the whole inventory that owns idle motion — is wired to
STRAY, so loosening focus literally sets the web adrift.

### Roster + wiring

| Control | Kind | Accent | Constellation |
| --- | --- | --- | --- |
| THE POINT | words | ink | node |
| STRAY | dial | blue | node + **DRIFT** |
| TIE BACK | dial | green | node |
| ONE ARGUMENT | switch | coral | node |

### Frames

- THE POINT — `Everything must serve this point: {value}.`
- STRAY — low: "Never leave the main point — no asides." · mid: "Brief
  asides are fine if they return quickly." · high: "Roam freely — a tangent
  is welcome if it enriches the point."
- TIE BACK — low: *silent* · mid: "Tie each section back to the main point." ·
  high: "End every paragraph by connecting it back to the main point."
- ONE ARGUMENT — on: "Make exactly one argument — resist covering
  everything." · off: *silent*.

### Board layout (roughly 8×4)

```
[THE POINT 3w][CONSTELLATION 4×4]
[STRAY][TIE BACK][             ]
[ONE ARGUMENT 2w][             ]
```

### Why it's a pack — and why it's the weakest

The DRIFT wiring is a genuinely great moment: STRAY up and the picture itself
wanders. But the constellation's core read — "do these settings agree?" — is
a weaker match for "is the *answer* on-topic" than the other five
pack/visualizer marriages; the picture is honest about control agreement, not
about focus per se. Four controls also make a thin cluster. **Ship last, or
fold its four controls into a library "starter" that has no visualizer.**
Flagged as the cut candidate if the shelf should stay at six entries
including EXPLORER.

---

## BRAINSTORM — the EXPLORER sibling: NOT a pack

Verdict: **cheap as a shelf entry, valuable as preset chips.** Same tree, same
five dials, opposite values = 100% roster overlap = a variant by the brief's
own rule. The engine already has the right mechanism: *presets are named
value-sets on the template* (mod-prompt-engine.md, Presets and faces). So:

- EXPLORER ships with three preset chips on its face:
  **SURVEY** (breadth 85, depth 30, prune 15, wander 75, commit 10),
  **BALANCED** (the current defaults),
  **DECIDE** (breadth 45, depth 60, prune 85, wander 25, commit 95).
- One shelf entry, one tree, three one-tap postures. The chips are also the
  first live demo of the preset mechanic itself.

Same ruling applies to any future "gentler NARRATOR" etc. — value-sets ride
the pack, only new rosters earn shelf entries.

---

## The pack shelf — MODS group UX at ~7 entries

- **Placement:** the existing third palette group, `Mods`, grows in place. No
  new chrome at this scale; groups already collapse visually by heading.
- **Naming:** one word, plain, mono-caps, agent-noun where possible — the
  pack is a colleague you hand the prompt to (NARRATOR, EDITOR, SKEPTIC,
  TRANSLATOR, STORYTELLER, EXPLORER, ANCHOR). No two entries share a first
  letter except ex-/ed- — scan-friendly.
- **Ordering:** the order you'd shape a prompt in, top to bottom:
  TRANSLATOR (who) → NARRATOR (sound) → EXPLORER (think) → ANCHOR (serve) →
  SKEPTIC (prove) → STORYTELLER (move) → EDITOR (walls). Limits last is
  deliberate: walls are set after there's something to wall in.
- **Tooltip:** the existing question-line convention (visualizers already do
  it via `title`): "Who is this for?" / "How should it sound?" / "How should
  it think?" / "What must it serve?" / "What must it prove?" / "How should it
  move?" / "Where are the walls?" — seven questions that together are a
  complete prompt checklist, which is itself the shelf's pitch.
- **Icons:** distinct glyphs, never reusing the wired visualizer's glyph
  (EXPLORER's `⑂` is grandfathered): TRANSLATOR `⇄`, NARRATOR `“`→ no,
  collides with WORDS — use `♪`; EXPLORER `⑂`; ANCHOR `⌖`; SKEPTIC `?`→ too
  thin — `≟`; STORYTELLER `⌒`→ collides with CURVE — `↝`; EDITOR `▐`→
  collides with WINDOW — `‖`.
- **Drop behavior (EXPLORER precedent, made a rule):** a pack drop places
  the cluster with push, wires it, and *finds-or-creates* its section.
  Second drop of the same pack reuses the section — sections are addresses,
  never duplicated.
- **Beyond ~8 entries** (future): the group gains the same named-stops
  discipline as everything else — sub-headings by question ("WHO / HOW /
  WHAT"), not a search box. Not needed at seven.

---

## Build order (opinionated)

1. **NARRATOR** — the seed scene already wires it; work = band frames + a
   `dropNarrator()`. One session. Also immediately upgrades the demo everyone
   sees first.
2. **EDITOR** — window + span stops all exist; the contradiction seam is the
   best live-demo moment in the system.
3. **SKEPTIC** — pure existing parts; PROOF section exercises
   find-or-create beyond APPROACH.
4. **STORYTELLER** — score + curves exist; needs care that three curve
   controls don't feel heavy on the board (they're 3-wide each).
5. **TRANSLATOR** — carries the one spec note (pad-axis band frames);
   everything else stock.
6. **ANCHOR** — weakest marriage (see above); build only if the shelf wants a
   seventh voice, or demote to a visualizer-less starter.

Plus, alongside any of 1–5: **EXPLORER preset chips** (SURVEY/DECIDE) — tiny,
and it makes the presets mechanic real.

---

## What this exploration surfaced about the system

- **Named stops are frame authoring for span kinds.** EDITOR needed zero band
  frames; the stop vocabulary did all the work. Packs should lean on stops
  before bands wherever the kind allows.
- **Silence discipline is what keeps packs stackable.** All six packs dropped
  together at defaults emit ~8 sentences total, not 30. Mid-band silence is
  the single most important authoring rule in the frame bar.
- **Every visualizer now has exactly one pack that owns it** (wave+radar →
  NARRATOR, branches → EXPLORER, window → EDITOR, levels → SKEPTIC, score →
  STORYTELLER, bandings → TRANSLATOR, constellation → ANCHOR). Matrix and
  light grid remain unclaimed — honest: no pack-shaped job fell out of them.
  Matrix wants a future "weigh the options" desk (criteria×options) but that
  needs the answer to *be* a decision, which is a task property, not a prompt
  property; parked.
- **Sections are the composition layer.** Packs compose because each speaks
  to one address; a board with NARRATOR + SKEPTIC + EDITOR compiles into a
  prompt whose sections read like a brief written by one person. That's the
  Lego elegance: the studs are the four-plus-N sections, not the controls.
