# 02 — Design-language audit (Stream 2)

Adversarial catalogue of the Mod Workbench's visual grammar *as coded*, and
every place it is applied inconsistently. Sources audited:
`docs/design/prototypes/lib/{DESIGN.md, mod-ui.css, mod-ui.js, gallery.html}`
and `docs/design/prototypes/mod-workbench-v2.html` (inline CSS lines 9–906,
inline JS 1057–6897). Stance: **every inconsistency is treated as a bug in the
design language until proven intentional-and-teachable.** No new grammar is
proposed here — that is Stream 4.

Severity: **breaks-comprehension** (a fresh user misreads what the thing is or
does) / **erodes-trust** (looks like a bug / half-finished / says two things) /
**cosmetic** (polish).

A recurring theme, stated once: the library (`lib/`) is largely spec-faithful
and the gallery specimen page holds the line. **Almost every violation lives in
the workbench host chrome** (`mod-workbench-v2.html`), which re-invents type
sizes, chips, and state words that `DESIGN.md` already standardised. The
"circles vs ovals" jack defect is the exception — that one is the *spec's own
glyph code* working exactly as written, and failing the user anyway.

## Severity-ranked summary

| # | Finding | Severity | Where |
| --- | --- | --- | --- |
| T1 | Workbench chrome uses a **13-step font ladder** (6.8→20px) vs DESIGN's sanctioned 4; **46 declarations below the 9px floor** | breaks-comprehension | mod-workbench-v2.html passim |
| T2 | Viz state badge renders at **6.8px** mono caps — smallest text in the app, names each lens's state, effectively unreadable | breaks-comprehension | mod-workbench-v2.html:277 |
| S1 | "Off / empty / nothing" has **≥5 spellings**: `OFF` / `—` / `EMPTY · WIRE INPUT` / `CONFLICT` / (blank) | breaks-comprehension | 3537, 3561, 4655, 4658, 5778 |
| C1 | **~9 near-identical capsule/chip styles**; user cannot tell which chips are clickable (toggle/nav) vs dead readouts | breaks-comprehension | see §2 |
| J3 | **Five jack contexts, mostly unlabeled** (out / in-chevron / artifact square / rail dot / free dot); large hidden vocabulary | breaks-comprehension | mod-ui.css:293–896 |
| A1 | Three board-part identity marks — round dot / no dot / square dot — with nothing on-face teaching the taxonomy | breaks-comprehension | mod-ui.css:237, 1515, 1849 |
| S4 | Run-posture split across **4 unrelated widgets** (plate status, FAST◄►PRECISE lever, fidelity foot chips, AUTO PARTS RUN) with no shared family | breaks-comprehension | 61, 769, filter-foot, plan |
| J1 | range+filter emit **oval (capsule) jacks**, all else round, steps square — a 4-way payload code nothing on the face teaches (the user's flagged defect) | erodes-trust | mod-ui.js:62; mod-ui.css:833, 882 |
| C2 | **"PREVIEW" appears 9× as filler** across 6 surfaces; carries nothing actionable | erodes-trust | 920,1034,1048,3617,4655-57,6633 |
| C3 | Viz state badge is **persistent chrome not in the visualizer contract** (spec says head-right is hover-revealed −/+/×) and duplicates what wires already show | erodes-trust | 4647–4670 vs DESIGN §viz-contract cl.1 |
| C4 | Compiler card value-pill has **~12 grammars** in one slot: `72%` `ON` `×3` `STEP` `≤40` `30–60` `9/10 PREVIEW` `3PT ↥90` … | erodes-trust | 3535–3665 |
| S2 | Switch off-state disagrees with itself: card pill `OFF`, readout lens `—` | erodes-trust | 3537 vs 5778 |
| T3 | No single "eyebrow" spec: viz title is 9px in lib, 10px in workbench; headers scattered 8/8.5/9/10px, weights 500/600/700 | erodes-trust | 269 vs mod-ui.css:1540 |
| A2 | Visualizer shell **implemented twice** (lib `.mui-viz` + workbench `.wb-viz`) with divergent heads | erodes-trust | mod-ui.css:1515 vs mod-workbench:261 |
| A3 | Per-size info-hiding is **bespoke per lens** (each label hides at a different sz threshold); no shared "what disappears when" | erodes-trust | 352,418,469,514,617 |
| Co2 | "Each part gets a hue" chain **breaks at steps**: all steps share one fixed `STEP_ACCENT`; plan step/decide segments too | erodes-trust | 1952, 3999 |
| J2 | Jack overhang differs by family (scalar −8, artifact −9, span −13px): cables leave a mixed column at 3 insets | cosmetic | mod-ui.css:294,834,889 |
| C5 | Value-in-a-pill exists as **two components** (`.mui-pill-readout` accent-cap vs `.mui-card-pill` wash); pill-readout is a dead lib surface (0 workbench uses) | cosmetic | mod-ui.css:710; gallery:287 |
| T4 | Font-weight applied ad hoc (600 on ~15 chrome labels, 700 on two) though DESIGN type tokens specify none | cosmetic | passim |
| Co3 | Artifact wires forced ink `!important`; signal wires colored — two cable-color systems, undeclared | cosmetic | mod-workbench-v2.html:815 |
| Co4 | `--mui-yellow` carries **two unrelated meanings** (conflict seam, silent-member tooltip) though reserved for "a rare state mark ONLY" | cosmetic | 496, 654 |
| S3 | Wired/unwired shown **3 redundant ways** (jack fills accent, slot goes faint, badge prints CONNECTED/EMPTY) | cosmetic | mod-ui.css:321,1625; 4655 |
| J4 | DESIGN's one-line rule "round signal vs square artifact" is contradicted by its own 4-glyph table (capsule is signal yet not round) | cosmetic (spec-internal) | DESIGN.md §jack glyphs |

**Counts:** 23 findings — **7 breaks-comprehension, 9 erodes-trust, 7 cosmetic.**

---

## 1. Jacks / ports

### The rule DESIGN.md claims
Two cable *families*: **signal** (round-ish) and **artifact** (square,
non-mating). Within signal, **four** payload glyphs:
- scalar → **filled round dot** (13px, `.mui-node-dot`)
- span → **capsule / oval** (22×12px, `.mui-node--span`)
- series → **round dot with a 3-segment polyline inside**
- artifact → **square port** (15px, 2px radius, `.mui-node--artifact`)

Plus a direction cue: input jacks straddle the **left** edge and wear an
**inward chevron** (`.mui-node--in`, `IN_CHEV`). Output nodes are **hollow**
when unwired, **accent-filled** when connected.

### How the implementation applies it

| Part / context | Jack shape | Assigned at |
| --- | --- | --- |
| dial, slider, switch, count, fork, revise, order | round dot (scalar) | `JACK_TYPE` default, mod-ui.js:495 |
| **range, filter** | **oval capsule (span)** | mod-ui.js:62 `{range:'span', filter:'span'}`; mod-ui.css:833–839 |
| curve | round dot + polyline (series) | mod-ui.js:62 `{curve:'series'}`; mod-ui.css:840–850 |
| pad | two round dots, Y@30% X@56% | mod-ui.js:484–487; mod-ui.css:894–895 |
| mixer | N round dots, `top` inline per channel | mod-ui.js:505–508 (`.mui-node--mix` has no CSS — positioned inline) |
| select | **no jack** (jackless by design) | mod-ui.js (node=null) |
| curve POSITION | round dot + **inward chevron**, left edge | mod-ui.js:1076; mod-ui.css:862–876 |
| step artifact-in / -out | **square** port | mod-ui.js:3017–3022; mod-ui.css:882–890 |
| step signal inputs | round dot + chevron, left column | mod-ui.js:3032; mod-ui.css:1869 |
| viz rail dots (levels/radar/matrix/beam…) | round dot | `ModUI.rail` → nodeDot, mod-ui.js:2896 |
| free dots (DRIFT, POSITION, score cursor) | round dot | mod-workbench:5132, 5589 |

**J1 — the oval-vs-circle defect is the spec's glyph code, not a bug (erodes-trust).**
`mod-ui.js:62` deliberately makes range/filter emit oval span jacks while
everything around them is round. The implementation is faithful; the *design
language* is the problem. Nothing on a control's face says "this jack carries a
range of values," so two sibling controls with a round vs oval jack read to a
fresh user as a rendering glitch — which is exactly what weili's screenshot pass
flagged. **The fix is a design decision (teach the code, or unify the glyph),
deferred to Stream 4.**

**J2 — three overhang insets (cosmetic).** Scalar sits at `right:-8px`
(mod-ui.css:294), artifact at `-9px` (889), span at `-13px` (834). Down a
column of mixed controls the cable roots do not align to one vertical line.

**J3 — five jack contexts, a large unlabeled vocabulary (breaks-comprehension).**
A user must learn: hollow dot (unwired out), filled dot (wired out), dot+inward
chevron (input, met only on curve POSITION + steps), oval (span), dot+polyline
(series), square (artifact), plus rail dots and free dots. Chevron
(mod-ui.css:862–876) and square (882) each appear on exactly one or two parts,
so they are glyphs a user meets once and cannot build a habit around.

**J4 — spec-internal contradiction (cosmetic).** DESIGN.md's prose summary
("round signal vs square artifact") is contradicted by its own glyph table,
where the span **capsule** is a signal jack that is not round. Minor, but it is
the sentence the fix stream will quote, so it needs reconciling.

---

## 2. Chips / badges

**C1 — ~9 near-identical chip styles; clickability is unreadable (breaks-comprehension).**

| Chip class | Look | Interactive? | Carries info? | Where |
| --- | --- | --- | --- | --- |
| `.wb-viz-state` | bordered capsule, **6.8px**, ink-faint | no | redundant (wires show it) | mod-workbench:274 |
| `.plan-pill` | bordered capsule, 8.5px, 600 | no | yes (`N CALLS`) | 856 |
| `.plate .chip` | bordered capsule, 8.5px, 600 | no | static badge (`SPEC 05`) | 39 |
| `.wb-chip` | bordered capsule, 8px, 600 | **yes — toggle** | yes (preset) | 660 |
| `.wb-jump` | bordered chip, 8px, 600 | **yes — nav** | yes | 64 |
| `.plan-seg-sample` | accent-tinted capsule, 8.5px | no | yes (value) | 882 |
| `.mui-card-pill` | translucent currentColor capsule | no | yes (value) | mod-ui.css:804 |
| `.wb-sc-chip` | solid-ink capsule tooltip | no | yes (transient) | mod-workbench:516 |
| `.mui-pill-readout` | accent-cap + hairline capsule | no | yes | mod-ui.css:710 (unused in wb) |

The bordered-ink-faint capsules (`wb-viz-state`, `plan-pill`, `plate .chip`,
`wb-chip`, `wb-jump`) are nearly indistinguishable, yet two of them are the only
clickable ones. No visual rule separates "readout" from "button."

**C2 — "PREVIEW" is dead filler, 9× (erodes-trust).** `wbStatusLabel` PROMPT
PREVIEW (920), chead-note AUTHORING PREVIEW (1034), plan head PLAN PREVIEW
(1048), curve pill `9/10 PREVIEW` (3617), viz badge CONNECTED/PLAN/PROMPT
PREVIEW (4655–4657), plan label (6633,6636). It tells the user nothing they can
act on — the goal doc's named "CONNECTED PREVIEW is meaningless chrome" is one
instance of a 9-way pattern.

**C3 — the viz state badge is off-contract (erodes-trust).** `updateVizState`
(4647–4670) prints a persistent badge into `shell.head` (4632). DESIGN.md's
visualizer contract clause 1 says the head's right side is *hover-revealed*
chrome (optional −/+, then ×) — no persistent badge exists in the contract. The
badge also restates the one bit the cables already carry (a wired viz visibly
has wires).

**C4 — one card slot, ~12 value grammars (erodes-trust).** `pillValue` /
`pillFor` (mod-ui.js card pill fed from mod-workbench 3535–3665):
`72%` (dial/slider) · `ON`/`OFF` (switch) · `×3`/`OFF` (revise) · **`STEP`**
(step — a literal word, no value, 3570) · `62%` per axis (pad) · `≤ 40` / `30–60`
/ `≥ 20` (filter/range span, 3334–3336) · stage-stop name e.g. `≤ SECTION`
(3550) · `9/10 PREVIEW` or `3PT ↥90` (curve, 3616) · fork `LEANS …` · select
option UPPER · order `ITEM ›` (3639) · mixer `CH 50` (3650) · `4 PARTS` (group,
6474). No shared format; some are values, some are words, one (`STEP`) is pure
chrome.

**C5 — value-in-a-pill is two components (cosmetic).** `.mui-pill-readout`
(accent-tinted left cap + hairline, the "F 110HZ" family, mod-ui.css:710) and
`.mui-card-pill` (translucent currentColor wash) render the same concept two
ways. `.mui-pill-readout` has **zero consumers in the workbench** — it appears
only in gallery.html:287–289 as a specimen. Dead lib surface.

---

## 3. Typography & labels

**T1 — a 13-step font ladder vs 4 sanctioned sizes (breaks-comprehension).**
DESIGN.md sanctions exactly: micro **9** / label **10** / value **11** / card
sentence **13** (+ step prose 12). The workbench inline CSS uses:
`6.8, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 12, 13, 20px`. **46 declarations sit
below the 9px floor** (6.8×1, 7×3, 7.5×5, 8×31, 8.5×6). For contrast, the
gallery specimen page uses only 9/10/11/13 (+ one 58px poster title). The
sub-9px chrome — pack instance kind/example/scope (7px, 157–162), config-preview
strong (7.5px, 118), viz-state (6.8px, 277), plan-track-label (7.5px, 865),
countless 8px labels — is the "labels unreadable at rendered size" defect,
quantified. Mono caps with 0.09–0.14em tracking at 7–8px is below comfortable
legibility.

**T2 — the 6.8px viz badge (breaks-comprehension).** `.wb-viz-state`
(mod-workbench:277) is the single smallest type in the app and it labels each
lens's connection state. At 6.8px caps it cannot be read at rendered size.

**T3 — no single eyebrow spec (erodes-trust).** The same "quiet caps label over
a thing" role is drawn at: 10px (`.mui-label`, control), 9px (`.mui-viz-title`,
lib, mod-ui.css:1540), **10px** (`.wb-viz-head`, workbench, 269 — the same viz
title at a different size depending on which shell built it), 9px .16em
(`.sname` section, 702), 8/8.5px 600-weight (plate, palette, pack, plan
headers). Casing is uniformly UPPER, but size and weight are not governed.

**T4 — ad-hoc font-weight (cosmetic).** DESIGN's type tokens specify no weight;
the workbench applies 600 to ~15 chrome labels (plate h1:38, wb-jump:67,
palette-title:84, pack-instance-name:153, plan-seg-verb:878, wb-chip:661,
sname:702, plan-head h3:855…) and 700 to `.wb-ro-word` (534) and
`.wb-steps-num` (898). The lib uses 500 only, on the step label (mod-ui.css:1856).

---

## 4. Card anatomy

**Shared shell (the good baseline):** control (`.mui-control`), visualizer
(`.mui-viz`/`.wb-viz`), and step (`.mui-step`) all use border `1px --mui-line`,
radius `--mui-r-card` (7px), padding `10px 12px`, and the same `.wb-rz`
dot-matrix resize corner (mod-workbench:236). Selected/hover states are
consistent: `.mui-chrome` action cluster reveals on hover top-right across all
three (mod-ui.css:262, 1550, 1864).

**A1 — three identity marks, no on-face teaching (breaks-comprehension).**
Header-left identity is: **round** accent dot (control, `.mui-ring-btn`,
mod-ui.css:237), **nothing** (visualizer — "lens, no identity", by contract),
**square** accent dot (step, `.mui-step-dot`, 1849). This is spec-intentional
(lens vs verb families) but a fresh user meets three different header shapes and
must reverse-engineer the taxonomy from them.

**A2 — the visualizer shell exists twice (erodes-trust).** `.mui-viz` (lib,
mod-ui.css:1515, head `.mui-viz-head`/`.mui-viz-title` at 9px) and `.wb-viz`
(workbench, mod-workbench:261, head `.wb-viz-head` at 10px) are two
implementations of the same object with divergent head type and structure
(`.wb-viz` adds the off-contract state badge). Two code paths, two drifting
looks.

**A3 — per-size info-hiding is bespoke per lens (erodes-trust).** Each
visualizer invents its own `sz-sm`/`sz-xs` `display:none` rules at different
thresholds: levels name hides at **xs** (352), bandings label at **sm** (418),
window label at **xs** / bite at **sm** (469), score words at **sm** (514), trim
name/foot at **xs/sm** (617). There is no shared "at size S, drop X" rule, so
resize behavior — the goal doc's named gap — reads as undesigned per part.

---

## 5. Color

**Co1 — the accent chain is intact for controls (the one consistent system).**
control accent → wire stroke (`config().accent`, mod-workbench:2428) → input dot
`--accent` (2463) → compiler card accent (3744) → plan-seg sample `--sc`
tint (4070–4077). A dial's hue really does travel board→wire→jack→card→plan.
Keep this; it is the model the rest should follow.

**Co2 — the chain breaks at the step class (erodes-trust).** Steps use one fixed
`STEP_ACCENT = '#3f78df'` (mod-workbench:1952) for **every** step instance
(1966), and the plan's step/DECIDE segments reuse it (3999). So two different
steps are the same blue while every control owns a distinct hue. Spec-intentional
(steps are a class, not per-instance identities) but the "each part gets a hue"
promise silently stops, with nothing marking the boundary.

**Co3 — two cable-color systems (cosmetic/erodes-trust).** Signal wires are
accent-colored (2428); artifact wires are forced ink with `!important`
(`.wire--artifact .wire-vis`, mod-workbench:815) and never accent. An artifact
cable between two colored steps is a neutral ink line beside colored signal
cables — a second, undeclared color rule.

**Co4 — yellow means two things (cosmetic).** DESIGN.md reserves `--mui-yellow`
for "a rare secondary state mark ONLY." The workbench spends it on the window
**conflict seam** (496) and, unrelated, the **silent-member tooltip** text
(`.wb-mtip.silent`, 654). Two meanings for the one reserved accent.

---

## 6. State communication

**S1 — "off / empty / nothing" has ≥5 spellings (breaks-comprehension).**
switch card pill `OFF` (3537) · switch readout-lens headline `—` em-dash (5778) ·
revise pill `OFF` (3561) · viz badge `EMPTY · WIRE INPUT` (4655) · window badge
`CONFLICT` (4658). One semantic ("there is nothing / it is off"), five renderings.

**S2 — switch off contradicts itself (erodes-trust).** The same switch reads
`OFF` on its compiler card (3537) and `—` in the readout visualizer (5778).

**S3 — wired/unwired shown three redundant ways (cosmetic/erodes-trust).** Jack
fills accent when connected (mod-ui.css:321) **and** the viz slot label goes
faint-ink (`.mui-rail-slot.is-unwired`, mod-ui.css:1625) **and** the viz badge
prints `CONNECTED`/`EMPTY` (4655). Three channels for one bit; the badge is the
redundant one.

**S4 — run-posture scattered across four widgets (breaks-comprehension).** "How
will this run" is expressed by: the plate `.wb-status` `PROMPT PREVIEW` strong +
dot (mod-workbench:56–62), the mod-level `FAST ◄──► PRECISE` lever
(`.wb-lever[data-pos]`, 769), the per-control **fidelity foot chips**
(`ONE PASS · IN STAGES · AUTO`, mod-ui.css:1106), and the plan's AUTO/CALLS
posture. Four visual families, no shared "auto/manual/fidelity" grammar — this
is the mechanism behind the goal doc's "PLAN / Auto Parts Run feels like UI
appearing and disappearing."

---

## Notes for Stream 4 (grammar spec) — do not build here

- The jack glyph code (J1/J3) is the highest-value **design** decision: either
  teach the 4-glyph payload language on the face, or collapse it. It is not a
  bug to "fix" in code.
- Kill or unify the chip zoo (C1–C5) and the "PREVIEW" filler (C2) against one
  chip taxonomy: readout vs toggle vs badge must look different.
- Adopt one type scale — the sanctioned 9/10/11/12/13 — and delete the sub-9px
  ladder (T1/T2). The gallery already proves the discipline is possible.
- One state lexicon (S1/S2): pick a single word each for off / empty / unwired /
  conflict and use it everywhere.
- The control accent chain (Co1) is the template; decide consciously where it
  stops (steps, artifacts) and mark that boundary (Co2/Co3).
