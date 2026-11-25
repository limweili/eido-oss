# BRANCHES — the search-tree visualizer (concept)

Working name: **BRANCHES** (palette entry `⑂ BRANCHES`). Plain words, no
jargon: everyone knows what a branch is. "Search tree" and "MCTS" stay in
code comments, never in UI.

The one-line pitch: **the tree is the space of ideas the AI will consider,
drawn before it considers them.** Branches are candidate approaches; how far
a branch reaches is how far that idea gets developed; cut stubs are ideas
dropped early; the one accented path is the idea it will commit to. Drag a
control, the search space reshapes instantly. Deterministic, 60fps, control
state only — the same guarantee the wave has.

---

## 1 · Semantics first — the input set (5 fixed, wave-style)

Five fixed, permanently-labeled input dots, left column, exactly the wave's
contract (`wb-dotcol`, tiny mono caps labels, cables carry the connection).
Each input must read honestly in BOTH renderings — the drawing and the
sentence. That double-honesty test is what chose these five and rejected
everything else.

| Dot | Plain meaning | In the drawing | In the sentence (via wired control) |
| --- | --- | --- | --- |
| **BREADTH** | how many ideas get tried | number of first-level branches (2–9) | "consider several distinct approaches (4–6) before answering" |
| **DEPTH** | how far each idea is pushed | levels the tree reaches rightward (1–6), branch taper | "develop each direction properly before judging it" |
| **PRUNE** | how ruthlessly weak ideas are cut | more branches end early in cut stubs; fewer survivors | "abandon weak directions quickly" |
| **WANDER** | how far from the obvious the search roams | angular spread + meander of branch paths | "range beyond the obvious; favor unexpected angles" |
| **COMMIT** | how strongly one winner is favored | the accent appears: winning path gains weight + color, losers fade, reward bead brightens | "commit to the single best path and present only it" |

Notes on the set:

- **BREADTH vs WANDER are different axes and both earn their dot.** Breadth
  is *count* (how many branches leave the root); wander is *spread* (how far
  those branches stray from the trunk direction, and how much they meander).
  Five tight parallel branches = "try five careful variations of the obvious
  approach." Five wildly splayed branches = "try five genuinely different
  angles." Users will feel the difference in one drag each.
- **COMMIT is the taste move.** At COMMIT = 0 the tree is *all ink* — no
  accent anywhere, an undecided survey. As COMMIT rises, the accent literally
  arrives: the winning path colors in, thickens, and the reward bead
  brightens while the losers fade toward `--mui-ink-faint`. Commitment IS the
  accent. This is the design system's "one accent doing focused work"
  principle made kinetic.
- Wired-control normalization reuses `srcVal` as-is: sliders/dials 0–100,
  count /10, words by length. BREADTH wired to a **count** reads as a literal
  branch count — the exact trick the wave's WAVES input already plays.
- Unwired defaults (wave precedent — the thing looks alive from the moment
  it's dropped): breadth .5 (4 branches), depth .5 (3 levels), prune .3,
  wander .4, commit .6.
- Accent source: the **COMMIT** wire's control accent colors the winning
  path (wave precedent: amp's accent colors the wave). Unwired →
  `ModUI.DEFAULT_ACCENT`.

Non-technical read test: drag BREADTH up → the fan visibly gains branches →
"more ideas will be tried." Drag PRUNE up → branches audibly (visually) get
the shears → "it'll drop weak ideas faster." No manual, no legend.

## 2 · The drawing

### Composition — root-left, leaves-right. Not radial.

Root sits just right of the input dot column, vertically centered. Branches
grow rightward through faint vertical **depth rules** (hairlines at each
level, `rgba(35,32,25,.05)` — same weight as the wave's horizontal thirds).

Why left→right beats radial:

1. **Reading direction = development direction.** How far right a branch
   reaches is how far the idea got. DEPTH becomes instantly legible as
   horizontal reach against the depth rules. Radial makes depth a radius —
   harder to compare across branches.
2. **The cables feed it.** Values arrive at the left edge through the input
   dots; the tree grows out of that same edge. Cause on the left,
   consequence fanning right. The panel reads as one machine.
3. **The cell is wide.** Board footprint 7×4 (same as the wave). A
   left-anchored fan fills a wide cell naturally; a radial burst wastes the
   corners and reads "network diagram," not "search."
4. The M4L constellation devices (ref 13) get their charm from *nodes with
   spatial meaning*; here the meaning is directional — searching is going
   somewhere.

### Anatomy (ink hierarchy, back to front)

1. **Depth rules** — faint vertical hairlines, one per level. The paper's
   own graph lines.
2. **Live branches** — warm ink polylines, weight tapering 2.0 → 1.0px with
   depth. Each first-level branch is one candidate idea; it may fork once or
   twice deeper in (deterministic).
3. **Pruned stubs** — branches that fail the prune threshold stop early and
   end in a tiny perpendicular **cut tick** (2.5px, `--mui-ink-faint`) — a
   shear mark. The stub stays as evidence; its would-be subtree simply never
   exists. PRUNE up = more cut ticks, fewer survivors. Always ≥1 survivor
   (the winner) — the search never returns empty-handed.
4. **Ghost continuations (the rollouts, kept from the riff)** — beyond each
   surviving leaf, one further segment drawn as a short trail of
   **fading dots** (3–5 dots, opacity .25 → .05). This is the dot-matrix
   motif doing semantic work: dots = "not yet real." Ghosts breathe — a slow
   ~4s opacity cycle, phase-offset per leaf so the canopy shimmers gently,
   never in unison.
5. **The winning path** — root-to-leaf polyline of the highest-scoring
   branch, drawn over everything in the accent, weight 2.4px, round caps.
   Its emphasis (opacity, weight, how much the losers fade) scales with
   COMMIT.
6. **The reward bead (the backprop, kept from the riff)** — once per breath
   cycle, a single small bright bead (3px accent dot with a soft 8px wash
   halo) travels **leaf → root** along the winning path over ~1.2s, leaving
   a brief brightening in its wake that decays over the rest of the cycle.
   One bead. Rootward. Slow. That's the entire spectacle.

### Determinism — structure vs. modulation (the key trick)

Same values = same tree, always, AND small drags must not reshuffle the
whole tree. Split the state:

- **Structure** (discrete): branch count, level count, fork pattern,
  per-branch score. Derived from a seeded PRNG (mulberry32) keyed **only on
  structural integers** — (branchIndex, level). Per-branch "score" is a
  fixed pseudo-random in [0,1] per index.
- **Modulation** (continuous): WANDER scales the same fixed angular offsets;
  PRUNE is a threshold over the fixed scores (score < prune·k → stub at the
  level the threshold bites); COMMIT scales winner emphasis. Dragging any
  continuous input smoothly morphs the *same* tree — no popping, no
  re-rolling.
- BREADTH/DEPTH changes are discrete: new branches/levels **grow in** and
  **retract** with `--mui-t-move` + `--mui-ease-settle` (drawn-length
  interpolation, like a plant, not a fade). Existing branches keep their
  indices, so they never reshuffle.
- Time `t` touches only ghost breathing and bead phase — geometry is
  time-independent. Canvas 2D, one path pass per branch; ~40 polylines of
  ≤7 segments is trivially 60fps at DPR 2.

### Animation states (calm paper, not rave)

| State | Behavior |
| --- | --- |
| **At rest** | Fully-drawn tree (never re-grows from zero on a loop — that would be busy). ~6s breath cycle: ghosts shimmer, one bead runs rootward, wake fades. |
| **Value drag (continuous)** | Geometry eases toward new state ≤120ms behind the pointer — feels direct, reads smooth. Ghosts/bead continue undisturbed. |
| **Value change (discrete)** | Branches grow in / retract over 220ms ease-settle. |
| **Wire connect/disconnect** | The affected aspect settles from default to wired value with the same grow/morph; input dot fills per existing `setConnected`. |
| **prefers-reduced-motion** | Static frame: no bead, ghosts frozen at mid opacity. Everything still legible — motion is garnish, never information. |

The only saturated color on the panel is the winning path + bead. Everything
else is the warm ink ramp. One accent per control, honored.

### ASCII sketch (7×4 cell; ● = input dots, ✕ = cut tick, ··· = ghost dots, ═ = winning path)

```
 ┌────────────────────────────────────────────────────────────┐
 │ ⑂ BRANCHES                                     ⚙  ×        │
 │        ¦        ¦        ¦        ¦        ¦               │
 │●BREADTH¦     ___,────────┬────✕   ¦        ¦               │
 │        ¦    /   ¦        ¦        ¦        ¦               │
 │●DEPTH  ¦   /____¦___,────┴──✕     ¦        ¦               │
 │        ¦  //    ¦        ¦        ¦        ¦               │
 │●PRUNE  ○══╪═════╪══╤═════╪════════╪═══◉    ¦ · · ·         │
 │        ¦  \\    ¦  ✕     ¦        ¦        ¦               │
 │●WANDER ¦   \____¦________┬────────┬─────   ¦  · ·          │
 │        ¦    \   ¦        ¦        ✕        ¦               │
 │●COMMIT ¦     ───┴──✕     ¦        ¦        ¦               │
 │        ¦        ¦        ¦        ¦        ¦               │
 └────────────────────────────────────────────────────────────┘
   root ○ left · depth rules ¦ vertical · ═ accent winning path
   ◉ reward bead traveling leaf→root · ✕ prune shear marks
```

(BREADTH=5 shown: 2 survivors, 3 stubs at varying depths, winner committed.)

## 3 · What was cut from the synth riff, and why

| Riff concept | Verdict | Why |
| --- | --- | --- |
| Branches as voices | **Translated** | "Voice" = one first-level branch = one candidate idea. The polyphony metaphor survives as visual polyphony; audio is gone. |
| Rollouts / ghost branches shooting ahead | **Kept, tamed** | One ghost segment per surviving leaf, as breathing dot-trails. Not "shooting" — this paper doesn't shoot. |
| Backpropagation as reward waves to root | **Kept, reduced to one bead** | One bead, once per cycle, rootward, on the winning path only. A wave across every branch every frame is the rave we don't run. |
| Pruning as cutting branches | **Kept literally** | Cut ticks are the single most legible element — evidence of decision. |
| Depth as complexity | **Kept** | Depth rules + reach + taper. |
| LFOs / modulation sources | **Cut** | Controls are hands, not oscillators. The only autonomous motion is the breath cycle, and it carries no information. |
| Multi-channel output, CV export, density→macro-FX mapping | **Cut** | Inverts data flow. Visualizers are one-way lenses (feed wires in, nothing out). A picture that drives controls is the radar's two-way job, and this picture has no draggable value handle that maps honestly to one input. |
| Audio feedback loops | **Cut** | No audio, no feedback. Determinism forbids the picture influencing its own inputs. |

The discipline test passes: every surviving element answers "what will the
AI do differently?" Every cut element only answered "what would a modular
synth do?"

## 4 · Emission decision — SILENT. And here's how it still gets great sentences.

**BRANCHES never speaks.** The `displays never speak` rule stands, and for
this visualizer specifically the rule is not a constraint, it's the point:
the tree's entire authority comes from being *the same state* as the
sentences, rendered twice. The moment the tree emits its own line, there are
two speakers to reconcile — the wired dial says "Breadth: 7 of 10" while the
tree says "consider many approaches," and the tape has to explain which one
counted. The truth guarantee dies in that gap.

But the fallback sentence problem is real — a bare dial wired to BREADTH
emits the weak "Breadth: 7 of 10." The answer is already in the system:
**per-band frames on the wired controls**, shipped as a library preset mod.

- **Ship "EXPLORER" as a built-in library mod** (the library already carries
  Intent and Idea-pressure templates — same shelf): the BRANCHES visualizer
  pre-wired to five dials/sliders whose per-band frames are pre-authored.
  Address: **How to approach it**, all five.
  - BREADTH low → "Settle on the obvious approach — consider at most two."
    · mid → "Consider several distinct approaches (4–6) before answering."
    · high → "Cast a wide net — consider many approaches, including
    unlikely ones."
  - DEPTH → "Sketch each direction in a line or two" / "develop each
    moderately before judging" / "push every direction far before judging
    any."
  - PRUNE → "Keep every direction alive until the end" / "drop clearly weak
    directions as you go" / "cut ruthlessly — abandon anything unpromising
    immediately."
  - WANDER → "Stay close to the conventional reading of the task" /
    (silent mid-band — near-default spread needs no instruction) / "range
    far from the obvious; favor unexpected angles."
  - COMMIT → "Present the strongest few options with their trade-offs" /
    "favor the best path but note serious alternatives" / "commit fully to
    the single best approach and present only it."
- Every mechanism above already exists in the spec (per-band frames,
  addresses, library templates, feed wires). **Zero new engine surface.**

Considered and rejected: a "composite voice" where the visualizer emits one
fused sentence ("Consider 5 approaches, develop each 2 steps, prune hard,
commit to the best") and mutes its wired controls. Genuinely better prose —
but it needs a new wire kind (voice), mute semantics, and a second
transparency path for the tooltip/tape. That's real engine surface bought to
improve sentence *style*, purchasable later without touching this concept.
File it as the one candidate for a future "composite frame" primitive;
don't spend it now.

## 5 · System fit

- **Input contract: exact wave clone.** Fixed 5 labeled dots (wave has 6),
  left `wb-dotcol` straddling the border, permanent micro-caps labels,
  `attachSlot` / `setConnected` / accent-inheritance all reused verbatim.
  No new wiring semantics, no new dot behavior.
- **Board footprint** 7×4 like the wave; minimum 4×3 (the 5-dot column
  needs ~3 cells of height; below that dots would collide — enforce via the
  existing per-kind `minW/minH` seam, which currently hardcodes 3×3 for
  visualizers: one-line change).
- **Renderer registry only** — no emitter entry, honoring displays-never-
  speak. Canvas 2D in the existing `it._draw(t)` loop slot.
- **Nothing the system lacks** for the visualizer itself. The EXPLORER
  preset mod needs per-band frames + library templates — both already
  specified/shipped.

## 6 · Risks + fallback

| Risk | Mitigation |
| --- | --- |
| WANDER label reads fuzzy to some users | It's the honest word (branches literally meander) and pairs with BREADTH cleanly. Alternates if testing disagrees: SPREAD, RANGE (RANGE collides with the range control kind — avoid). |
| BREADTH×DEPTH×PRUNE at extremes → visual clutter or emptiness | Clamp render: max ~40 drawn segments (merge deepest forks); floor: winner always survives, so min-state is one clean path — a committed, unbranched thought, which is itself a legible statement. |
| Discrete input changes popping | Grow/retract animation over `--mui-t-move`; indices stable so nothing reshuffles. |
| Bead + ghosts read as "AI is running" | They're phase-locked to a fixed 6s cycle regardless of anything — no start/stop, no progress semantics. If confusion shows up in testing, the bead runs only for 2 cycles after a value change, then rests. |
| Five wired controls feels like homework to set up from scratch | That's what the EXPLORER library preset is for; from-scratch users get living defaults on every unwired dot (wave precedent). |

**Fallback simpler version ("the fan"):** 3 inputs — BREADTH, DEPTH, PRUNE.
Static deterministic fan with cut ticks; no ghosts, no bead, no accent path;
accent from BREADTH's source tints all live branches. Loses the MCTS soul
(rollout/backprop/commit) but keeps the one-glance read "this many ideas,
this far, this ruthless." Every fallback element is a strict subset of the
full drawing, so it's a de-scope, not a redesign.

## Why this is the inevitable shape

The wave answered "what does the instruction *feel* like." BRANCHES answers
the other half: "what will the AI *do* with it." One is texture, the other
is strategy — together they cover the two questions anyone has about a
prompt. And every pixel keeps the house bet: the picture is never a promise
about the AI's output, only a truthful drawing of the instruction's own
words — breadth, depth, ruthlessness, commitment — which is exactly what
the sentences say, because they are the same state.
