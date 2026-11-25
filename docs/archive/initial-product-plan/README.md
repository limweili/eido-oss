# Eido Initial Product Plan

This is archived historical planning context from the transition where v3 became the active Eido app. It is useful for intent archaeology, but current behavior lives in `src/` and the active foundation docs under `docs/foundations/`.

> **Where ideas find their form.** This plan was the first prototype plan that tried to be *true to the whole idea*, not just the smallest slice of it. It was **tight on concepts and generous on features**.

## The reframe that drives v3

Earlier prototypes (v1, v2) optimised for *minimum*. They were nearly the same app, and the comparison between them proved that the hard part was never "which small thing to build" — it was **which ideas are actually load-bearing**.

So v3 flips the discipline:

- **Code is cheap to generate, but features are expensive to carry.** Every control adds UI weight, state, and review burden.
- **Concepts are expensive.** A wrong concept poisons every feature built on it. The scarce resource is *deciding what Eido actually is*.

Therefore: **we are strict about the handful of concepts in [`00-concepts.md`](00-concepts.md), and disciplined about everything else.** When in doubt, build only the next smallest thing that tests the next concept — never a feature pile.

## What we settled from the v1/v2 debate

| Question | Settled answer |
|---|---|
| v1 or v2 as the base? | Neither — v3 is fresh. Take v2's *product gravity* (plain language, "feels like thinking") and v1's *machinery rigour* (the context compiler + run engine). |
| Strong/weak only, or add tension? | **Tension (helps / pushes-against) is non-negotiable.** Magnitude (strong/weak) is a refinement. If anything is cut, magnitude goes first, tension never. |
| Show the user what AI used? | **Required, and it's the real compiled instruction — not a "used 4 cards" tally.** Transparency is the trust mechanism and the anti-slop mechanism. |
| Mods vs chaining? | **Mods come first.** They attack the user's #1 pain (re-giving AI context) by turning taste/constraints into reusable controls. Chaining/playback is a later, richer view. |
| Can the single-shot loop prove "thinking faster"? | **No, not alone.** The honest test is *run + show-the-context + Mod tuning + pick-a-version*. v3 is scoped to that, not to one AI call. |

## The six concepts (the only things we're strict about)

1. **One graph, three views** — one property graph is the truth; canvas, compiler, and run engine are just projections of it.
2. **The connection carries the meaning — including tension** — connections are weighted, directed, and *signed* (helps / pushes-against). Never decoration.
3. **The compiler is the product, and it shows its work** — deterministic, explainable assembly of connected thought into a structured instruction the user can always see.
4. **Crystallise once, reuse everywhere (Mod)** — saved, reusable modifiers: numeric controls, ranges, toggles, and JSON-shaped prompt rules that alter how context is used. Reuse, not regeneration.
5. **The idea is never final, only outputs are** — outputs are *versioned, traceable artifacts you pick between*, not disposable chat. Iteration is itself context.
6. **Acceleration, not replacement** — it must *feel like thinking*, not like operating a graph. Aggressive simplicity in everything seen or heard.

Full detail, and the "what we will not compromise" for each, is in [`00-concepts.md`](00-concepts.md).

## Scope posture

- **In v3 (build to prove the concepts):** notes, weighted+signed connections, the visible context compiler, Mod cards with controls, versioned outputs you pick between, single AI runs, and the first crude Mod tuning + variation.
- **Leave room for (designed-in, built when pulled):** line-level connections, Thought containers (bounded contexts), rich text, run-a-path / personas / debate playback, a timeline view, sync, native packaging, a richer canvas (tldraw).
- **Not yet (no design debt taken):** accounts, cloud, multiplayer, mobile polish, semantic/embedding ranking until the deterministic compiler visibly falls short.

Nothing in "leave room for" requires a reshape — the [data model](02-data-model.md) already accommodates each.

## How to read the plan

| Doc | What it commits to |
|---|---|
| [00-concepts.md](00-concepts.md) | **The tight core.** The six concepts and what we will not compromise. Read first. |
| [01-architecture-and-stack.md](01-architecture-and-stack.md) | One graph / three views, the canvas-agnostic graph core, and the stack (CTO calls). |
| [02-data-model.md](02-data-model.md) | The property graph: cards, blocks, connections, mods, outputs+versions, runs. |
| [03-the-brain.md](03-the-brain.md) | The compiler (semantic view) + the run engine (execution view) — the part Eido lives or dies on. |
| [04-canvas-language-and-feel.md](04-canvas-language-and-feel.md) | The wireframe mapped to UI, the interactions, and the aggressive-simplicity rules. |
| [05-build-path-and-open-questions.md](05-build-path-and-open-questions.md) | Concept-validating build slices, and the decisions still genuinely open. |

## Status

**Archived status.** The app now lives at the repository root. One graph, three views; weighted+signed connections; the visible context compiler ("show what AI used"); Mod cards that tune the instruction; versioned outputs you pick between; single AI runs + variations over OpenRouter. Grounded in [`research/01-technology-landscape`](../../../research/01-technology-landscape/) (AI context engine as the heart) and [`research/02-source-studies`](../../../research/02-source-studies/) (one graph, three views; authored-vs-run state; line anchors; output provenance).
