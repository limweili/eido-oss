# Controllers, transformers, and the two axes — concept report

Explorer report for the Mod workbench redesign; written to serve as the
spine of the PRD's architecture section. Inputs: weili's three controller
ideas (envelope / routing / feedback) plus the three-tier taxonomy
(SHAPERS / TRANSFORMERS / CONTROLLERS). Grounding:
`research/07-mod-design-prototypes/mod-instrument-redesign/lib/DESIGN.md` (SPEC 03),
`docs/design/explorations/mod-redesign-round4/explore-curves.md`,
`docs/design/mods/prompt-engine.md`, `prototypes/mod-workbench-v2.html`
(KINDS table, total-coercion matrix, series speller, `KIND_SECTION`).
Sibling explorations own preset packs and order/mixer/composite-voice —
nothing here touches those.

Verdict register up front:

| Piece | Verdict |
| --- | --- |
| Two-axis architecture (UI kind × execution tier) | the category decision — adopt |
| Compiled envelope | SHIPPED (the curve is it) |
| STAGE control + curve POSITION jack | PROTOTYPE-BUILDABLE |
| Renamable x-detents (stage names) | PROTOTYPE-BUILDABLE (promote from deferred) |
| Fidelity chip + mod-level FAST◄──►PRECISE lever | PROTOTYPE-BUILDABLE |
| FORK control (compiled routing) | PROTOTYPE-BUILDABLE |
| REVISE control (compiled feedback) | PROTOTYPE-BUILDABLE (small) |
| Transformer modules on the board + plan strip | PROTOTYPE-BUILDABLE (simulation, no fake artifacts) |
| Artifact cables (fourth payload) | ENGINE-SURFACE (board presence simulable) |
| The run plan (all executed forms) | ENGINE-SURFACE — the one big PRD record |

---

## A. The category decision: TWO ORTHOGONAL AXES, not a third part class

weili's tiers are about **what a part compiles to**, not what it looks
like. Keep the axes separate:

- **UI axis** (lib grammar, unchanged): *control* (has a value, emits) /
  *visualizer* (lens, no value, never emits). Plus one genuinely new UI
  class forced by the taxonomy: the *step* (a transformer's board body —
  §C). Three UI classes total, and that is the ceiling.
- **Execution axis** (engine semantics, new): **SHAPER** — compiles into
  the one prompt; **TRANSFORMER** — a real call producing an intermediate
  artifact; **CONTROLLER** — inspects results and decides what happens
  next.

How they cross:

| | SHAPER | TRANSFORMER | CONTROLLER |
| --- | --- | --- | --- |
| board body | control (dial, curve, …) | **step** module | control (FORK, REVISE, STAGE) |
| compiled form | its sentence (today's engine, whole) | a "do this as part of the work" clause | a decide/revise scaffold sentence |
| executed form | — (always compiled) | one real call, artifact out | a decision point / loop guard in the run plan |
| exists today | everything on the board | nothing | nothing |

Two consequences, both load-bearing:

1. **Everything the workbench has today is a SHAPER** — and stays one.
   The tier is not a property the user sets on a dial; shapers have no
   fidelity. Only transformers and controllers carry the FAST◄──►PRECISE
   axis, because only they have two honest forms.
2. **A controller is still a control** in lib grammar: it has a value,
   emits deterministically, gets one card. The controller-ness lives in
   *what it says* (it addresses the process) and *what it becomes when
   executed* (a decision point). No new lib component class for
   controllers; the step (§C) is the only new body.

**Palette**: grouped by UI kind with plain-word headings —
`CONTROLS` (shapers) / `PROCESS` (controllers: STAGE, FORK, REVISE) /
`STEPS` (transformers: EXPLORE, CLUSTER, CRITIQUE, …) / `VISUALIZERS`.
Palette headings are navigation, not ontology; the grammar underneath is
the table above. "Transformer", "controller", "shaper" are PRD words —
they never appear in the UI.

**Address**: process-speaking parts default-address **"How to approach
it"** via the existing `KIND_SECTION` registry pattern (exactly how
range/filter default to RULES).

### The fidelity control — per-item AND per-mod, resolved by AUTO

- **Per-item**: a foot chip on every transformer and controller — the
  filter mode-chip pattern verbatim (micro caps, quiet text affordance,
  cycles on click, mirrored in config): `ONE PASS · IN STAGES · AUTO`.
  Default AUTO. One vocabulary, specced once in DESIGN.md, identical on
  every part that carries it.
- **Per-mod**: one lever in the mod head — a small slider,
  `FAST ◄──────► PRECISE`, plain words at the ends. It resolves every
  AUTO: at FAST all AUTOs compile; at PRECISE all AUTOs execute; pinned
  chips ignore it. This is the instrument story: one master lever the
  user can ride, per-item pins for the creator who knows better.
- Compiled/executed **never disagree with the picture**: the compiler
  shows exactly what the current resolution produces (§C3's plan strip
  appears only when something actually resolves to IN STAGES).

---

## B. ENVELOPE — compiled = SHAPER we already shipped; executed = curve driving a TRANSFORMER chain; fidelity = the tier switch made visible

### B1. Same primitive — reconciliation table

weili's envelope decomposes onto shipped anatomy 1:1:

| weili's envelope part | Ours |
| --- | --- |
| normalized 0.0→1.0 lifecycle position | the series `t` (0–100) |
| control points (start 9 / mid 6 / end 2) | the curve's 2–5 points on speakable detents |
| curve smoothness | v2 per-segment tension (already deferred, spoken coarsely) |
| target parameter | the curve's title + frame (the quality being shaped) |
| interpretation prose | frame + description — already exists, already speaks |
| lifecycle choice | the **timebase config** ("the answer" / "steps of the task" / "items in the list") |
| user's simple 3-point view | the curve face IS the 3-point view |
| envelope name | the label |

DESIGN.md's rejection register already ruled it: *"Separate envelope /
LFO / sequencer kinds — all one curve with configs."* **Envelope is not a
new control.** The compiled envelope is the curve we shipped, told in
lifecycle vocabulary. Extend the curve only where weili's idea genuinely
adds: the user-controlled provider (B3) and the fidelity chip (A).

### B2. Progress providers, mapped

| weili's provider | Status |
| --- | --- |
| document-writing / single generation | **shipped** — timebase "the answer" |
| stage-based (Explore/Organise/Critique/Finalise), 5-stage workflow, idea-development | timebase "the steps of the task" + **promote creator-renamable x-detents from the deferred register** — the stage names are exactly what that deferral was waiting for |
| turn-based (conversation) | **stays deferred** — round-4 verdict holds (needs persistent-mod runtime; the series already carries the data). Absent from the menu on purpose. |
| token/completion | reject — weili flags it hard in one call; invisible to the user, teaches nothing |
| event-based (workflow state) | this IS the executed form — run-plan territory (§B5) |
| **user-controlled** | **NEW — the STAGE control** (B3) |

### B3. The STAGE control — honest where the playhead was a lie

Round 4 rejected the playhead because it promised a runtime the medium
doesn't have: "now" was preview fiction that never reached the compiler,
so a persistent handle for it would be chrome that lies. weili's
`[EXPLORE]──●──[COMMIT]` is a different animal: **the position is a user
value that EMITS.** "We are at the committing stage" is a true fact about
the user's session, stated into the prompt, changing what the model does.
The playhead pretended *execution* had a position; STAGE declares the
*work* has one, and the user is the authority on it. Emits ⇒ honest. The
two coexist: scrub = momentary, board-owned, never emits; STAGE =
persistent, user-owned, always emits.

Shape: **it is a slider** — a scalar with named stops. Lib change is
tiny: extend the `stops` config (already on range/filter, with the
named-stop fallback rule already written) to the slider kind. No new
anatomy, value shape, or jack glyph.

```
  STAGE                                     ●── jack (scalar)
  ├────────●─────────┼─────────┼─────────┤
  EXPLORING                        COMMITTING
  readout: ORGANISING
```

Own card (per-stop frames = the existing per-band-frames pattern):
`"We are organising now — stop widening; sort and tighten what's here."`

**Wired STAGE → curve = the POSITION input.** The curve gains one scalar
input jack, POSITION — legalized exactly as the deferred GAIN jack was:
*the face is already a picture*. The face draws the wired position as a
vertical accent hairline on the well; emission speaks what you see. With
POSITION wired the card changes from trajectory to sampled-now-plus-
trajectory:

> "Breadth: 6 of 10 right now (midway through the work) — narrowing from
> here toward 2 of 10 at the finish."

Unwired, the curve speaks the whole trajectory as today. Deterministic
both ways; total coercion already lets any scalar plug there — STAGE is
just the legible source. This is weili's drift control: the user drags
the system through the lifecycle.

### B4. Compiled emissions per provider (concrete)

- **the answer** (shipped speller): "Breadth over the answer: open at 9
  of 10, settle to 2 of 10 by the end."
- **steps of the task, renamed detents** (POS_WORDS become the creator's
  stage names): "Breadth as you work: exploring at 9 of 10, organising
  at 6 of 10, finish committed at 2 of 10."
- **items in the list** (shipped): "…9 of 10 for the first items, easing
  to 2 of 10 for the last."
- **user-controlled** (STAGE wired): the sampled form in B3.
- **conversation**: not in the menu.

### B5. Executed envelope = the curve driving a transformer chain

weili's executed example — Stage 1 broad generation / Stage 2 narrowing /
Stage 3 final selection — is not "the curve, run three times." Each stage
is a **transformer invocation** (EXPLORE → CLUSTER/CRITIQUE → COMPRESS),
and the envelope's job is to *modulate* the chain: sample the curve at
each stage's position and apply that value to that call. The curve is the
modulation source; the chain is the signal path — precisely the audio
architecture weili is reaching for.

So the executed envelope needs no envelope-specific machinery: it is
curve (shipped) + transformer chain (§C) + run plan (§E). Fidelity chip
on the curve resolves it: `ONE PASS` = today's card; `IN STAGES` = the
curve's clauses distribute onto the plan strip's stages (§C3). What "IN
STAGES" renders when NO chain is on the board: the speller's collapsed
point-groups become the stages (a 3-point curve → 3 generic stages) —
shown as a plan strip so the cost of the choice is visible.

### B6. The three-slider Simple view

weili's "three sliders: beginning/middle/ending" maps to the engine doc's
**Simple/Advanced faces**: three Simple-face sliders write-back-wired to
one curve's three points (one state, many handles — the visualizer
write-back rule applied to a face). No new machinery; faces aren't in the
workbench's scope and sit nearer the sibling explorations. Record the
mapping; don't build here.

---

## C. TRANSFORMERS — the step: a new UI class, concept treatment

The genuinely new tier. A **step** is a verb-module — EXPLORE, CLUSTER,
CRITIQUE, COMPRESS, REFRAME, DEVELOP, COMBINE — that takes work in and
puts transformed work out. It is not a control (its output is not a
sentence into the prompt; it holds no user value in the shaper sense) and
not a visualizer (it acts). Third UI class, and the last one.

### C1. The artifact — a fourth payload, and a SECOND CABLE FAMILY

What flows between steps is an **artifact** (a draft, a cluster set, a
critique). This must NOT join the total-coercion trio: an artifact does
not coerce to a scalar, and pretending it does would put a lie in the
matrix that holds the signal model together. Resolution from the
instrument world: **signal cables and artifact cables are different
connector families** — you cannot plug a patch cable into a MIDI port,
and nobody calls that an error state; the jacks visibly don't mate.

- **Signal family** (scalar / span / series): total coercion, unchanged.
- **Artifact family**: plugs only artifact-to-artifact. Jack glyph: a
  small square in the ring (dot / capsule / polyline / **square**).
  Cable rendering: wider, ink-colored (signal cables stay thin and
  accent-colored) — legible at a glance which layer a wire lives in.
- Steps also accept **signal inputs** as modulation (a curve's POSITION-
  sampled value, a dial into EXPLORE's breadth) — ordinary scalar jacks
  on the step's left edge, below the artifact input. This is how the
  executed envelope modulates the chain (§B5).

Artifact *contents* are ENGINE-SURFACE, full stop. The prototype may
render the family (jacks, cables, chains) but never fakes an artifact's
content — no lorem-ipsum drafts.

### C2. Step anatomy (board presence)

```
 ┌ EXPLORE ──────────────────┐
 ▣  in                       │
 │   breadth ●──(signal in)  ▣  out
 │   "range widely; ten      │
 │    unlike directions"     │
 └──────────── IN STAGES ────┘
```

- Panel chip like a control, **verb as the label**, identity dot as
  usual. Body: the creator's instruction prose for the verb (one quiet
  sentence, editable in config) — the step's "frame".
- Artifact-in ▣ on the left edge, artifact-out ▣ on the right (the
  output-jack overhang rule). Signal inputs below artifact-in, per-verb
  (EXPLORE: breadth; COMPRESS: how hard; CRITIQUE: strictness).
- Foot chip: the shared fidelity vocabulary (`ONE PASS · IN STAGES ·
  AUTO`). A step at ONE PASS **compiles into the prompt as an approach
  clause** — "As part of the work: explore widely before settling" —
  which is honest and cheap; at IN STAGES it becomes a real call in the
  plan. This is the taxonomy's key subtlety: a transformer *degrades
  gracefully into a shaper sentence*, so a chain is useful at every
  point on the mod's FAST◄──►PRECISE lever.
- Min footprint 3×2. One card in the compiler when compiled (one card
  per speaking part, held); when executed, it appears in the plan strip
  instead — a part speaks in exactly one register at a time.

### C3. Honest prototype simulation — the PLAN STRIP

The compiler grows a second region below the four sections: **THE PLAN**,
visible only when something resolves to IN STAGES. It renders the
transformer chain (artifact-cable order) as a horizontal strip of stage
segments — one segment per call the run plan would make:

```
 THE PLAN                                          3 CALLS
 ┌──────────────┬───────────────┬─────────────────┐
 │ ▸ EXPLORE    │ ▸ CLUSTER     │ ▸ COMPRESS      │
 │ breadth 9/10 │ breadth 6/10  │ breadth 2/10    │
 │ range widely │ sort + name   │ one recommend-  │
 │              │ the groups    │ ation, decided  │
 └──────────────┴───────────────┴─────────────────┘
```

Each segment: verb, the modulating signal values *sampled at that stage's
position* (the executed envelope made visible), the step's prose. Pill:
`N CALLS`. Everything is a pure function of board state — a legitimate
deterministic simulation, PROTOTYPE-BUILDABLE. What it must NOT do:
show artifact contents, animate execution, or claim timing. It is a
plan drawing, and reads as one.

(Round 4 rejected per-point compiler cards because points "aren't
independently addressable." In the plan, stages ARE independently real —
the rationale flips, and the strip is one element per call, not one card
per point of one control.)

### C4. EXPLORE the step vs BRANCHES the lens — related, kept apart

BRANCHES answers "how will the AI search?" — a picture of *compiled*
exploration wired from shaper values; it executes nothing and must stay
that way. EXPLORE the step actually fans out. The honest relationship:
**the lens pictures the prompt; the plan strip pictures the plan** — two
different truths, two different surfaces, and the lens never reads plan
structure (visualizers read control values only; the viz contract's
question-uniqueness holds because "how will one call search" ≠ "what
calls will run"). If a creator wants both on one board, nothing
collides — and the pairing is even good pedagogy: turn the mod lever to
PRECISE and watch the plan strip appear while BRANCHES keeps picturing
the (now smaller) compiled remainder.

### C5. What is plainly PRD-territory

Real execution, artifact storage/inspection, intervene-between-stages,
per-stage provenance, retry of a failed stage, cost display. Also the
verb catalog itself as an engine registry (each verb = a fixed mechanic +
creator prose, exactly the control-emitter pattern at the call level).

---

## D. CONTROLLERS — inspect-and-decide: one config anatomy, two faces

weili's controller list — routing, quality feedback, retry rules,
stopping conditions, complexity adaptation — are all the same sentence:
**watch something, and when it crosses a line, act**. Give them ONE
config anatomy (the CHECK BLOCK) and exactly TWO board faces (FORK,
REVISE). The rest are authored instances, not new kinds.

### D1. The check block (shared config anatomy)

| Field | Plain-word config label | e.g. |
| --- | --- | --- |
| watch | "look at" | "whether this needs looking things up" / "how clear the draft is" / "how hard the question is" |
| bands | "when" | 2–3 named outcomes (paths or verdicts) |
| act | "then" | per-band: a path's prose / revise / redo / stop / effort level |
| limit | "at most" | passes / retries budget |

The words "classifier", "evaluator", "threshold", "signal" never appear —
config speaks look-at / when / then / at-most; faces speak even less.

Mapping weili's list: **routing** = check block whose acts are paths
(FORK). **Quality feedback** = watch a quality, act = revise (REVISE).
**Retry rules** = REVISE with act = redo-from-scratch (a config toggle:
"fix it" vs "start over"). **Stopping conditions** = the limit field +
an accept band — the run plan's loop guard, not a separate control.
**Complexity adaptation** = FORK whose watch is "how hard is this" and
whose paths are effort levels ("quick answer" / "take it step by step") —
an authored FORK instance, ships as a library preset, not a kind.

### D2. FORK — compiled routing, PROTOTYPE-BUILDABLE

Reconciliation with the engine's wires: **select** routes the *board*
(A's choice picks B's frame, decided by the user at set time); FORK
routes the *model's process*, decided by the model at run time. Different
layer; FORK replaces neither gate nor select.

- **Creator authors** (check block): the look-at question, plain words;
  2–3 paths `{name, prose}`. Config grows per-path blocks — the pad's
  axis-blocks pattern, already sanctioned.
- **User's handle**: the **lean** — what to do when it's a coin flip.
  Scalar value, scalar jack.
- **Face**: a junction in ink — one line entering left, fanning to 2–3
  path lines right, path names in micro caps at the ends; round ink lean
  handle on a short arc across the fan; the favored path at full ink
  weight, others faint (the control carrying a picture of its own
  value). Min 3×2.

```
              ┌───────  LOOK IT UP
   ──────────≺●
              └╌╌╌╌╌╌╌  JUST ANSWER
   readout:  LEANS · LOOK IT UP
```

- **Compiled emission** — ONE card, the decide scaffold (never branch
  cards; branch cards would picture a branching one call doesn't have):

  > "First decide: does this need looking things up? If yes — research
  > first, cite what you find. If no — answer directly from what you
  > know. When it could go either way, lean toward looking it up."

  Pill: `→ LOOK IT UP`. Lean clause drops at dead center. Address: How
  to approach it.
- **Executed** (`IN STAGES`): the plan strip shows DECIDE → the leaned
  path's branch; the run plan makes a cheap classify call over the
  look-at question, then launches the chosen path — which may itself be
  a transformer chain (paths in the PRD can name chains; in the
  prototype a path is prose only). Routing benefits most from execution
  — agreed with weili; it is the run plan's first proof case.
- **Deferred**: per-path jacks gating sibling controls ("cite sources"
  speaks only on LOOK IT UP) — modularly lovely but makes cable topology
  semantic (the rejected in-line-processor smell) and needs gate-wire UI
  the workbench lacks. V2.

### D3. REVISE — compiled feedback, PROTOTYPE-BUILDABLE (small)

The honest compiled form exists: "draft, review, revise before
returning" is a real, obeyable one-call instruction. What is NOT honest
compiled is a score: a 0–10 threshold dial pictures a number that never
exists in one call. Numbers stay off the face except passes.

- **Creator authors** (check block): the metric in prose ("clear enough
  to skim" — lives in config, never on the face); strictness words
  (LIGHT TOUCH / THOROUGH) as a foot chip; fix-vs-start-over toggle
  (retry rules).
- **User's handle**: **passes** — a count 0–3; 0 = silent (engine
  silence rule).
- **Face**: the count capsule (− n +) with n small nested arcs above it —
  the value's own picture. 2×1. Scalar jack.
- **Card**: eyebrow REVISE, pill `×2`:

  > "Draft the answer, then read it back against this: clear enough to
  > skim. If it falls short, revise. Up to 2 passes before you show me."

- **Executed**: run-plan loop — generate → judge call scoring the metric
  → weili's bands (0–4 strong revision / 5–7 light / 8–10 accept) pick
  the revision instruction → repeat ≤ passes. Bands, judge, and score
  provenance are ENGINE-SURFACE; a threshold face becomes honest only
  there. Stopping conditions live here as the loop guard (accept band +
  the at-most limit), not as a separate board part.

Deliberately small — the compiled form can't honestly carry more, and
composite assemblies are the sibling's composite-voice territory.

---

## E. The run plan — the single ENGINE-SURFACE record

Everything executed is one engine feature, recorded once: **the run
plan** — a deterministic derivation from board state (fidelity
resolutions + artifact-cable order + check blocks + modulation sampling)
to an ordered structure of real calls: chains (transformers), decision
points (FORK), loops with guards (REVISE + stopping conditions). Same
authoring surface, two fidelities; the plan strip is its exact preview.

PRD scope notes: per-stage provenance, intervene surface, artifact
storage/inspection, AUTO-resolution heuristics, spend guards, judge
calls. The locked "UI skin over existing machinery" decision means none
of this ships in the PRD's first cut — the compiled forms stand alone,
and (deliberately, per C2's graceful degradation) every part on the
board is fully useful at FAST.

Priority order when the engine work does open: executed FORK first
(cheapest, biggest behavior delta), transformer chains second, judge
loops last (costliest, most trust machinery).

---

## F. New-primitive bill

**Lib (`mod-ui.js` / DESIGN.md):**
1. `stops` on slider (STAGE = stepped slider + named stops; fallback
   rule already written). Tiny.
2. Curve **POSITION input jack** — scalar in, hairline-on-well, sampled
   emission. Ship before GAIN (GAIN stays deferred).
3. **Renamable x-detents** — promoted from the deferred register.
4. **FORK kind** — junction face, per-path config blocks, lean handle.
5. **REVISE kind** — count + arcs. Small; deferrable to round 2 of this
   batch if it crowds the round.
6. **Fidelity foot chip** + the shared vocabulary `ONE PASS · IN STAGES
   · AUTO`, specced once. Reuses the filter mode-chip pattern; no new
   anatomy.
7. **Step shell** — verb label, prose body, artifact jacks, signal-in
   column. New class; reuses panel/config/jack primitives.
8. **Artifact jack glyph** (square-in-ring) + the two-cable-family rule
   written into the signal model section.

**Workbench only:**
9. **Plan strip** — the compiler's THE PLAN region; one element, three
   consumers (envelope stages, FORK branches, REVISE loop). Promote to
   lib only if it survives.
10. Mod-head **FAST◄──►PRECISE lever** resolving AUTOs.
11. `KIND_SECTION`: fork / revise / stage → HOW TO APPROACH IT.
12. Palette headings: CONTROLS / PROCESS / STEPS / VISUALIZERS.

**Engine-surface:** the run plan (§E), artifact payloads' contents, the
verb registry, judge/classify calls, stopping-condition guards.

---

## G. Risks

- **The plan strip over-promising.** It's a plan drawing, not a runtime.
  Mitigations: renders in the compiler's deterministic register, no
  artifact contents, no animation, PRD scopes run-plan out of cut one.
- **Two cable families confusing the board.** Mitigation: visibly
  different jacks and cable weights; non-mating jacks simply don't
  highlight as candidates during a drag (the existing nearest-slot
  candidacy already supports refusal-by-silence).
- **Decide-scaffold obedience.** Well-obeyed at 2 paths, shakier at 3.
  Cap at 3; the unsure-middle path is the pressure valve.
- **STAGE without the POSITION wire looks pointless** — ship them the
  same round.
- **FORK vs sibling mixer overlap.** Mixer blends voices; FORK picks a
  process path. Distinct questions — but check the sibling's order
  primitive before landing FORK's palette slot.
- **Jargon leakage.** Banned from faces, cards, palette: shaper,
  transformer, controller, classifier, evaluator, threshold, envelope,
  compiled, executed, artifact. Shipping words: STAGE, FORK, REVISE,
  EXPLORE/CLUSTER/…, ONE PASS, IN STAGES, LEANS, THE PLAN.
- **Scope creep toward a workflow builder.** The run plan must stay a
  *derivation from board state*, never a canvas of its own — the moment
  stages get dragged as free nodes with their own wires-of-wires, we're
  building n8n, not an instrument. The board is the only authoring
  surface; the plan is always a projection.
