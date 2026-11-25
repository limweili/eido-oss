# ADR 0022: Mods As The Universal Prompt Surface

Status: superseded by ADR 0030

ADR 0030 retains connection-scoped application and frozen template stamps, but
replaces this ADR's control workbench, prompt buckets, expanded editor, and built-in
Intent-template decisions. The rest of this record is historical context.

Decided in the mod-infrastructure session (2026-07-13) and sharpened in the follow-up
grilling session (2026-07-14). Builds on ADR 0017 (context contracts — mods contribute
via the modifies relation) and ADR 0015 (mods are never compacted).

## Context

Everything Eido sends to a model is ultimately a prompt. The current Mod card already
proves the pattern in miniature: visual controls (sliders, toggles, choices) plus a bit
of user-written text compile deterministically into prompt lines. But the pattern is
frozen in three ways:

- The control catalog is a closed union (slider, range, toggle, choice) with switches in
  the card UI and in `applyMods`; adding a control kind means editing several files.
- Every control is forced into one emission shape — a 0–10 "approach intensity" line.
  The `context / constraints / approach / output` targets exist in `applyMods` but
  nothing can populate them, and all prompt wording lives in the compiler, not the mod.
- There is exactly one mod archetype (`emptyMod()` hardcodes "Idea pressure"); there is
  no notion of a reusable mod, so no path to a library or marketplace.

Meanwhile, features that shape *how* AI thinks keep landing as bespoke card chrome. The
intent signal (Hold / Probe / Test / Crystallize) is a badge on every card, a store
action, four compiler injection points, provenance snapshots, and its own log event
type — a whole subsystem for what is, semantically, one choice control that emits one
directive line.

## Decision

**A Mod is a declarative bundle of UI controls plus user text that compiles to prompt
text. It is data, never code.** Anything that bends or shapes thinking — beyond the core
thought cards (note, Ask AI, conversation) and their structural relatives (result,
group, title) — ships as a mod, not as new card chrome, card fields, or compiler
branches.

The system has three layers with three owners (the Lego model):

| Layer | Owner | Holds | Lives |
| --- | --- | --- | --- |
| **Control primitive** | Engine (code) | A control kind's fixed emission mechanic and its preset meaning prompt | Shipped in the repo; interchangeable via registries |
| **Mod template** | Creator | Which primitives, arranged how, plus the creator-written meaning prompt per control | The app-level Mod library, across boards |
| **Mod instance** | User | A stamped self-contained copy on a mod card: values and relabels, local to the board | The board save only — never written back to the template |

Concretely:

- **Open, interchangeable primitive catalog.** Every control is
  `{ id, label, kind, value, …kind-specific config }`. One renderer registry on the
  canvas, one emitter registry in the brain (toolcraft-style): adding or retiring a
  control kind touches those two registries and the type union, nothing else. The v1
  set: slider, range, toggle, choice, segmented buttons, multi-select tags, text,
  textarea, number stepper, and XY pad.
- **The engine owns each primitive's mechanics; the creator owns its meaning.** A
  slider always speaks fixed 0–10 intensity numbers; a toggle always means "include
  this prompt or not"; an XY pad always turns the coordinate into per-axis
  intensity/bias. The creator writes the *meaning prompt* — what the control tunes,
  what the toggle includes, what each axis means — starting from a preset meaning each
  primitive ships with. Sliders support both a single meaning the engine scales and
  optional creator-written per-range meanings, from day one.
- **Controls own their emission target.** Each control may declare which
  compiled-instruction section its lines land in (approach, output, constraints,
  context — the existing `applyMods` buckets). `applyMods` is the single emission
  engine; the compiler stops owning mod wording.
- **The prompt is always visible.** Hovering a control on a mod card shows a tooltip
  with the exact prompt it currently emits; the Mod editor shows a live preview of
  everything the mod emits as it is built.
- **Two modes, one card.** On the canvas the mod card is *use mode*: move values, flip
  toggles, relabel controls — light DOM, already proven, and the detail bands
  (ADR 0019) keep many mods cheap at low zoom. Building happens in the **Mod editor**,
  an expanded editor over the card (Reading-zoom pattern): add/remove/reorder
  primitives, write meaning prompts, watch the live preview. Meaning prompts are
  editor-territory; values and labels are card-territory.
- **The Mod library is app-level and stores templates only.** "Save to library"
  promotes a mod; "new mod from library" stamps a frozen, self-contained copy onto the
  board with fresh ids. Template edits affect future stamps only; instance
  customizations are never saved back. Boards therefore never depend on the library —
  saves stay portable, and a marketplace is just sharing template JSON. Built-in
  templates ship as data in the repo. (Library management UI beyond save/stamp,
  versioning, and marketplace are deferred; the data shape is decided now.)
  The source template/version and source-to-instance identity map are immutable
  stamp-time provenance, not a mirror of the instance's editable current payload:
  adding, removing, or reordering controls after stamping never rewrites that map.
- **A mod applies to whatever it is connected to.** Wired to an Ask, it shapes that
  run; wired to a conversation card, it guides the whole room; wired to a
  participant's source card, it shapes that participant's turns. Scope is the
  connection, not a mod property.
- **The intent signal is removed entirely and re-homed as a built-in mod.** "Intent"
  becomes a library template: one choice control with options Hold / Probe / Test /
  Crystallize, each carrying its existing directive as its meaning prompt, unselected
  (and silent) until the user picks. The per-card badge, `setCardIntentSignal`, the
  `## INTENT SIGNAL` / `## ROOM INTENT SIGNAL` / `## YOUR INTENT SIGNAL` sections, the
  per-entry `(Intent: …)` suffixes, group-digest intent lines, and the
  `intent.changed` log event type are deleted. Loaders strip legacy intent fields and
  events silently; no backwards compatibility is kept, and a one-time "Source changed"
  blip on old boards is accepted. A plain Ask with no Intent mod sends no intent
  language at all — prompts contain only what the user deliberately wired in.
- **User-facing words**: Mod, Mod editor, Mod library. Primitive / template / instance
  stay code-side vocabulary.

Mods keep their existing graph semantics unchanged: attached with the modifies relation
per the mod context contract (ADR 0017), never compacted (ADR 0015), applied values
recorded in run provenance (ADR 0008).

## Considered Options

- Chosen: three-layer model — engine primitives with fixed mechanics, creator-authored
  templates in an app-level library, frozen stamped instances on boards.
- Not chosen: mods as code plugins (functions or components registered at runtime) —
  breaks local-first save portability, opens a sandboxing problem, and contradicts the
  thesis that a mod *is* a prompt.
- Not chosen: linked instances that update when their template changes — saves would
  depend on the library, user overrides need merge rules, and a deleted template would
  break boards.
- Not chosen: fully engine-written prompt lines with no creator override — kills the
  prompt-engineering thesis; and fully free-form emission with no fixed mechanics —
  loses the standardized, trustworthy engine layer.
- Not chosen: per-dial rule machinery (`ModRule`/`ModPredicate`) — already tried and
  removed; rules keyed to control ids went stale on relabel. Meaning prompts live on
  the control they describe, so they rename with it.
- Not chosen: keeping intent as card chrome alongside the mod version, or preserving
  legacy intent fields inert — two surfaces for one concept, and dead schema forever;
  backwards compatibility was explicitly waived.

## Consequences

- Product: users compose their own thinking instruments — any mix of controls and text
  that compiles to a prompt. Intent moves from a per-card obligation to an opt-in
  instrument wired where it matters. The library seam is where per-user
  customization, sharing, and eventually a marketplace grow.
- Engineering: `applyMods` becomes the single emission engine reading control meaning
  prompts; new shaping features are data (a built-in template), not cross-layer code.
  Control kinds are grep-verifiable in two registries. The intent subsystem (types,
  store action, log event, four compiler injection points, badge UI) is deleted
  outright.
- Trade-off: old boards lose their intent signals (stripped at load) and may report
  "Source changed" once; golden compiler tests and provenance snapshots change once,
  deliberately. The Mod editor is a new UI surface to build and maintain.
