# Review verdicts

## Fresh-eyes gate review (round 1)

Reviewer: independent fresh-eyes agent (did not build any wave; did not read wave
reports, specs, or recon docs — rubric was `03-polish-goal.md` only). Prototype
served locally, driven in the browser pane at 1280×1000, 2026-07-16. Method per
tooling notes: screenshot first, then DOM-assert. All quotes below are exact
on-screen strings.

### Test 1 — 5-second test: **FAIL** (most parts pass; 6 don't)

One of every library part was placed (13 controls, 3 process, 7 work steps,
15 visualizers, plus TRANSLATOR and NARRATOR packs; footer reached
"56 PARTS · 17 WIRES").

What works: a fresh control's face is name + control + value + sentence
("DIAL / 50% / Dial: 50%."). Every unwired visualizer teaches its own use on
its empty face — "Wire numbers in to compare them side by side." (LEVELS),
"Wire a number in — it fills in notches, like a meter." (LIGHT GRID),
"Wire sources on the left, targets on top." (MATRIX), "Wire one side against
the other — the beam tips." (BEAM), "Wire in how to explore — the tree shows
wide vs deep." (BRANCHES), "Shows how far each wired part sits from its
default." (TRIM). Work steps are uniform: verb sentence + square IN/OUT jacks +
foot chip "AUTO · → ONE CALL". These pass in well under 5 seconds.

Parts that fail or barely scrape by:

- **PAD** — face is a square with a dot. No value numbers, no sentence. Job
  guessable ("two amounts"), effect invisible.
- **MIXER** — two A/B sliders, no numbers, no sentence on the face.
- **FORK** — subtitle reads "DECIDES WHEN IT RUNS"; library card says "The AI
  picks a path at run time". Which is it — timing or path choice? The "EVEN"
  chip is unexplained.
- **READOUT** — its own name truncates to "READO…" at default drop size. A part
  whose blurb is "One headline number — big and readable" ships with an
  unreadable name.
- **GROUP VOICE** — drops as a pill named "THE VOICE" (library name and instance
  name differ); the frame boundary was invisible amid overlapping cards.
- **SELECT** — "OFF" chip plus a dashed half-selected "OPTION B": is one picked
  or not?

### Test 2 — Prediction test: **FAIL**

- Valid wire (predicted, confirmed): NO HEDGING → new radar axis. Radar gained
  a "NO HEDGING" axis, vertex at rim (ON=100); card dot, wire, jack, and vertex
  all black — the color chain holds.
- **Invalid wire accepted with a silent side effect**: predicted that dragging
  NO HEDGING (scalar output) onto WINDOW's LENGTH jack (span input) would be
  visibly impossible. Instead it connected — and silently kicked the existing
  LENGTH wire off (WINDOW became "Inputs: NO HEDGING, NOVELTY"; LENGTH read
  "Unconnected"). The only recovery was the global UNDO button in the far
  top-right corner. Nothing during the drag distinguishes legal from illegal
  targets, and nothing warns that an occupied input will be stolen.
- Output→output drag: silent no-op. Not surprising, but not "visibly
  impossible" either — the UI simply does nothing.
- Run lever: direction was predictable (STAGED splits the run), magnitude was
  not; only after toggling does "CALLS 2–4 · WARMTH ARC … one call per stage"
  explain the count. Worse, the resting state contradicts itself — see Test 5.
- Toggling also silently changed the header "14 SENTENCES" → "13 SENTENCES"
  (the warmth-arc sentence leaves the prompt to become stages). Explainable,
  never explained.

### Test 3 — One-grammar test: **FAIL**

The base grammar is real and mostly holds: colored circle jacks for signals,
square jacks for work artifacts, card-dot ↔ wire ↔ jack ↔ prompt-card color
chain, "UNWIRED" chips on empty visualizers. Exceptions found in the shipped
prototype:

- **Jack typing is cosmetic**: a scalar output plugs into a span input slot and
  the slot silently retypes (Test 2). The shapes teach a rule the system does
  not enforce.
- **State words with multiple spellings**: face chip "AUTO" = settings option
  "FOLLOWS THE MOD"; parts are "OFF" but the pack menu says "SILENCE THIS
  PACK"; visualizers say "UNWIRED" while ARIA labels mix "Unconnected" and
  "Unwired"; tidy says "Two parts are named WARMTH" while the prompt card shows
  "NARRATOR · WARMTH 2".
- **"1 STAGED CALL"** in the header while the lever sits on ONE CALL.
- **Pressable vs readout chips are indistinguishable**: "AUTO" (pressable),
  "NOW 9/10" (readout), "→ CALL 1" (readout), "READY — FILL IT IN" (pressable)
  share one pill style.
- **Feedback far from the action**: the wire-steal in Test 2 is only
  recoverable via the top-right UNDO; no chip appears at the jack.

### Test 4 — Dead-chrome test: **PASS** (short list of stragglers)

No "CONNECTED PREVIEW"-class dead chrome found; nearly every element informs a
decision. Stragglers: the pack chip "READY — FILL IT IN" (contradiction — see
Test 5) informs nothing once the pack is ready; FORK's "DECIDES WHEN IT RUNS"
subtitle actively misinforms; BEAM's placeholder text strikes through its own
beam graphic; CURVE's "AUTO" chip overlaps a faint "NOW" label; work-step input
labels ("HOW HARD", "STRICTNESS") collide with the step's description text.

### Test 5 — Storyline test: **FAIL** (narrowly — one seam breaks the narration)

A stranger *can* now narrate most of the journey unprompted: every part speaks
a sentence → sentences stack into named sections (VOICE / RULES / SHAPE OF THE
ANSWER / APPROACH / READER) in THE PROMPT → PLAIN TEXT renders the compiled
markdown prompt → THE RUN shows what runs. Work steps carry "→ CALL 1" foot
chips and APPROACH echoes "EXPLORE → RUNS AS CALL 1" — board and run point at
each other. Dropping NARRATOR gave a ghost frame ("CLICK TO PLACE"), a
"NARRATOR PACK ADDED" toast, a grouped prompt sub-section, and concrete tidies.
The tidy loop closes: "TRANSLATOR needs THE READER filled in. GO THERE" focused
the exact field; typing a reader flipped the preset chip to "PRESET: CUSTOM",
added "The reader is a first-year med student." and dropped the tidy count.
"This dial has no name — its sentence is just 'Dial: 50%.' [NAME IT]" is
exemplary.

Where the narration breaks:

- **The run strip contradicts itself at rest.** In ONE CALL mode the header
  says "14 SENTENCES · 1 STAGED CALL", the chip says "THE RUN 1 CALL", and the
  copy says "The prompt above goes first. Then each card below is its own call
  — 1 call in all." — directly above a "CALL 1 · EXPLORE" card. If the prompt
  goes first *and* the card is its own call, that is two calls; I could not
  say what actually runs, and this is the finale of the story.
- **"READY — FILL IT IN"**: after filling the reader, the pack chip literally
  reads "READY — FILL IT IN" (ARIA: "READY. Go to the empty field." — no field
  is empty).
- "SHOW BOTH" (duplicate-name tidy) scrolls the prompt to one sentence but does
  not visibly mark both parts on the board — you hunt for them yourself.
- Toggling ONE CALL ↔ STAGED silently moves a sentence out of/into the prompt.

### Test 6 — Settings test: **PASS** (one popover flagged)

Nine settings surfaces opened: WARMTH (dial), CONFIDENCE (slider), NO HEDGING
(switch), WRITE AS IF FOR (words), WARMTH ARC (curve), LENGTH (filter), STAGE
(process), EXPLORE (work step), TRANSLATOR pack tab (preset picker + actions
menu). The template reads top-down: "WHAT IT SAYS NOW" preview, NAME, part-
specific fields with one-line consequences ("Turn on STOPS first.", "One name
per stop — 4 stops need 4 names.", "The two ends the handle slides between."),
SENTENCE with "{value} is where the current setting goes.", WHERE IT GOES
("The prompt section this part speaks in."), MAKE THIS THE DEFAULT, NOTE
("For you — the prompt never reads it."). EXPLORE's popover ties itself to the
face: "The foot chip shows where this lands right now." The preset picker
(STOCK / QUICK READ / DEEP DIVE / SAVE THESE VALUES AS…) applied visibly:
knobs 50→70/25/80%, a silenced part woke up (gray card → normal, OFF chip
gone), BANDINGS re-proportioned, prompt 14→17 sentences. Not a flat wall of
inputs anywhere.

Opaque fields found:

- **STAGE popover**: "STOPS − 2 +" sits above *three* per-stage sentences
  (SENTENCE · EXPLORING / ORGANISING / COMMITTING) and the boilerplate helper
  "One name per stop — 4 stops need 4 names." Three numbers on screen — 2, 3,
  4 — and no way to reconcile them.
- {value} boilerplate appears verbatim on parts that have no value slider
  (NO HEDGING, WRITE AS IF FOR).
- "TRIM measures how far you've moved from this." assumes you know TRIM.

### Sweeps

- **Resize**: shrinking WARMTH keeps identity via a floating "WARMTH · 72%"
  label chip — graceful. Enlarging scales the knob but yields mostly empty
  space, and board wires draw *over* the enlarged card face. "TECHNICAL DEP…"
  and "READO…" truncate at pack/default sizes.
- **UNDO**: correct but depth 1 ("Nothing to undo" after one step); lever
  toggles and preset changes aren't in the stack.
- **PLAIN TEXT**: works — full compiled markdown prompt with `## VOICE`,
  `## RULES`, `## SHAPE OF THE ANSWER`, `## APPROACH`, including honest
  gibberish from unnamed parts ("Switch.", "Dial: 50%."), all pre-flagged by
  the tidy list. COPY PROMPT gave no visible confirmation (may be a harness
  clipboard artifact). EXPORT not exercised (file download out of scope here).
- **Placement**: new parts can drop overlapping existing cards (REVISE landed
  half under THE READER; DEVELOP atop the DEPTH dial); a pack dropped near
  occupied space overlaps it and its pre-wires balloon into long loops across
  the whole board. The demo board itself extends beneath the right prompt
  panel — TONE OF VOICE's +/− buttons were unreachable until panning, and the
  mouse wheel does not pan the canvas despite the hint "Scroll or use arrow
  keys to pan."
- **Console**: zero errors across the entire session (board edits, wiring,
  packs, presets, resize, toggles).

### Ranked remaining confusions

Blocks comprehension:

1. Run strip self-contradiction in ONE CALL mode ("1 STAGED CALL" header;
   "1 call in all" above a CALL 1 card) — the story's finale is unreadable.
2. Wiring silently accepts type-mismatched connections and steals occupied
   inputs with no local feedback; drag shows no legal/illegal targets.

Erodes trust:

3. "READY — FILL IT IN" contradictory pack chip (stale suffix + stale ARIA).
4. STAGE popover STOPS=2 vs three stage sentences vs "4 stops need 4 names."
5. Single-level undo; lever/preset actions not undoable.
6. Drop placement overlaps existing cards; pack pre-wires loop across the
   board; wires render over enlarged card faces.
7. State vocabulary drift: AUTO vs FOLLOWS THE MOD; OFF vs SILENCE THIS PACK;
   UNWIRED vs Unconnected (ARIA); "WARMTH 2" card vs "named WARMTH" tidy.
8. PAD and MIXER faces show no value numbers and no sentence.

Cosmetic:

9. "READO…" / "TECHNICAL DEP…" name truncation at default/pack sizes.
10. BEAM placeholder text strikes through its graphic; CURVE "AUTO" chip
    overlaps "NOW"; work-step input labels collide with description text.
11. FORK subtitle "DECIDES WHEN IT RUNS" + unexplained "EVEN" chip.
12. "SHOW BOTH" doesn't visibly mark both duplicates on the board.

### Overall verdict: **REWORK** (not kill)

The architecture is genuinely working: faces that speak their sentence,
teach-on-empty visualizers, a live prompt with named sections, plain-text
compilation, an actionable tidy loop, and a consistent settings template. The
failures are a bounded, fixable list — none require re-architecting.

Rework list (in order):

1. **Run strip wording.** Never say "STAGED CALL" in ONE CALL mode; make the
   call arithmetic visibly reconcile (prompt + N cards = N calls, stated once);
   when STAGED moves a sentence out of the prompt, say so where the count
   changes.
2. **Wiring feedback.** Highlight legal jacks and dim illegal ones during the
   drag; when a drop would replace an occupied input, show it at the jack
   (chip or confirm), not only via the distant global UNDO; either enforce the
   span/scalar jack typing or stop drawing them as different types.
3. **Pack chip states.** "READY" must drop the "— FILL IT IN" suffix and its
   stale ARIA; tidy wording must use the same display names as the prompt
   cards ("WARMTH 2").
4. **STAGE popover.** STOPS must equal the number of stages shown, with
   per-stage names; kill the generic "4 stops need 4 names" boilerplate where
   it doesn't apply.
5. **Placement & wire routing.** Drop new parts/packs into free space; route
   pack pre-wires locally; draw wires under card faces.
6. **Face floor.** PAD and MIXER get value + sentence on the face; READOUT's
   default width fits its own name; fix BEAM/CURVE/work-step label overlaps;
   rewrite FORK's subtitle ("Lets the AI pick a path" or similar) and label
   the bias chip.
7. **Undo depth.** Multi-step undo, or at minimum include lever and preset
   changes and surface an undo chip near the acted-on element.

## Fresh-eyes gate review (round 2)

Date: 2026-07-17. Reviewer: independent fresh eyes (read only `03-polish-goal.md`;
no wave reports, no round-1 section). Prototype served locally, 1280×1000,
`mod-workbench-polish`. Zero console errors across the entire session (adds,
wires, resizes, lever toggles, pack drop, undo chains). Environment caveat:
the browser pane reported `document.hidden = true`, so ResizeObserver /
rAF-dependent behavior (size-class re-evaluation, smooth scrolls, pack-ghost
listener registration) lagged; findings that may be artifacts of that are
marked ⚠.

### Test 1 — 5-second test: PASS with one part failure (REVISE)

Placed all 38 palette parts (13 controls, 3 process, 7 work steps, 15
visualizers) plus the demo's zoo.

- **Named from the face alone:** DIAL (knob · 50% · "Dial: 50%."), SLIDER,
  SWITCH, COUNT, WORDS ("Type words to add a sentence."), PAD (2-axis pad,
  "50 · 50", per-axis sentences), RANGE ("between 30 and 70"), FILTER ("≤ 70"),
  CURVE (face carries its own sentence + AUTO + NOW marker), SELECT (option
  chips + "No sentence for OPTION A yet."), ORDER (FIRST › SECOND › THIRD),
  MIXER ("Weigh the answer 50% on a, 50% on b."), GROUP VOICE (frame, parts
  inside, fused sentence), STAGE (named stop on the face), FORK (face says
  "THE AI PICKS A PATH WHEN IT RUNS" + PATH A/B + LEAN · EVEN). All 7 work
  steps state verb + full sentence + IN/OUT ports + tuning input + a run-foot
  chip. All 15 visualizers spawn with an UNWIRED chip and an invite line that
  is the job ("Wire one number in — big and readable." / "Wire one side
  against the other — the beam tips." / "Wire values in — tight cluster means
  a coherent idea."). This is a real improvement: the unwired state teaches.
- **FAIL — REVISE.** It spawns at its 2×1 minimum where `.mui-label` is
  `display:none`: the face reads "− ×2 PASSES + / LIGHT TOUCH" with **no part
  name anywhere**. Every other part shows identity at spawn. Enlarged to
  ~350×200 the name appears at 10px light gray while the card is mostly empty
  beige (arcs icon + capsule + one chip floating in blank space) — fails Lego
  rule 4 ("never empty space") too.
- Marginal: fresh SLIDER shows only "50%" — indistinguishable from DIAL until
  its promised "two named ends" are configured; fresh COUNT spawns at **50**
  ("pick how many" of anything defaulting to 50 reads wrong; demo uses 3);
  viz invite text is ~3.6:1 contrast at 13px (faint); BEAM draws its beam
  line straight through its own invite text.

### Test 2 — Prediction test: PASS (one hard copy bug logged under test 3)

- **Wiring, before the drop:** starting a drag blooms every eligible jack
  with a label stating the exact outcome ("BIG PICTURE — TAKES A NUMBER —
  SHOWN AS THE HEADLINE NUMBER"; on a step: "TUNES THIS STEP: HOW MANY GROUPS
  TO SORT INTO"). Incompatible family jacks never light and fade — invalid
  is visibly impossible mid-gesture, exactly as the goal demands.
- **Wrong-family drop** refused at the jack with taught grammar: "SQUARE
  PORT · TAKES WORK, NOT A SIGNAL". No wire created.
- **Occupied input:** dropping BIG PICTURE onto BANDINGS' wired EXAMPLES 2
  input replaced it and said so at the jack: "BIG PICTURE CONNECTED TO
  EXAMPLES 2 · REPLACED EXAMPLES 2". The pre-drop warning ("DROP TO REPLACE
  <src>", 16px proximity) exists in code (`startWire`, gate-rework-#2
  comment) but I could not observe the mid-hover state in this pane ⚠ —
  atomic drags only. Two copy nits: the slot's display name is the *old
  source's* name, so the message reads circular ("CONNECTED TO EXAMPLES 2 ·
  REPLACED EXAMPLES 2"); and after the replace, BANDINGS listed two bands
  both named BIG PICTURE.
- **Lever:** predicted "each step becomes its own call card" — confirmed,
  plus honest extras: header 24 SENTENCES · 1 CALL → 15 SENTENCES · 13 CALLS
  with a "9 SENTENCES MOVED INTO THE RUN" annotation, "CALLS 9–11 ·
  WARMTH ARC … one call per stage", "CALLS 12–13 · FORK · DECIDES ITS OWN
  ROUTE", and the lead sentence grows "The fork picks one of its routes when
  it runs." Toggling back restores the ONE CALL copy exactly.
- **Surprise scored:** GROUP VOICE's palette row says "A frame — drop
  controls inside" but placing it silently drops **three pre-filled parts**
  (BREADTH, DEPTH, READER with values). Packs announce "DROPS N PARTS";
  the frame doesn't.

### Test 3 — One-grammar test: FAIL (one hard exception, several soft ones)

- The good: jack grammar is now exactly two families — round signal jacks vs
  square work ports — taught by the drag itself and named in refusal copy;
  **no oval jacks found anywhere** (round-0 defect #1 is dead). State words
  are single-spelled across the board: OFF (14 instances), ON, AUTO, UNWIRED
  — no MUTED/DISABLED strays. The color chain holds: part accent = wire =
  jack = sentence card = value chip.
- **Hard exception — run-foot chips vs the lever.** In STAGED mode every
  step's foot chip reads "AUTO · → CALL 1" while the run strip numbers them
  CALL 1–8 (CLUSTER's card is CALL 3; its chip says CALL 1). The chip the
  EXPLORE popover explicitly tells you to trust ("The foot chip shows where
  this lands right now") disagrees with the strip — a direct violation of
  "run strip copy agreeing with the lever in EVERY state".
- Soft exceptions: (a) the pack status chip ("NEEDS READER — FILL IT IN") is
  pressable while visually-identical OFF chips are readouts — you cannot
  always tell pressable from readout; (b) Enter on a focused chrome button
  (Configure, remove step) does nothing — pointer-only; (c) unwired viz slot
  ARIA leaks internal ids ("s32 — signal input"); (d) two parts can share an
  accent (new DIAL and FORMALITY both blue), weakening wire tracing; (e)
  invite-text contrast below comfortable readability.
- State-word audit passed: empty board / one part / staged / back-to-one-call
  run-strip copy all verified live and mutually consistent ("Everything above
  goes to the AI as one prompt — one call." + "NOTHING RUNS FROM THIS PAGE —
  COPY OR EXPORT TO USE IT." on the no-staged-parts board; pinned-part
  explanation when EXPLORE exists; staged copy as above).

### Test 4 — Dead-chrome test: PASS

Hunted every widget: "CONNECTED PREVIEW" is gone; the tidy strip vanishes
entirely when there is nothing to tidy; THE RUN is never hidden and always
explains itself; WINDOW's "2 INDEPENDENT LIMITS" is a verdict, not chrome;
palette pack rows' ghost-outline icons communicate "one row = several parts".
The only chrome defect found is a collision, not deadness: BEAM's graphic
strikes through its own invite sentence.

### Test 5 — Storyline test: PASS

Narrated unaided: parts write sentences → sentences live in named sections
(VOICE / RULES / SHAPE OF THE ANSWER / APPROACH / READER) with the part's
color and value chip → clicking a sentence shows its part; Enter edits it →
PLAIN TEXT flips the same page to the literal markdown the AI gets (verified:
`## VOICE …` including my edits) → THE RUN explains what runs and when, and
the APPROACH section carries an "EXPLORE → RUNS AS CALL 1" stub linking
prompt to run.
- **Things to tidy** is now a real storyline device: it listed the demo's two
  seeded defects; GO THERE focused THE READER's field (fill → count drops,
  pack chip flips NEEDS READER → PRESET: CUSTOM); SHOW BOTH framed the twin
  EXAMPLES; renaming EXAMPLES 2 → SAMPLE DEPTH cleared the list and the strip
  removed itself.
- **Pack drop:** clicking NARRATOR stages a dashed ghost frame with mini part
  outlines, the pack name/job, and "CLICK TO PLACE · ESC CANCELS" — the
  stranger sees one row become N parts *before* committing. Placement created
  the frame + tab (editable name · job line · PRESET picker · ⋯ menu with
  TURN THIS PACK OFF / DUPLICATE / RESTORE STOCK / REMOVE PACK) and
  pack-prefixed sentences (NARRATOR · DETAIL 2). ⚠ The ghost's follow-cursor
  listener registers on rAF and repeatedly failed to arm in this hidden pane;
  retest the two-click flow interactively.
- Dropping NARRATOR on the demo board instantly raised **six** tidy conflicts
  (WARMTH/WARMTH 2, DETAIL set twice, …). Honest, but the volume reads as a
  scolding; consider grouping ("NARRATOR overlaps 6 board parts").
- **UNDO:** every action is labeled ("Undo add group voice", "Undo load
  QUICK READ preset", "Undo connect BIG PICTURE"); walked 13 consecutive
  undos back to "Nothing to undo" with the board restored exactly. Gap:
  sentence-template edits made inside a popover never enter undo history.
- COPY PROMPT clicked (responds); EXPORT verified in code only — downloads
  `<name>.eido-mod.json` with feedback "MOD SPEC EXPORTED · AUTHORING DATA
  ONLY" (not clicked; avoided dropping files on the host).
- Residual wobble: in ONE CALL with pinned EXPLORE the strip says "1 call in
  all" while a CALL 1 · EXPLORE card sits below "the prompt rides along with
  every call" — self-consistent (the prompt is not a call) but takes a beat,
  and the wrong foot chips (test 3) actively fight it.

### Test 6 — Settings test: PASS with one shared defect

Eight popovers opened: DIAL, PAD, SELECT, STAGE, GROUP VOICE frame, EXPLORE
step, pack preset picker, pack ⋯ menu.

- Uniform top-down anatomy everywhere: **WHAT IT SAYS NOW** (live sentence)
  → NAME → part-specific groups (PAD: per-axis name/ends/stops; SELECT:
  OPTIONS 2–7 with per-option sentences; STAGE: stages stepper + one name and
  one sentence per stage, current stage highlighted) → SENTENCE template with
  `{value}` and helper copy → WHERE IT GOES (section, with "The prompt
  section this part speaks in.") → MAKE THIS THE DEFAULT ("TRIM measures how
  far you've moved from this.") → NOTE ("For you — the prompt never reads
  it."). Disabled fields explain themselves ("Turn on STOPS first."). The
  EXPLORE step popover names the lever relationship ("AUTO follows the WHEN
  IT RUNS lever…"). A stranger can state every field's consequence.
- **Defect:** the consequence is *not* visible before committing in the one
  place it matters most — editing the SENTENCE template updates the card face
  on blur but the popover's own "WHAT IT SAYS NOW" stays stale until
  reopened. (Also: the sentence textareas have no aria-labels.)
- Preset picker: STOCK locked, QUICK READ/DEEP DIVE load with undo, SAVE
  THESE VALUES AS…, rename/delete gated. Loading QUICK READ changed pack
  faces coherently and the tab tracked PRESET: QUICK READ.

### Sweep

Resize: no truncation at grown sizes; wires stay attached; REVISE large =
empty card (above); shrinking a dial to 64px truncated its label while the
stale size-class kept it visible ⚠ (size classes re-evaluate via
ResizeObserver, starved in a hidden pane — retest interactively). New parts
from the palette land **overlapping existing cards** (REVISE landed on the
TRANSLATOR pack tab; GROUP VOICE frame overlapped ORDER and MEET THEM); the
dwell-push never resolved the overlap. Zero console errors all session.

### Ranked remaining confusions

1. **HIGH — STAGED foot chips all read "→ CALL 1"** while the run strip
   numbers calls 1–N. The one hard copy/lever disagreement left; the popover
   tells users to trust exactly this chip.
2. **HIGH — REVISE has no name on its face at spawn** (xs hides the label);
   at large sizes it is mostly empty card. The only part that fails the
   5-second test.
3. **MED — popover "WHAT IT SAYS NOW" goes stale** after editing the sentence
   template in that same popover; the edit is also invisible to undo.
4. **MED — palette drops collide with existing cards** (part landed on the
   pack tab; frame over cards); placement should find free space or push
   immediately on drop.
5. **MED — replace copy can read circular** ("CONNECTED TO EXAMPLES 2 ·
   REPLACED EXAMPLES 2") because the slot inherits the old source's name;
   post-replace BANDINGS showed two bands with identical names.
6. **LOW — GROUP VOICE drops 3 pre-filled parts unannounced** (no "DROPS 3
   PARTS" chip, unlike packs).
7. **LOW — spawn faces that undersell:** SLIDER (no named ends → looks like
   DIAL), COUNT (defaults to 50).
8. **LOW — assorted grammar dust:** pressable pack chip vs readout OFF chips
   look alike; Enter dead on chrome buttons; "s32" ARIA leak; shared accents
   between parts; faint invite text; BEAM line through its own invite copy.

### Verdict: REWORK (targeted) — then ship

Four of six gates pass cleanly (prediction, dead-chrome, storyline, settings
— settings with one shared defect), and the grammar is one bug away from
holding. This round found **no architectural faults**: the journey reads
end-to-end, the drag teaches the grammar, the tidy loop closes, undo is
labeled and deep. Rework list, in order: (1) foot-chip call numbers must
match the run strip; (2) REVISE face identity at spawn + non-empty large
layout; (3) live-update WHAT IT SAYS NOW and make template edits undoable;
(4) collision-free palette/pack placement; (5) replace-copy naming. Items
6–8 are polish-pass leftovers safe to batch. Re-verify the ⚠ items (pack
ghost arming, size-class re-evaluation, mid-drag DROP TO REPLACE) in a
foregrounded browser before final sign-off.

## Fresh-eyes gate review (round 3 — final)

Date: 2026-07-17. Reviewer: fresh-eyes stranger role, no prior wave reports or
review rounds read; rubric = the six "done" tests in `03-polish-goal.md`.
Environment: static server at :8123, Browser pane 1280×1000, screenshot-first
then DOM-assert. The pane reports `document.hidden=true`, so rAF/drag-ghost
behaviors and synthetic Enter/Space could not be exercised; those are marked ⚠
with the structural evidence accepted. All 45 palette items were placed
(62 parts on board at peak), all six tests run to completion.

### Per-test verdicts

**1. 5-second test — PASS.** Every palette row states its job in one line, and
every placed face answered "what am I / where am I set / what do I say" without
help. SLIDER vs DIAL is legible from faces alone (two named ends on a track vs
one amount on a knob). COUNT is a bare `− 3 +`. REVISE's face (`×2 PASSES`,
`LIGHT TOUCH`) matches its row promise "Draft, check, redo — up to n times."
GROUP VOICE's row promise ("A frame — drop controls inside. DROPS 3 PARTS")
matches placement exactly: a frame arrives holding BREADTH/DEPTH/READER and
composes them into one visible sentence. Unwired visualizers teach their own
wiring ("Wire numbers in to compare them side by side", "the beam tips").
Exceptions recorded under confusions: jack-label/text collisions on fresh work
steps and CURVE, FORK subtitle truncation, GROUP VOICE sentence clipped by its
first child, SWITCH/COUNT faces omitting their sentence line.

**2. Prediction test — PASS.** Selecting an output shows a payload chip before
wiring ("PACE · 50 — SENDS A NUMBER (0–1…"). Dropping WARMTH onto occupied
SPEED replaced rather than stacked, announced as "WARMTH CONNECTED TO SPEED ·
REPLACED PACE" — displaced source and destination slot named distinctly,
non-circular; wire count stayed constant and one undo restored the old wire
atomically ("UNDID · CONNECT WARMTH SPEED"). Run-lever prediction (STAGED ⇒
numbered per-step calls; ONE CALL ⇒ single call with the pinned step explained)
held exactly. Clicking a wired input unplugs it — predictable, and undoable.
⚠ the full "replaced X" wording lives in the aria-live region; sighted feedback
is the jack chip renaming + wire recolor.

**3. One-grammar test — PASS (round 2's failure is fixed).** In STAGED the
eight step foot chips (`→ CALL 1`, `AUTO · → CALL 2` … `→ CALL 8`) matched the
run strip's cards exactly, by number and name, through repeated lever toggles;
removing CRITIQUE renumbered both sides consistently (14 → 13 calls, strip and
chips agree), and undo restored parity. Pressable vs readout chips now split
cleanly (solid border + shadow + pointer vs flat, no shadow, no pointer) —
sortable at a glance. State words are uniform (ORGANISING only, UNWIRED only,
lever is ONE CALL/STAGED everywhere, zero "ONE PASS/IN STAGES" remnants).
Run-strip copy agrees with the lever in both states, including the pinned-part
explanation. Accent colors: zero cross-part collisions across 62 placed parts
(only same-part axes share a hue). Signal jacks are circles; work-artifact
ports are squares — one taught distinction, applied consistently. Residues:
WARMTH ARC/CURVE/FORK earn calls 9–14 visible in prompt rows and run cards but
carry no call chip on their board faces; smallest label size is 9px (legible in
screenshots, but it is the floor).

**4. Dead-chrome test — PASS.** "CONNECTED PREVIEW" occurs zero times. 630
accessible names, none unlabeled, no internal ids. BEAM's invite text is
legible and unstruck (text-decoration none, ~5.5:1 contrast, verified by
computed style). The lone canvas "→" is an overflow cue. Every chip observed
(status, run, tidy) informs a decision. One informative element has wrong
words: NOVELTY's STOP NAMES caption reads "One name per stop — 1 stops need 1
names." while STOPS is OFF (WARMTH's equivalent correctly says "Turn on STOPS
first.").

**5. Storyline test — PASS with one real defect.** The journey narrates
unaided: parts speak sentences on their faces → sentences appear as
color-matched cards in named prompt sections (VOICE/RULES/SHAPE OF THE
ANSWER/APPROACH/READER) → THE RUN turns the prompt into visible calls, with
per-row "→ RUNS AS CALL n" annotations bridging panel to strip. The TRANSLATOR
pack is a labeled board frame with a preset dropdown and an actionable status
chip ("NEEDS READER — FILL IT IN"); no orphan "Mod Pack Instances"/Editor strip
remains. Dropping ~25 parts in a row onto the crowded board produced zero
overlapping cards/tabs/frames (gap-fill placement, verified by pairwise rect
intersection). The tidy loop closes: "15 THINGS TO TIDY" lists concrete,
per-item-actionable issues; NAME IT opened the dial's popover with NAME
preselected, renaming decremented to 14 and removed the row. PLAIN TEXT
renders the exact prompt (rename included) as plain text. Multi-step labeled
undo verified across add, wire, replace, lever, step-removal, and a popover
sentence-template edit ("Undo edit WARMTH sentence" → full revert everywhere).
DEFECT: mod-pack palette rows do not respond to click — "Add NARRATOR" is a
silent no-op while sibling part rows add fine (⚠ real-mouse HTML5 drag may
work; synthetic drags can't trigger DnD in this pane). Minor: auto-placement
can land a part out of view (MIXER behind the prompt panel, GROUP VOICE below
the fold) with no scroll-to or flash.

**6. Settings test — PASS.** Eight diverse popovers examined (WARMTH dial,
NOVELTY range, SELECT, ORDER, FORK, REVISE, GROUP VOICE frame, MEET THEM pad).
All share one top-down grammar: WHAT IT SAYS NOW → NAME → part-specific fields
→ SENTENCE template → WHERE IT GOES → MAKE THIS THE DEFAULT → NOTE, and every
field carries a consequence caption ("Turn on STOPS first.", "Each part fills
its slot with its current value.", "For you — the prompt never reads it.").
WHAT IT SAYS NOW updates live per keystroke while typing in SENTENCE, and
{value} substitution propagates live to the board card and prompt card
simultaneously. The old NOVELTY "flat wall" specimen is gone. No internal ids
in any accessible name. ⚠ Enter/Space on chrome buttons could not be truly
exercised: the pane's synthetic key events carry no key value (verified —
keydown reaches the focused button but native activation never fires); accepted
structurally because every control is a native `<button type="button">` with no
keydown interception, and mouse activation works.

### ⚠ items (structural evidence accepted; re-verify in a visible browser)

- Enter/Space activation of chrome buttons (native buttons, no interception
  found; harness keys carry no key value).
- Mod-pack drop via real pointer drag (rows are `draggable="true"`; only the
  click path is provably dead).
- Visible (non-aria) phrasing of the replace announcement mid-drag (aria-live
  text and post-drop jack chip verified; drag ghost unobservable headless).
- Any mid-gesture affordances (hover tooltips verified only as end states).

### Remaining confusions, ranked

1. Pack rows don't add on click — silent no-op; the likeliest stranger dead
   end on the whole surface (parts rows click-add fine).
2. Fresh work steps: unwired signal-jack labels (BREADTH, GROUPS, STRICTNESS,
   HOW HARD, DEPTH) collide with the step sentence on 6 cards; CURVE's NOW
   label hides under its AUTO chip.
3. In STAGED, WARMTH ARC/CURVE/FORK run as calls 9–14 but their board faces
   carry no call chip (mapping only visible in prompt rows / run strip).
4. Auto-placement can drop a new part out of view with no feedback (MIXER
   landed behind the prompt panel).
5. FORK's subtitle truncates at default size ("…WHEN IT" ), and GROUP VOICE's
   composed sentence is clipped by its first child card as-dropped.
6. SWITCH and COUNT faces show identity + value but not their sentence.
7. NOVELTY STOP NAMES caption: broken pluralization and wrong state copy.
8. 9px jack-label floor — legible but the weakest type on the board.

### Verdict: SHIP

Goal-completion statement: the prototype now passes all six "done" tests as a
capable stranger — every one of the 45 parts names its job from its face; wiring
outcomes, replaces, and the run lever are predictable before touching them; the
one-grammar rule set holds (the round-2 killer — STAGED foot-chip ↔ run-card
parity — is exact through toggles, a step removal, and undo); no dead chrome
survives; the board → sentences → prompt → calls storyline narrates itself and
closes its own tidy loop; and every settings popover teaches each field's
consequence with a live WHAT IT SAYS NOW. What remains is residue, not
structure: the pack-row click no-op (the only defect a stranger would hit as a
wall), six jack-label/text collisions on freshly dropped steps, missing call
chips on non-step call earners, and the ⚠ set above (Enter/Space activation,
real-drag pack drop, mid-gesture affordances) that a foregrounded-browser
session should confirm before archiving the pass.
