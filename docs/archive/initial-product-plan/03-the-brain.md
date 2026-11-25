# 03 — The Brain (compiler + execution)

This is the part Eido lives or dies on. Two pieces — the **compiler** (semantic view, Concept 3) and the **run engine** (execution view, Concept 5) — plus how **Mods** shape a run (Concept 4) and how OpenRouter is called. Grounded in research 1 ("the AI context engine is the heart") and research 2 ("the context compiler is likely Eido's core IP").

---

## A. The compiler — connected thought → a structured instruction

**Signature:** `gatherConnectedThought(board, askAiCardId): CompiledInstruction`

```ts
type CompiledInstruction = {
  text: string              // the exact thing sent to AI
  usedCardIds: string[]     // for provenance + "show me what AI used"
  usedConnectionIds: string[]
  modIds: string[]
}
```

**Algorithm (deterministic, explainable):**
1. Find connections **into** the Ask-AI card. Default reach: **one hop** for `helps`, with an option to follow strong `helps` chains a second hop (a small constant, so the graph matters without runaway size). `pushesAgainst` is always pulled in directly.
2. For each incoming connection, read the source card's text. Sort by **polarity**, then **strength**:
   - `helps` + `strong` → **Important context**
   - `helps` + `weak` → **Also consider**
   - `pushesAgainst` (any strength) → **Constraints** (must respect / avoid)
3. Apply any **Mod cards** connected with `role: 'modifies'` — see §C. A Mod does not add another note; it transforms the instruction using its control values and rules.
4. Assemble a *structured* instruction, not a blob:

```
You are helping me develop an idea. Treat the context as my own thinking.
Honour the constraints as hard boundaries.

## IMPORTANT CONTEXT (most important first)
- <strong helps note>
- <strong helps note>

## ALSO CONSIDER
- <weak helps note>

## CONSTRAINTS — do not violate
- <pushesAgainst note>

## MODIFIERS APPLIED
- <control name>: <value>
- <rule-derived instruction>

## HOW TO APPROACH IT
- <instructions produced by Mod rules>

## TASK
<the Ask-AI card's own instruction>
```

5. Return the text **and** what was used, so the UI can show *exactly* what was sent.

**Properties we will not give up (Concept 3):**
- **Deterministic** — same graph, same instruction. No embeddings/ranking magic until determinism visibly falls short ([05](05-build-path-and-open-questions.md) open question).
- **Explainable** — `ContextPeek` shows the real compiled text. This is the trust mechanism and the anti-black-box defence against "AI generated a pile I now have to audit."
- **Tension is separate** — constraints are their own section, never mixed into context. This is what makes the output follow *shaped intent*, not just *connected notes*.

**Deferred (designed-for, not built):** embedding similarity, relevance ranking (Personalized PageRank), depth-decay weighting, token-budget tiers, community summaries. The deterministic version is the seed; research 1/05 and research 2/05 describe where it grows.

---

## B. The run engine — single run first, paths later

**`runCard(askAiCardId)`** — the core loop:
1. Open a `RunRecord` (`status: 'running'`).
2. `instruction = gatherConnectedThought(board, askAiCardId)`.
3. Stream an AI completion (§D); append text live into a **new output version** on the connected result card.
4. On finish: mark the version, close the run (`status: 'done'`, store `compiledInstruction`, `usedCardIds`, `producedVersionId`). On error: `failed` + a plain message; the board is untouched.

**`makeVariations(askAiCardId, n)`** — the "autofill for thought" (Concept 5):
- Run the same compiled instruction `n` times (with light variation framing), producing `n` **versions** in the result's stack.
- The user **picks** one (sets `chosenVersionId`) or rejects all and adjusts the board.
- This is your *"drag to copy formula in Excel… auto-branch a thought."* Crucial rule: it must yield a **stack you choose from**, never a wall of text you read — or it becomes the over-generation kill-risk.

**`runPath(startCardId)`** — deferred richer playback (built last, after the above feel good):
- Series chaining: a result feeding a downstream Ask-AI card becomes its context. Topologically ordered, run in sequence.
- Then parallel personas (your *"Marketing Mark / PR Parker… in parallel"*) and the debate-bounce loop (*"bounce between two thoughts"*).
- The engine is structured so these topologies slot in; we do **not** build the workflow UI feel that research 2 warns against. The graph stays the spec; playback is just running it.

**Why this order:** single run + variation + Mod tuning is the honest test of "thinking faster." Multi-node playback is a power feature that answers your own open question (*"how is this different from agent harnesses / subagents?"*) — and that question is only worth answering *after* the core loop earns it.

---

## C. How a Mod shapes a run (Concept 4)

A `mod` card connected to an Ask-AI card with `role: 'modifies'` (the wireframe's coil) is applied differently from a note that `feeds`:

- It does **not** become "context to consider"; it becomes a set of **control values** and **rule-derived instructions**.
- It can alter section weighting (*how much to obey constraints*), style (*terse ↔ expansive*), novelty (*safe ↔ wild*), strictness, audience, or rubric pressure.
- It lands in `## MODIFIERS APPLIED` for transparency, then writes rule-derived lines into `## HOW TO APPROACH IT`, `## CONSTRAINTS`, or output requirements.
- The same Mod can modify many runs across the board (and later, many boards). *Tune once, reuse everywhere.*

First crude version: a Mod is one card with two sliders, for example:

```ts
{
  label: 'Idea pressure',
  controls: [
    { id: 'novelty', label: 'Novelty', kind: 'slider', min: 0, max: 10, step: 1, value: 6 },
    { id: 'strictness', label: 'Constraint strictness', kind: 'slider', min: 0, max: 10, step: 1, value: 8 }
  ],
  rules: [
    { target: 'approach', instruction: 'Novelty level: {{novelty}}/10. Higher means less obvious, more speculative options.' },
    { target: 'constraints', instruction: 'Constraint strictness: {{strictness}}/10. Higher means do not soften pushes-against connections.' }
  ]
}
```

Richer persona / rubric / lens Mods are additive, but they remain structured controls plus rules, not plain text snippets wearing a special hat.

---

## D. OpenRouter model calls

- **Boundary:** `openRouter.ts` exposes one `streamCompletion(instruction, options)` and follows the [OpenRouter quickstart](https://openrouter.ai/docs/quickstart).
- **Request shape:** direct `fetch` to `https://openrouter.ai/api/v1/chat/completions` first, with `Authorization: Bearer <OPENROUTER_API_KEY>`. Optional attribution headers (`HTTP-Referer`, `X-OpenRouter-Title`) can be set later.
- **Model config:** one user/local setting: an OpenRouter model slug. Start with the quickstart's `~openai/gpt-latest` unless the user chooses another slug. Do not add Anthropic/OpenAI/provider-specific SDK configuration in v3.
- **Streaming:** use OpenRouter streaming when implemented so output appears live in the version.
- **Errors:** caught and surfaced as plain language (*"Couldn't reach AI — check your key or connection"*); the run goes `failed`, the canvas never crashes.
- **Offline:** everything except this call works offline. Fully-offline local models are not part of v3 because model configuration is OpenRouter-only.

---

## Why this is the right bet

It puts the effort exactly where Eido's value lives — turning weighted, signed connections into an instruction you can *see*, tuning that instruction with reusable structured Mods, and producing versions you pick between — while staying small enough to throw away. If this makes you feel *"it's thinking with my context, and I'm choosing, not auditing,"* the thesis holds. If not, we learned it cheaply, and the graph core survives whatever we try next.
