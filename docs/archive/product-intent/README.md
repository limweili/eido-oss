# Archived Eido Product Intent

> **Archived 2026-06-21.** This is product archaeology, not the current source
> of truth. Use `CONTEXT.md`, accepted ADRs, foundation docs, and current source
> for active work.

This point-in-time synthesis was derived from the repository, the original idea
artifact, and a private legacy browser-development save. The save itself is not
stored in Git and must not be used as a fixture or packaged Profile authority.

Last source scan: 2026-06-21. The `Eido Main Idea` board was last updated at `2026-06-21T12:03:22.118Z`.

## Short Version

Eido is a spatial thinking tool for intent that is not finished yet.

The core bet is not "notes plus AI" and not "a whiteboard with a chatbot." The stronger version of Eido is an Intent Graph: a canvas where fragments of intent become cards, cards carry a declared posture, connections carry weight and valence, and AI reads the graph as context instead of relying on a prompt the user has to re-explain every time.

The most current product direction is:

- Treat intent as the first-class asset, not documents, notes, tasks, or chat turns.
- Make the graph the prompt. The user should build context spatially and relationally, not translate their brain into a single request.
- Keep the user in control of direction, taste, contradiction, and correction.
- Use AI to accelerate thought, surface structure, and generate from context, without replacing the user's intent.
- Favor restraint over helpfulness. When uncertain, build the simpler version that preserves user agency.

## Product Vision

Eido starts from a very specific pain: intense thought changes faster than conventional tools can capture it. By the time a user has written a clean prompt or organized a note, the idea may already have moved. Eido is meant to preserve the live shape of thought, not just the polished text left behind.

The original product language frames Eido as a place where ideas find their form. The newer, sharper product language says that the thing finding form is intent:

- Intent can be half-formed, contradictory, still-moving, and not yet ready to become a document.
- Intent has direction, weight, constraints, taste, and negative space.
- Intent can be preserved, explored, tested, and crystallized without losing its earlier form.
- Intent can compound into a private asset that other AI tools can consult.

The important shift is from "thinking space" to "Intent Graph." A thinking space is evocative but broad. An Intent Graph is a product architecture: cards are intent fragments, connections express influence, and the graph becomes a durable model of what the user cares about.

The strongest current one-sentence pitch is:

> Eido is a place where your intent lives as cards on a graph, gets shaped by four verbs, and compounds into a personal asset that AI traverses instead of a prompt you re-explain.

That wording should not be treated as final marketing copy, but it is the clearest product thesis in the save file.

## Product Description

Eido is built for the moment before a thought becomes a sentence.

The user drops fragments onto a canvas: a sentence, a feeling, a constraint, a question, a taste, a prior decision, a piece of source material, or a half-formed direction. Those fragments become cards. The user arranges them spatially and draws connections between them. The connections are not just links; they are influence. A connection can help, constrain, push against, modify, or carry different strengths.

The AI should read this whole arrangement. It should know which context is central, which context is peripheral, which context is a guardrail, and which context is unresolved. The output should feel less like the model answered an isolated prompt and more like it understood the current shape of the user's thinking.

Eido is not primarily:

- a note-taking app, because notes are usually storage for thoughts that already exist;
- a second brain, because retrieval is less important than transformation;
- a whiteboard, because diagramming is not the point;
- a chatbot, because chat makes the user compress context into a turn;
- a productivity app, because output volume is not the promise;
- a project management tool, because completion states are not the core grammar.

Eido is closer to a workbench for thought. The canvas is not a decorative UI around AI. The canvas is the thinking surface. If the AI disappeared, the canvas should still help the user think. If the canvas disappeared, the product would collapse into a generic chatbot.

## Core Product Grammar

### Cards

A card is the user-facing object on the canvas. It can be a note, Ask AI card, result, mod, group, conversation, or title. Internally the v3 app still uses React Flow node terminology at the canvas boundary, but product language should say card.

Cards are not just text containers. A card can represent:

- a raw thought;
- source material;
- an influence;
- a question;
- an AI instruction;
- a generated result;
- a reusable modifier;
- a group of related material;
- a conversation room;
- a spatial label.

### Connections

Connections are meaning-bearing, directed relationships between cards. They are how the user's context becomes structured enough for AI to traverse.

The repo model currently supports:

- `strength`: `strong` or `weak`;
- `polarity`: `helps` or `pushesAgainst`;
- `role`: `feeds` or `modifies`;
- optional ordering and group-mode metadata.

Product-wise, this matters because positive and negative context are both valuable. A negative connection is not noise. It is a constraint. In an AI product, constraints are often where taste lives.

### The Four Verbs

The strongest current vision centers on four intent operations:

- Hold: preserve without judging.
- Probe: explore adjacent possibilities and hidden connections.
- Test: pressure-test, find flaws, and steelman opposition.
- Crystallize: structure, distill, and commit into a usable artifact or decision.

These are not just modes or labels. They are the product's core interface for communicating intent to AI.

The v3 source already contains these as `IntentSignal` values in `src/graph/intent.ts`, with AI directives for each signal. That means the product thesis is no longer just speculative; it is partly represented in the current data model and compiler.

### Outputs

AI output should return to the graph as material the user can shape. The output is not necessarily final. It can become another card, receive follow-up questions, be connected to other context, be rejected, be tested, or be crystallized into something more durable.

This is important because the idea is never final. Only a particular artifact may be final.

## Product Strategy

The clearest strategy note says that, in the age of AI, the ultimate thing a human stays in control of is communicating intent, direction, and taste.

That is the narrow problem Eido should own:

- shape ideas;
- communicate intent;
- crystallize taste;
- preserve the user's agency as AI systems become more capable.

Eido should not chase every new AI technique because the technique itself is not the moat. Specialized AI products will always have sharper local techniques in narrow domains. Eido's opportunity is upstream: it helps the user form, maintain, and expose intent before downstream tools act.

That implies a strong product filter:

- If a feature helps the user express, preserve, inspect, or distribute intent, it may belong.
- If a feature simply makes the app feel more like a general productivity suite, it is suspect.
- If a feature creates more AI output for the user to review without improving intent fidelity, it probably violates the product.
- If a feature makes the graph more legible to the user and to AI, it is strategically relevant.

## Current Product Bets

The latest ranked product-bets output puts the major bets in this order.

### 1. Intent API / MCP / Thought Bubble

This is framed as the company-level bet.

If Eido only works inside its own canvas, it is a better thinking tool. If Eido becomes the place where a user's intent lives and other AI tools can query it, it becomes infrastructure.

Concrete version:

- Expose a selected group or graph slice as a structured intent object.
- Let coding agents, writing agents, analytics agents, or other tools ask Eido for the user's relevant intent.
- Keep access read-only at first.
- Let the user choose what gets exposed, at what resolution, and under what terms.

This directly answers the pain of being "farmed" for intent by AI tools. The alternative product stance is hosting: the user owns the intent graph and grants access deliberately.

### 2. The Structurer

The structurer is the proof that the graph is context.

It should read the graph's shape and surface what the user may not have explicitly named yet:

- unresolved contradictions;
- lonely but load-bearing cards;
- clusters that want to become a decision;
- stale areas that no longer match newer commitments;
- tensions between things marked Test and things marked Crystallize.

This should not feel like a batch job that generates another document. It should feel like an ambient interpretation layer over the canvas.

### 3. Intent Decay / Forgetting

Eido should avoid becoming an infinite junk drawer. Most knowledge tools rot because everything remains at full weight forever. Eido can do better by letting intent fade unless the user reactivates it.

The current strategy suggests different decay behavior by signal:

- Hold decays slowest, because it means preserve.
- Probe decays at a medium rate, because unresolved exploration goes stale.
- Test decays faster, because a test that is not being tested should eventually resolve or fade.
- Crystallize should not decay in the same way, because it represents a committed artifact or decision.

The v3 source already has visual decay code and a timeline/intent log path, so this bet appears partially implemented.

### 4. Strategist Archetype

The strategist is the power-user endgame: a first-class entity or group that maintains long-term product intent, constraints, roadmap logic, business goals, and anti-goals.

The compelling use case is agentic coding. A coding agent should be able to check the product strategy group mid-build and ask: what does this person actually care about here?

This is strategically powerful but risky. It may be too AI-maximalist for some users. It should probably emerge after the simpler Intent API and structurer prove that the graph can hold durable intent.

## Current Build Strategy

The latest build-oriented PRD output says coding agents should assume the product owner will not be in the loop for every decision. That means implementation work should make conservative, well-scoped choices and follow the product philosophy.

The recommended sequence from the saved PRD is:

1. Stabilize bug fixes.
2. Build undo as foundational reversibility.
3. Build the intent signal system.
4. Polish core canvas UX.
5. Improve the AI experience.
6. Add navigation and deep linking.
7. Add intent persistence.
8. Add dependent-node stale propagation.
9. Add intent decay.
10. Add thought timeline playback.

The repo appears to be ahead of parts of that saved PRD. Current v3 source and docs already show:

- card-level intent signals;
- intent directives in the compiler;
- structural undo/redo;
- append-only `intentLog` events;
- visual intent decay;
- timeline playback;
- result follow-ups using frozen provenance;
- conversation cards and conversation results;
- source-change badges;
- group compression;
- local idea workspaces;
- persisted outputs, runs, and provenance.

So future coding work should not blindly treat the PRD as unimplemented. It should check current source first, then use the PRD as intent and acceptance context.

## Current Design Signal

The newest explicit board activity is a small design-inspiration cluster:

- `title_ni3ua0ZW`: "Design Inspiration"
- `note_d20U9Kvm`: "Lines, connections, compartments, grids"

Both are currently marked Hold and have no connections. This looks more like a held design reference than an implementation instruction.

The likely design implication is that the canvas grammar still matters. Eido needs to show structure without becoming diagrammatic. Lines, compartments, and grids may be useful, but they must serve thought-shaping rather than make the product feel like FigJam or Miro.

## User And Market

The strongest early user is not "everyone who takes notes." The strongest user is an AI-heavy founder, strategist, writer, or product thinker whose ideas are nonlinear and whose work depends on preserving taste across many AI interactions.

The save file repeatedly points toward a user who:

- thinks spatially;
- has many competing half-formed theses;
- needs to preserve contradiction rather than resolve it too early;
- wants AI to operate on their wavelength;
- dislikes re-prompting the same context;
- wants to accelerate thought, not outsource it;
- may use other agents and tools that need access to long-term intent.

The clearest wedge is obsession, not collaboration. A single power user should feel after sustained use that going back to flat docs plus stateless AI is unthinkable.

## Anti-Goals

These are important because Eido can easily sprawl.

Do not turn Eido into:

- a generic note app;
- a whiteboard clone;
- a productivity dashboard;
- a task manager;
- a generic AI automation builder;
- a visual design tool;
- a chat app with a canvas attached;
- a document export factory;
- a place where AI creates more review burden than thinking leverage.

Also avoid premature complexity:

- too many signals;
- too many AI modes;
- enterprise collaboration before individual obsession works;
- persona systems before intent graph mechanics work;
- exports before the graph itself proves durable value;
- opaque AI "magic" that makes the user feel less in control.

## Implementation Reality

The active app appears to be the repository root, a React + Vite app using React Flow/Xyflow for the canvas. The architecture docs describe one saved property graph with cards, connections, outputs, runs, and optional intent logs.

Important implementation concepts already visible in source:

- `Card` is the product object; `node` is a React Flow boundary term.
- `Connection` has directed anchors, strength, polarity, and role.
- `IntentSignal` is `hold | probe | test | crystallize`.
- The compiler gathers connected thought, separates important context, weaker context, constraints, modifiers, and intent.
- Results preserve output versions and run provenance.
- Follow-ups use frozen run context rather than recompiling the current board.
- Timeline playback projects board state from intent-log events.
- Visual decay derives opacity from graph activity and intent.

This matters for agents: do not rebuild the conceptual model from scratch. Work with the existing graph, compiler, run, output, and intent-log architecture.

## Agent Guidance

When working on Eido:

- Read product intent before making broad product decisions.
- Prefer user-facing words: card and connection. Use node and edge only at the React Flow boundary.
- Keep intent explicit and inspectable.
- Preserve provenance for generated output.
- Keep AI behavior grounded in connected graph context.
- Make generated output re-enter the graph.
- Prefer small, durable systems over large speculative AI features.
- Build features that make intent easier to express, maintain, inspect, or query.
- Treat "restraint over helpfulness" as a hard design principle.

## Open Questions

These questions remain live:

- What is the minimum useful read-only Intent API?
- What is the first structured intent object another agent should be able to query?
- How should users control resolution: full context, compressed context, source-only, or derived intent?
- How much structuring should be ambient versus user-invoked?
- When does a strategist become a first-class entity rather than just a group?
- How should Eido avoid making users feel like they are being mined for intent?
- Which parts of the latest PRD are already implemented well enough, and which need source-grounded follow-up issues?

## Source Notes

Private saved-board records used for the original synthesis:

| Source | What it contributed |
| --- | --- |
| `docs/archive/product-intent/original-idea.md` | Original seed: Eido as a place where ideas find form, AI reads connected thought, and the user accelerates rather than replaces thinking. |
| `result_rKQz37jE` / `out_HsvBRYwX` / `ver_ybM3FOFP` | Latest full product description from 2026-06-18. |
| `result_WPzUr_ZY` / `out_KW0453yF` / `ver_mJVhJYR1` | Pivoted product description: Intent Graph, four verbs, intent as asset. |
| `note_OmatC9aW` | Explicit product strategy note: own shaping ideas, communicating intent, and crystallizing taste. |
| `result_OVJa55F_` / `out_6PSSHlFj` / `ver_5Bgk8oUe` | Latest ranked product bets from 2026-06-19. |
| `result_R5Kc0JYD` / `out_DtbDuxDX` / `ver_ejxe7TJ1` | Latest coding-agent PRD sequence from 2026-06-19. |
| `note_d20U9Kvm` and `title_ni3ua0ZW` | Newest board touch: design inspiration around lines, connections, compartments, and grids. |

Repo sources checked:

- `README.md`
- `CONTEXT.md`
- `docs/codebase/ARCHITECTURE.md`
- `src/graph/types.ts`
- `src/graph/intent.ts`
- `src/brain/compiler.ts`
