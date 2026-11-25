# 05 — Build Path & Open Questions

The build order is not about proving we can generate more code. It is about **proving one concept before stacking the next on top of it**. Each slice ends playable and answers a specific question. If a slice's concept fails, we learn it before we've built on the failure.

> No code yet. This is the intended sequence.

## The build path (concept-validating slices)

### Slice A — The board that remembers
Notes on an infinite board; pan/zoom/drag; type in cards; auto-save to the browser.
- **Proves:** capture feels effortless and local-first holds.
- **Playable:** write notes, refresh, they're still there.

### Slice B — Connections that mean something
Draw connections; set **strong/weak** and **helps/pushes-against**; directed; rendered so meaning is visible (thick/thin/dashed, pushes-against marked).
- **Proves (Concept 2):** shaping intent on the board is natural, and tension is expressible.
- **Playable:** three notes, connected, one marked "pushes against", one weak; refresh-safe.

### Slice C — The brain, made visible  ← THE PIVOT
Ask-AI card → the compiler → **"Show what AI used"** (real compiled instruction) → result card backed by one version, with a run record storing what was used.
- **Proves (Concept 3, the make-or-break):** does seeing my own connections become the instruction feel like *thinking*, and does "pushes against" visibly change the output? This is where we first learn if Eido is real. Gut-check with the user immediately after.
- **Playable:** connect notes (incl. a constraint) into Ask AI, Run, watch AI generate using them, open "what AI used" and recognise your own thinking.

### Slice D — Crystallise & tune (Mod)
Create a **Mod** with one or two controls (for example Novelty and Constraint strictness); connect it to an Ask-AI run to shape the compiled instruction (`role: 'modifies'`).
- **Proves (Concept 4):** does tuning reusable prompt modifiers reduce the felt cost of giving AI taste/context every time?
- **Playable:** create one Mod once; adjust its sliders; reuse it across two different Ask-AI runs without rewriting prompt text.

### Slice E — Versions you pick
**Make variations** → a version stack on the result; flip and **keep one**; each version remembers its run.
- **Proves (Concept 5):** does amplifying output by *choosing* (not auditing a wall) feel like acceleration rather than slop?
- **Playable:** generate three versions of a result, keep the best, see which connections made it.

### Slice F — Playback (only after C–E feel good)
Series chaining (result feeds the next Ask-AI), then parallel personas, then the debate-bounce loop.
- **Proves:** the graph as a spec for orchestration — and starts answering *"how is this different from spawning subagents?"*
- **Playable:** Notes → summarise → critique, run in order; later, personas in parallel.

### Leave room (designed-for, build when pulled by real use)
Thought containers (frames), live line-level connections, rich text, a timeline/history view, sync, native packaging, the **tldraw graduation**. None requires a reshape.

**Stop discipline:** after each slice, stop and feel it before building the next. The point is learning what's load-bearing, not finishing Eido.

## What to capture while playing

- Does shaping connections *before* running feel natural, or like extra work?
- Does "what AI used" build trust — does the output feel like *you*?
- Does "pushes against" visibly change results in a way worth doing?
- Does Mod tuning reduce the felt cost of giving context?
- Does picking a version feel lighter than reviewing AI output normally does?
- The first 3–5 *"I wish I could…"* moments — ranked by genuine pull.

## Open questions (decisions still genuinely open)

| Question | Current lean | Decide when |
|---|---|---|
| **Final user-facing name for "Mod"** | Use **Mod** for now because the wireframe already names it. Alternatives: lens, dial, recipe. | Before Slice D ships copy. |
| **When do line-level connections go live?** | The model has block records, but stable line identity is not real until the editor preserves blocks across edits. | After Slice C feedback. |
| **When does the canvas graduate to tldraw?** | When line anchors + Thought frames + version stacks start fighting React Flow. The graph core survives the swap. | When two of those three are actively painful. |
| **How opinionated does the compiler get?** | Stay deterministic/explainable. Add embedding ranking only when determinism visibly produces bad context. | When users say "it missed the obvious connection." |
| **Model configuration** | OpenRouter-only, following `https://openrouter.ai/docs/quickstart`; local key + model slug. | Revisit only if OpenRouter blocks the local prototype. |
| **What is an output *for* / when is it "done"?** | The stop-condition is the user's to declare. Make outputs first-class, **keepable**, and exportable (copy / turn-into-note now; richer export later) so a finished idea can leave Eido. | As soon as users want to *use* an output, not just read it. |
| **Thought containers: frame, saved query, or section?** | Start as a visual frame (`groupId`); revisit once boards get busy. | When a board becomes hard to read. |

## The honest risk we're watching

The deepest risk isn't a missing feature — it's that **shaping-then-running still feels like generate-and-review**. v3's defence is the quartet C+D+E: *see what was used* (trust), *tune context with Mods* (less context cost), *pick a version* (less review cost). If, after those, it still feels like a fancy prompt box, that's the most valuable thing v3 can teach us — and it points at line-level connection and richer playback as the next bets, not at polishing the single shot.
