# 00 — The Concepts (read first)

> This is the one strict document. Everything else in the plan can flex; these six concepts cannot. A feature that violates one of these is wrong even if it's easy to build. A feature that honours all six is only worth building when it is the next smallest test of a concept.

Each concept below says: **what it is**, **why it's load-bearing** (tied to your own words, the wireframe, and the research), and **what we will not compromise**.

---

## Concept 1 — One graph, three views

**What it is.** Everything in Eido — every note, line, connection, Mod, output, and run — is one property graph. The board you look at, the context the AI receives, and the runs that produce outputs are all *projections* of that one graph. Not three apps glued together.

**Why it's load-bearing.** Both research passes converge on this. Research 2 states it as the architectural spine: *"The canvas should render the graph. It should not be the graph."* It's what lets a connection you draw on the canvas instantly *mean something* to the AI, with no sync step. It is the difference between Eido and "a whiteboard with an AI button."

**Will not compromise.**
- One source of truth. The canvas never owns meaning; it only displays it.
- The graph core (data + compiler + run engine) is **decoupled from the canvas library**, so we can swap how it's drawn (React Flow now, something richer later) without rebuilding the product.

---

## Concept 2 — The connection carries the meaning, and meaning includes tension

**What it is.** A connection is not a line; it is a typed relationship with **strength** (strong / weak), **direction** (this feeds that), and **polarity** — *helps* or *pushes against*. "Pushes against" is the constraint: the thing the output must respect or avoid.

**Why it's load-bearing.** This is your own sharpest claim: *"Negative connections are a tool. It creates constraints in a world where you can dream up any idea with AI."* The wireframe draws it directly — thick "strong" arrows, dashed "weak" arrows, directionality. And it's the only thing that makes the AI follow *shaped intent* rather than just *connected notes*. Strong/weak alone, in a small board, barely changes an output. A constraint changes it visibly. So tension is the differentiator, not magnitude.

**Will not compromise.**
- Connections are semantic from day one — never decoration.
- **"Pushes against" ships early**, with the first AI run, not "later."
- A connection can eventually attach to a whole card *or a specific line inside it* (the wireframe shows arrows leaving individual lines). v3 starts card-level; line IDs are designed-for, but we do not pretend a textarea gives perfect line identity until the editor proves it.

---

## Concept 3 — The compiler is the product, and it shows its work

**What it is.** Given a focus (an "Ask AI" card), Eido deterministically walks the connections into it and assembles a **structured instruction**: important context first, lighter context next, constraints called out separately, then the task. The user can always open it and see *the exact thing that was sent*.

**Why it's load-bearing.** Research 1 calls the AI context engine *"the heart of Eido"*; research 2 calls the context compiler *"likely Eido's core technical product… the difference between Eido and a canvas with AI buttons."* And transparency is not a nicety — it's how we beat the kill-risk you named: *"AI just generates a bunch of shit I'll now have to review."* If you can *see* your own connections become the instruction, the output stops being a black box you audit and starts being an extension of your thinking.

**Will not compromise.**
- The compiler is **deterministic and explainable** — same graph, same context. No hidden magic until determinism visibly falls short.
- **"Show me what AI used" is required**, and it shows the *real compiled instruction*, not a count of cards.
- Constraints (pushes-against) appear as their own section, never blended into context.

---

## Concept 4 — Crystallise once, reuse everywhere (Mod)

**What it is.** A **Mod** is not just another text card. It is a reusable modifier: sliders, ranges, toggles, and JSON-shaped prompt rules that change how connected context is interpreted. A Mod might set how strict the answer should be, how much novelty to allow, how strongly to obey constraints, or which lens/persona/rubric to apply.

**Why it's load-bearing.** This attacks your #1 stated pain head-on: *"It's so much work to give AI all context… each time we work on something it'll miss connections."* Your own answer is in the idea doc: *"Create modular thought components. Think once, solidify and then use everywhere. Crystallises instruction or taste."* The wireframe draws it as the `MOD` circle attached by a coil. Reuse — not regenerating context every session — is what makes Eido feel *effortless* instead of exhausting.

**Will not compromise.**
- A Mod is a **core concept present early**, even in crude form (one or two sliders that alter the compiled instruction) — not a "v4 nice-to-have."
- A Mod *modifies* a run; it is a distinct kind of relationship from a note *feeding* a run (the wireframe's coil vs. plain arrow).
- A Mod stores structured settings, not only prose. Text can explain the Mod, but numeric/ranged controls are the primary interface.

---

## Concept 5 — The idea is never final; only outputs are

**What it is.** Every run produces a **versioned output** that remembers what made it: the connections used and the exact instruction compiled. Versions stack (the wireframe's `v3` pile); the top is the chosen one; you **accept or reject** and run again. The evolution of the idea is recorded, because the passage of iteration is itself context.

**Why it's load-bearing.** Your words: *"The idea is never final. Only the final output is final… Reaching it is the whole point,"* and *"ideas have a sense of timeline transformation… the evolution and passage of iteration in itself is context."* Research 2 is blunt: *"Generated output must be a graph object. Otherwise Eido loses provenance,"* and reads the wireframe's `v3` as proof outputs are versioned artifacts. This is also the **anti-over-review mechanism**: you don't get a wall of text to weed — you get versions to *pick between*. Choosing is lighter than auditing.

**Will not compromise.**
- Outputs are graph objects with lineage, never disposable chat.
- Generating variations must reduce review load (pick one), not increase it (read ten). Variation UI is a stack you choose from, not a dump.

---

## Concept 6 — Acceleration, not replacement; it must feel like thinking

**What it is.** Eido amplifies the user; it never replaces their intent. The whole interface, language, and rhythm must feel like *creating*, not like operating a graph or filling a workflow form.

**Why it's load-bearing.** Your line: *"I need to accelerate thought, not replace it… Effortless means precise thought generation; it assists connections and generation but never replaces the intent."* And the kill-list is explicit: *too complex; over-generation where reviewing exceeds creating; "easier to just use pen and paper."* This is also why v2's language discipline was right and v1's engineer-speak was a risk.

**Will not compromise.**
- No graph/workflow/compiler/execution jargon ever reaches the user — see [04](04-canvas-language-and-feel.md). (Internals may use precise words; the user never does.)
- Instant local feedback for everything except the AI call itself.
- The smell test for any feature: **does this accelerate creating, or add to reviewing?** If it adds review load without paying it back, it's wrong — no matter how clever.

---

## How the concepts relate to the rest of the plan

- The **graph** (Concept 1) is specified in [02-data-model.md](02-data-model.md).
- The **connection** (Concept 2), **compiler** (Concept 3), **Mod** (Concept 4), and **versioned outputs** (Concept 5) are realised in [03-the-brain.md](03-the-brain.md) and the [data model](02-data-model.md).
- **Feel** (Concept 6) governs [04-canvas-language-and-feel.md](04-canvas-language-and-feel.md).
- The [build path](05-build-path-and-open-questions.md) is ordered so each slice *proves one concept* before the next is built.

If a future decision pits "more features" against one of these six, the concept wins. That is the entire point of v3.
