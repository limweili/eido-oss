# Stream 3 — Fresh-eyes journey walkthrough

Date: 2026-07-16. Reviewer stance: user-advocate, zero prior knowledge of "mods",
signal payloads, or prompt engines. Prototype served from
`docs/design/prototypes/mod-workbench-v2.html` at desktop viewport
(1600×1000 first, then taller viewports to work around scroll defects — see log).
Screenshots referenced inline as descriptions; they were captured live and are
not committed.

Method note: the walkthrough used the seeded "NARRATIVE SHAPER" demo board
(15 parts / 14 wires / 12 instructions at load), then added one part from every
library category, wired and mis-wired jacks, opened settings, resized cards,
toggled PLAN / IN STAGES, and pressed every header and compiler button.

---

## Part A — Chronological confusion log

Severity scale: **BLOCKER** (journey stops / user is lost), **MAJOR**
(significant confusion, recoverable), **MINOR** (papercut).

### 1. First 30 seconds

| # | Moment | Expected | What happened | Severity |
|---|--------|----------|---------------|----------|
| A1 | Land on page, read header: "MOD WORKBENCH · PROTOTYPE 05 · MOD NARRATIVE SHAPER" | The screen tells me what a "mod" is | Nothing on screen ever defines "mod". The word appears 8+ times (MOD WORKBENCH, MOD name field, ADD A MOD PACK, MOD PACK INSTANCES, EXPORT MOD) with no anchor. My working guess came from the *content* of the parts (WARMTH, FORMALITY, "WRITE AS IF FOR: a busy founder") — this looks like a synth-style patch bay for tuning how an AI writes | MAJOR |
| A2 | Read "● PROMPT PREVIEW 15 PARTS · 14 WIRES · 12 INSTRUCTIONS" | Counts explain themselves | PARTS and WIRES map to visible things; INSTRUCTIONS is only decipherable after finding the compiler strip below the fold. The ● dot suggests "live/recording" — never explained | MINOR |
| A3 | Read "AUTO PARTS RUN — ONE PASS ⟷ IN STAGES" toggle in header | A tool this prominent explains its top-right toggle | Fully opaque. "AUTO PARTS RUN" reads as a label for... running parts automatically? No visible effect when toggled until you also know about PLAN (see F-section). The single most cryptic phrase on the default screen | MAJOR |
| A4 | The seeded board itself | A demo teaches by example | It half-works: knobs with % values and a radar chart labeled with the same words (WARMTH/PACE/…) do teach "controls feed pictures". But SEMANTIC WAVE's jack labels (HEIGHT, SPEED, RIPPLE, STEADY, GRID, WAVES) are a private metaphor — what is "GRID 40%" *of an answer*? | MAJOR |
| A5 | "CONNECTED PREVIEW" chip on four visualizer cards | Chip tells me something actionable | It's dead chrome. Every wired visualizer says it; it never changes; clicking does nothing. (Contrast: READOUT's empty state chip "EMPTY · WIRE INPUT" actually instructs — that's the good version of this idea) | MAJOR |
| A6 | Viewport is 1600×1000, the app is ~1700px tall | App fits or scrolls gracefully | **The PROMPT COMPILER strip is below the fold and body-scrolling is broken**: scrolling down leaves a huge blank void above the sticky header, the header floats mid-screen, and content renders only under it. At 1000px height roughly half the scrolled viewport is wasted blank space. After adding packs (board grows to ~2700px) the compiler and plan strips are effectively unreachable at normal laptop heights | BLOCKER |

### 2. Parts library

| # | Moment | Expected | What happened | Severity |
|---|--------|----------|---------------|----------|
| B1 | Click the "CONTROLS 13 +" category row | Row expands | First click on the row text did nothing perceptible (only the small `+` glyph / precise row hit works; the category headers are also unnamed buttons to assistive tech). Second attempt expanded | MINOR |
| B2 | Read CONTROLS list: DIAL, SLIDER, SWITCH, COUNT, WORDS, PAD, RANGE, FILTER, CURVE, SELECT, ORDER, MIXER, GROUP VOICE | Names say what parts *mean* | These are widget *shapes*, not meanings. WORDS? PAD? ORDER? MIXER? GROUP VOICE? Nothing distinguishes "a dial I name myself" from the pre-named knobs on the demo board (WARMTH is also a dial — but WARMTH isn't in the library, so where did it come from?) | MAJOR |
| B3 | Click DIAL to place it | Something obvious happens where I'm looking | A DIAL appeared top-center of the board (out of my visual focus), the only explicit feedback being an 8px "DIAL ADDED" hint at the *bottom of the library panel* and a +1 in the header counts. I initially concluded the click had failed. Feedback is systematically far from the action — this same bottom-left whisper channel is used for wiring, copy, export, undo, and errors | MAJOR |
| B4 | The placed DIAL emits "Dial: 50%." into the VOICE column | A part earns its place | A literal nonsense instruction ("Dial: 50%.") enters the prompt immediately, in a *purple* chip identical in color to DETAIL's. An unnamed dial compiles to a sentence no AI could act on, and nothing flags it as needing a name | MAJOR |
| B5 | PROCESS category: STAGE, FORK, REVISE. Placed FORK | Face explains the part | FORK's face: a line forking to "PATH A / PATH B", corners "AUTO" and "EVEN". Its compiled chip (APPROACH): "First decide — which way to go? If path a — take that path. If path b — take that path. When it could go either way, keep the two in balance." — placeholder text compiled into circular nonsense. AUTO and EVEN unexplained on the face | MAJOR |
| B6 | STEPS category: EXPLORE, CLUSTER, CRITIQUE, COMPRESS, REFRAME, DEVELOP, COMBINE. Placed EXPLORE + CLUSTER | — | Best faces in the tool: a plain sentence on the card ("Range widely — ten unlike directions before settling."). Compiled chip prefixes "As part of the work: …" — legible. Two mysteries remain: a "❯" arrow glyph on the left edge (unlabeled), and "AUTO" in the corner (auto *what*?) | MINOR |
| B7 | VISUALIZERS: 15 items incl. SEMANTIC WAVE, RADAR, LEVELS, MATRIX, LIGHT GRID, BANDINGS, CONSTELLATION, BRANCHES, WINDOW, SCORE, READOUT, READOUT PAIR, BEAM, TRIM, STEPS | Names hint at what they show | Half are guessable (RADAR, READOUT, WINDOW-as-limits is not), half are poetry (BANDINGS, CONSTELLATION, LIGHT GRID, TRIM). Library tooltips exist in `title` attributes ("Is the idea coherent or scattered?") but only on hover, and never on the placed card | MAJOR |
| B8 | Placed READOUT | Useful empty state | Genuinely good: card shows "EMPTY · WIRE INPUT" and dash placeholders. But its card title truncates to "R…" at default size, and its input jack announces itself as **"s3 — scalar/control signal input"** — an internal id leaking into UI/accessibility. After wiring, the confirmation hint reads "DIAL CONNECTED TO S3" | MAJOR |
| B9 | ADD A MOD PACK: TRANSLATOR (added) | One thing appears | **Six parts** materialize pre-wired in the bottom-right (EXAMPLES knob, TECHNICAL DEPTH knob, BIG PICTURE knob, BANDINGS visualizer, THE READER text field, MEET THEM 2D pad), *plus* a brand-new full-width "MOD PACK INSTANCES" strip between board and compiler, *plus* a READER column later in the compiler. Board now has **two parts named EXAMPLES** (a stepper at 3 and a knob at 50%) with no disambiguation anywhere | BLOCKER |

### 3. Wiring

| # | Moment | Expected | What happened | Severity |
|---|--------|----------|---------------|----------|
| C1 | Find how to wire | Drag from jack to jack | Drag works, and click-to-arm also works (armed jack turns red with a black name tag — nice). But nothing *teaches* either gesture; jacks are ~7px targets and I missed repeatedly (each miss silently "CONNECTION CANCELLED") | MAJOR |
| C2 | Jack shape grammar | Shapes/colors teach compatibility | Three shapes exist — circles (scalar), pills (span: LENGTH/NOVELTY), squares (step artifact) — but nothing introduces the vocabulary. Jack *color* means "color of the source part", which collides with using color to read compatibility. The demo's SEMANTIC WAVE inputs are colored by their *connected sources*, so an unwired input's grey is the only "empty" cue | MAJOR |
| C3 | Invalid connection: NOVELTY (span) → TONE OF VOICE WARMTH (scalar) | Rejection with a reason | Wire snaps away; the only feedback is "CONNECTION CANCELLED" in the library footer (bottom-left of screen, 8px). No reason, no shake, no tooltip. Same message whether I mis-clicked, targeted an occupied input, or mismatched types — three different failures, one mute response | MAJOR |
| C4 | Wire into an already-connected input (WAVES ← EXAMPLES) | Steal or explain | Silent CANCELLED (no steal, no message about "already wired") | MAJOR |
| C5 | NO HEDGING (a toggle) → EXPLORE's BREADTH (scalar/control input) | Type system protects meaning | Accepted ("NO HEDGING CONNECTED TO BREADTH", 19 wires) — an on/off switch now drives "how widely to range", and **the compiled EXPLORE instruction did not change at all**. A wire that does nothing and means nothing is accepted; a span→scalar wire is rejected. The rules are shape-level, not meaning-level, and neither is explained | MAJOR |
| C6 | Wire DIAL → READOUT across the board | Wires route legibly | The wire crosses straight through the SEMANTIC WAVE card. Demo wires already cross constantly (14 wires = spaghetti through card faces). No routing, no dimming, no hover-highlight of a single wire's endpoints | MINOR |

### 4. Settings popovers

Ranked comprehensibility of fields (NOVELTY popover, representative — same
template as WARMTH/DIAL; FORK adds its own):

1. **TITLE** — obvious, works (renames chip + card).
2. **PROMPT AT CURRENT VALUE** ("Novelty: between 30 and 70.") — the single best
   teaching element in the whole tool… placed *last*, styled as a greyed
   footnote.
3. **PROMPT SECTION** (dropdown: VOICE/RULES/…) — clear once you have seen the
   compiler columns; meaningless before.
4. **DESCRIPTION** ("What does this control mean…") — writable but I never found
   where it surfaces (CONFIDENCE's description "How strongly to commit to
   opinions." shows as chip subtitle — and leaks into the compiled text, see E4).
5. **SAYS** ("Novelty: {value}.") — template override; `{value}` syntax
   unexplained but guessable.
6. **SET AUTHORED DEFAULT** — button, jargon. Authored by whom? (It snapshots
   the current value as the part's default — you only learn by pressing it.)
7. **STEPS** (− OFF +) — utterly opaque. Detents? Stages? No unit, no effect
   visible at OFF.
8. **STOP NAMES** ("a phrase, a paragraph, …") — pairs with STEPS (named
   detents) but sits two fields away from it; unguessable in isolation.

FORK's popover adds: **LOOK AT** with placeholder *"whether this needs looking
things up…"* (broken English), PATH 1/PATH 2 NAME+THEN blocks (fine), PATHS
stepper (fine), **FIDELITY** [ONE PASS | IN STAGES | AUTO] — the same words as
the header toggle, which is the *only* place the two UIs ever echo each other,
and still no sentence links them. Severity for the popover system overall:
**MAJOR** (fields exist for authors, in author vocabulary, shown to everyone).

Asymmetry: knobs/sliders/processes have a Configure gear; **steps and
visualizers have none** — VISUALIZER behavior (e.g. TONE OF VOICE's add/remove
point buttons) hides in tiny unlabeled card-corner glyphs instead. Two different
settings philosophies with no rationale a user can infer. **MAJOR**.

### 5. Resizing

| # | Moment | What happened | Severity |
|---|--------|---------------|----------|
| E1 | Find resize affordance | Handle is `opacity: 0` until precise corner hover — invisible. Found it only via accessibility tree ("Resize WARMTH") | MAJOR |
| E2 | Shrink WARMTH to minimum | Card becomes a naked mini-knob; its name jumps *outside* the card into a floating black tag that overlaps the neighboring jack and wires. "72%" keeps rendering but the ring arc is ~20px. Screenshot: micro-card top-left, black "WARMTH" pill colliding with its own output wire | MAJOR |
| E3 | Enlarge WARMTH to ~4× | A giant knob in a mostly-empty card — no extra information appears at large size (no ticks, no description, no prompt sentence); "72%" stays small and bottom-anchored. Size buys pixels, not meaning | MAJOR |
| E4 | Side effect of resizing | **The whole board re-flows**: every other card was pushed to new positions (auto-push collision resolution), wires re-routed through card faces. One resize scrambled my mental map of the board. Undo exists (labeled "Undo resize WARMTH" — good) but the visual jolt is unannounced | MAJOR |
| E5 | Truncated titles at default sizes | "R…" (READOUT), "TECHNICAL DEP…", "NOTHING INVEN…" — default card widths already truncate their own names | MINOR |

### 6. PROMPT COMPILER strip

| # | Moment | What happened | Severity |
|---|--------|---------------|----------|
| F1 | Map chips to board parts | Mostly works: chip label = part name, chip color = part color. But colors repeat (PACE and FORMALITY both blue; DETAIL, DIAL, FORK, NOVELTY all purple-family), two LENGTH chips come from two different LENGTH parts, and nothing links back on click (clicking a chip *edits its text* instead of highlighting its part — I expected navigate-to-source) | MAJOR |
| F2 | Grouping VOICE / RULES / SHAPE OF THE ANSWER / APPROACH | The taxonomy is actually sensible (how it sounds / what it must obey / what it looks like / how to work). But nothing on any *part* face shows which section it will land in until you open its settings, and section headers don't explain themselves ("SHAPE OF THE ANSWER" holds EXAMPLES and WARMTH ARC — shape of *prose*?) | MINOR |
| F3 | Chip subtitles leak | CONFIDENCE chip carries its description as a sub-line — and that description compiles into the exported prompt as a standalone sentence: "How strongly to commit to opinions." floats in the middle of ## VOICE with no subject | MAJOR |
| F4 | "(X — silent)" chips | THE READER, MEET THEM · LEVEL, MEET THEM · READING, TECHNICAL DEPTH, NO HEDGING(off) all render grey chips reading "(THE READER — silent)". "Silent" is never defined (= emits nothing at current value). Six ghost chips of noise explaining themselves in a private word | MAJOR |
| F5 | Duplicates after EDITOR pack | RULES contains both "Length: no more than a section." and "Keep the whole answer to no more than a section." (two LENGTH parts), plus "Novelty: between 30 and 70." *and* "Keep the ideas between familiar and fresh." (two NOVELTY parts). The compiled prompt says the same thing twice in different voices; nothing detects or merges the collision | BLOCKER |
| F6 | VIEW AS TEXT | Button toggles to HIDE TEXT — and *nothing visibly changes*: the `<pre>` panel is appended below the chip columns, off-screen, with no scroll-to. I had to inspect the DOM to find the text I had asked for | MAJOR |
| F7 | COPY PROMPT / EXPORT MOD | Both work; both report *only* via the bottom-left library whisper ("PROMPT COPIED · 122 WORDS", "MOD SPEC EXPORTED · AUTHORING DATA ONLY · NO RUN RESULT INCLUDED") — the far corner from the buttons pressed. Export's caveat text is good content in the wrong place | MINOR |

### 7. MOD PACK INSTANCES strip + Editor row

| # | Moment | What happened | Severity |
|---|--------|---------------|----------|
| G1 | What is this strip? | A row per added pack: name, job sentence ("Fit the answer to its reader."), an E.G. line, a dropdown labeled READER PROMPT/RULES PROMPT with options STOCK / QUICK READ / DEEP DIVE (+ save), and a right-aligned status word. The *job sentence* is genuinely the best explanation of packs anywhere — but the strip never says what an "instance" is, why packs get a row when ordinary parts don't, or how the row relates to the six parts it spawned on the board (no hover-link, no shared highlight) | BLOCKER |
| G2 | "NEEDS READER" vs "READY" status | TRANSLATOR shows NEEDS READER because THE READER field on the board is empty — a real, useful prompt-blocking condition — rendered as an 8px static label that looks like decoration. EDITOR shows READY. No affordance to click the status and be taken to the empty field | MAJOR |
| G3 | Icon row ↺ ✎ − ◉ ⧉ × | Tooltips (hover-only): Restore stock pack / Rename selected variation / Delete selected variation / **Mute pack** (◉?) / Duplicate pack / Remove pack. "Variation" and "stock" are a whole versioning vocabulary introduced by five 10px glyphs | MAJOR |
| G4 | EDITOR pack added | Spawned *duplicates of existing part types* (second NO HEDGING — off, second LENGTH, second NOVELTY "FAMILIAR-FRESH", NOTHING INVENTED with a **red** toggle — first red control in the tool, red=on=protective, colliding with red=danger) plus a *second* WINDOW visualizer ("3 INDEPENDENT LIMITS") that looks identical in kind to the existing one ("2 INDEPENDENT LIMITS") | MAJOR |

### 8. PLAN / AUTO PARTS RUN / ONE PASS vs IN STAGES

| # | Moment | What happened | Severity |
|---|--------|---------------|----------|
| H1 | Click PLAN (header) | **Literally nothing** visible happens (with ONE PASS active there is no plan section, and PLAN is actually a scroll-jump to a zero-height region). The only trace: bottom-left whisper "NO STAGED WORK YET · SWITCH AUTO PARTS TO IN STAGES OR PIN A PART". A primary header button that no-ops on first press | BLOCKER |
| H2 | Switch to IN STAGES | Three simultaneous silent changes: (a) header preview becomes "PLAN PREVIEW · 7 CALLS", instructions count drops 22→18; (b) FORK, EXPLORE, CLUSTER and WARMTH ARC chips *vanish* from APPROACH / SHAPE OF THE ANSWER; (c) a new "PLAN PREVIEW (7 CALLS)" strip appears at the very bottom of a ~3000px page. Nothing moves visibly from A to B; you must find the corpse and the new body yourself | BLOCKER |
| H3 | Read PLAN PREVIEW | Content is actually the storyline payoff: WORK CHAIN → 1 CALL EXPLORE (BREADTH 10/10 — note: my nonsense NO HEDGING wire *did* end up somewhere: breadth pegged to 10/10); WORK CHAIN → CLUSTER; WARMTH ARC · AUTHORED SHAPE → 3 CALLS (stages 1–3 holding warmth at 3/10, 9/10, 4/10); FORK · 1 OF 2 ROUTES AT RUN TIME → 2 CALLS (DECIDE + PATH A/B "POSSIBLE"). This is the best narrative artifact in the tool — buried at maximum scroll distance, disconnected from the board (no part highlighting, no wires into it) | MAJOR |
| H4 | Toggle meaning | Only after all this do the words parse: "AUTO PARTS RUN [in] ONE PASS / IN STAGES" = "when the mod runs, parts execute in one API call vs staged calls". The FIDELITY field in FORK's settings (ONE PASS/IN STAGES/AUTO) is the per-part version. Zero copy anywhere states this | BLOCKER |

### 9. Header buttons

| # | Moment | What happened | Severity |
|---|--------|---------------|----------|
| I1 | WORKBENCH / PROMPT / PLAN look like view tabs | They are **scroll anchors** (`scrollIntoView`) styled identically to the UNDO *action* button sitting in the same group. With the broken body-scroll rendering they jump you into the blank void; with a fitted viewport they appear to do nothing at all | MAJOR |
| I2 | UNDO | Works, and its accessible label updates ("Undo add editor pack", "Undo resize WARMTH") — genuinely good. Visible label stays "UNDO" though, and feedback is again the bottom-left whisper ("UNDID · RESIZE WARMTH") | MINOR |

---

## Part B — Ranked top-15 confusion inventory

1. **PLAN no-ops and ONE PASS/IN STAGES reshuffles the UI silently** (H1+H2+H4).
   The run-model — the entire point of authoring — is gated behind an
   unexplained header toggle, a no-op button, and a strip at maximum scroll
   depth. BLOCKER.
2. **Broken page scroll / below-the-fold architecture** (A6, F6, H3). At a
   normal laptop height the compiler is under the fold, scrolling renders a
   void, and after packs the compiler/plan are unreachable. Everything the
   board *produces* lives where the user can't see it. BLOCKER.
3. **Mod packs detonate rather than arrive** (B9, G1, G4). One click → six
   pre-wired parts + a new strip + a new compiler column + duplicate part names
   + a second identical-looking WINDOW. No visible relationship between the
   pack row, its board parts, and its compiler chips. BLOCKER.
4. **Duplicate/contradictory instructions compile silently** (F5, B4, B5).
   Two LENGTH rules, two NOVELTY rules, "Dial: 50%.", FORK's placeholder
   tautology — the tool lets the prompt contradict and embarrass itself with no
   lint. BLOCKER.
5. **Feedback whisper channel** (B3, C3, F7, I2). Every confirmation and every
   error for every action anywhere on a 1600px screen lands in 8px text at the
   bottom of the left library panel. MAJOR→systemic.
6. **"AUTO PARTS RUN / ONE PASS / IN STAGES" copy** (A3, H4). Six words that
   gate the whole execution story, meaningless at first, second and tenth
   glance. BLOCKER-adjacent.
7. **Wiring failures are mute and undifferentiated** (C3, C4, C5). One grey
   "CONNECTION CANCELLED" for mis-click, occupied input, and type mismatch; and
   accepted wires can be semantically dead (toggle→BREADTH changed nothing in
   the compiler — though PLAN later revealed BREADTH 10/10, so the wire had an
   effect *only* visible three screens away). MAJOR.
8. **Settings are author-tool internals shown to everyone** (D-section). STEPS,
   STOP NAMES, SAYS, SET AUTHORED DEFAULT, FIDELITY, LOOK AT (broken English
   placeholder) — while the one field that teaches (PROMPT AT CURRENT VALUE)
   is the greyed last row. MAJOR.
9. **Visualizer language is private poetry** (A4, B7). HEIGHT/SPEED/RIPPLE/
   STEADY/GRID/WAVES; BANDINGS; CONSTELLATION; WINDOW-means-limits. Faces
   don't carry their library tooltips, so the one-line explanations that *do*
   exist never reach the board. MAJOR.
10. **"CONNECTED PREVIEW" dead chrome** on every wired visualizer (A5) — the
    named defect confirmed; contrast with READOUT's instructive "EMPTY · WIRE
    INPUT". MINOR each, MAJOR in aggregate.
11. **Part color is decoration that collides with meaning** (B4, F1). Colors
    assigned round-robin; two blue chips ≠ related, four purple chips ≠
    related; jack colors inherit part colors so color can't teach type. MAJOR.
12. **Resize: invisible handle, board-wide reflow, size buys no meaning**
    (E1–E4). MAJOR.
13. **Header "tabs" are scroll anchors mixed with an action** (I1). MAJOR.
14. **Internal ids leak** ("s3 — scalar/control signal input", "DIAL CONNECTED
    TO S3", card titles truncating to "R…"). MINOR but trust-eroding.
15. **Two settings philosophies** — Configure-gear parts vs gearless
    steps/visualizers with unlabeled corner glyphs (add/remove point, add/remove
    input, AUTO buttons). MAJOR.

Honorable mentions: category headers unnamed for AT (B1); NEEDS READER status
not actionable (G2); variation vocabulary via 10px glyphs (G3); red toggle
means "protection on" (G4); "MEET THEM · LEVEL/READING" axis names appearing in
chips but not on the pad's face (F1).

---

## Part C — The storyline I THINK this tool wants me to follow, and where it breaks

The intended narrative, reconstructed after ~90 minutes:

> *Pick parts that each say one thing about the answer you want (its voice, its
> rules, its shape, its working method). Wire them into instruments to see what
> you've dialed in. The compiler turns every part into one plain sentence,
> grouped into a prompt. Mod packs are pre-authored bundles of parts with one
> job each. When the mod runs, parts either all fire in one call (ONE PASS) or
> unfold into a staged plan of calls (IN STAGES) — PLAN shows that dry-run.*

Written down, that's a genuinely good story. The prototype breaks it at five
seams:

1. **Board → compiler.** The seam works *conceptually* (chip = part, sentence =
   value) but is broken *physically*: the compiler lives below a fold that the
   page can't scroll to cleanly, and back-references (chip→part) don't exist.
   The user must hold the mapping in memory across a screen boundary.
2. **Part → sentence.** The translation ("Warmth: 72%.") is visible only in the
   compiler or the last line of a settings popover. The parts themselves never
   speak their sentence — the face shows a %, the sentence lives two screens
   away. The Lego brick doesn't show what it snaps into.
3. **Pack → parts.** MOD PACK INSTANCES is a *management* surface (variations,
   mute, remove) posing as an *explanation* surface. The one-sentence job
   ("Set hard limits and safeguards.") is exactly right — but the row shares no
   visual DNA (color, outline, hover-link) with the six parts it dropped on the
   board or the column it added to the compiler, so the pack's identity
   evaporates the moment it lands.
4. **Author → user.** Half the vocabulary (AUTHORED DEFAULT, AUTHORED SHAPE,
   STOCK, variations, SAYS templates) belongs to the person who *makes* mods;
   it's presented undifferentiated to the person who *uses* one. Two audiences,
   one popover.
5. **Compiler → plan.** The climax — "your knob's arc becomes 3 staged calls;
   your fork becomes a runtime decision" — is the most impressive and most
   buried thing in the tool: entered through an unlabeled header toggle, with
   chips silently vanishing from the compiler and reappearing (transformed,
   unannounced) at the bottom of a 3000-pixel page. The one moment the
   architecture pays off is staged as a disappearance.

**Is the core journey narratable?** Build → prompt: *yes, weakly* — a patient
fresh user can get from knobs to "oh, it writes my prompt" inside ten minutes,
mostly thanks to the seeded demo, the chip/part name echo, and PROMPT AT
CURRENT VALUE. Build → prompt → plan: **no** — without outside knowledge the
ONE PASS/IN STAGES/PLAN triad reads as furniture, and the user who does flip
the toggle watches their compiler lose chips and gains no idea why. The story
exists in the data model and dies in the layout.

---

## Appendix — session facts for reproducibility

- Seed board: NARRATIVE SHAPER, 15 parts / 14 wires / 12 instructions.
- Final state after walkthrough: 32 parts / 22 wires / 18 instructions (IN
  STAGES), PLAN PREVIEW · 7 CALLS.
- Compiled text export (VIEW AS TEXT) reproduced in F-notes; notable lines:
  "Dial: 50%.", orphan "How strongly to commit to opinions.", double LENGTH and
  double NOVELTY rules.
- Wiring tests: DIAL→READOUT(s3) OK; NOVELTY(span)→radar scalar CANCELLED;
  artifact→scalar CANCELLED; occupied input CANCELLED; NO HEDGING(toggle)→
  EXPLORE BREADTH accepted, no compiler change, BREADTH 10/10 in plan.
- Popovers audited: NOVELTY, WARMTH, FORK. No Configure on steps/visualizers.
- Resize audited: WARMTH min (external name tag, jack overlap) and ~4× (empty
  giant card); board auto-reflow on both; handle opacity 0 at rest.
- Scroll defect: body scroll renders blank void above sticky header at any
  scrollY > 0 (1600×1000 and 1600×1750 viewports); compiler unreachable at
  1600×1750 once board height > viewport.
