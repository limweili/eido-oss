# Round 5 source material — controllers, envelopes, execution tiers (weili, 2026-07-16)

Verbatim ideas supplied by weili during round 5, lightly re-formatted. This is
the source the `explore-controllers.md` report works from.

## The three-tier taxonomy

```
1. SHAPERS
   Compile into one prompt.
   Fast and cheap.

2. TRANSFORMERS
   Produce a new intermediate artefact.
   Slower and explicit.

3. CONTROLLERS
   Inspect results and decide what happens next.
   Adaptive and optional.
```

Synth concepts placed within them:

```
SHAPERS:      Mix · Filter · Resonance · static tone · static detail · static priorities
TRANSFORMERS: Explore · Cluster · Critique · Compress · Reframe · Develop · Combine
CONTROLLERS:  Envelope · Complexity adaptation · Quality feedback · Routing ·
              Retry rules · Stopping conditions
```

## 1. Envelope controller

An envelope maps progress through a bounded process to a parameter value.
The stable engine concept is not technically "time" — it is **a normalized
position from the start to the end of some lifecycle** (0.0 beginning, 0.5
middle, 1.0 end). The creator decides what lifecycle it refers to:
conversation, document-writing, idea-development, a single generation, a
five-stage workflow, a user-defined session. (LLM systems do not have one
natural time axis.)

Creator defines: envelope name ("Convergent Thinking"), lifecycle (idea
development), target (exploration breadth), control points (start 9 / middle
6 / end 2), curve (smooth), interpretation prose ("Start by considering
diverse directions. Gradually consolidate overlapping ideas. Finish by
committing to the strongest direction."). The user sees only the simple
3-point view, or perhaps three sliders (beginning/middle/ending breadth).
The creator defines what the values mean; the user shapes the curve.

The engine needs a **progress provider**:
- Stage-based: Explore 0.0 / Organise 0.3 / Critique 0.7 / Finalise 1.0
  (reliable — explicit stages)
- Turn-based: turn n of N (structured conversations)
- Token/completion: beginning/middle/end of response (hard to execute
  precisely in one call; describable in a compiled prompt)
- Event-based: hypothesis formed 0.2 → evidence gathered 0.5 →
  contradictions resolved 0.8 → recommendation ready 1.0 (workflow state,
  not elapsed time)
- **User-controlled: [ EXPLORE ]──────●────────[ COMMIT ]** — the user
  directly moves the system through the lifecycle; particularly appropriate
  because it gives the user control over idea drift.

**Compiled envelope**: one instruction describing the trajectory, one model
call ("Begin by exploring a wide range of possibilities. As the response
develops, consolidate overlapping ideas and reduce speculative branches. By
the conclusion, commit to one clear recommendation."). Fast, cheap, easy to
preview, good for soft stylistic trajectories; the model approximates the
stages, no guaranteed checkpoint, no reliable intermediate inspection.

**Executed envelope**: each position becomes a real stage (CALL 1 generate
broad possibilities / CALL 2 consolidate and compare / CALL 3 select and
develop). Reliable stage separation, intermediate artefacts exist, users can
intervene, feedback can affect later stages; slower, more expensive, greater
orchestration complexity.

**Auto mode**: the controller declares `Execution mode: Auto`; the engine
chooses (soft behaviour change → compile; needs evaluation or durable
intermediate output → execute). The distinction should be visible in the
builder:

```
Envelope quality
FAST ◄────────────────────► PRECISE
One prompt                 Separate stages
```

## 2. Routing controller

Routing does not change a value — it chooses a path. Signal ("need for
research"), evaluator prose ("Determine whether the request depends on
current external facts."), paths (High → research workflow / Low → direct
answer / Unsure → ask or run lightweight lookup).

Compiled routing delegates the choice to one model call ("First decide
whether external research is required. If it is not required, answer
directly. If it is required, identify what must be researched before
answering.") — only works when both paths remain inside the same model
context. Executed routing: the engine inspects a classifier decision and
launches a different workflow (classifier → research_required → retrieval →
grounded answer). Routing generally benefits more from execution — it often
controls tools, costs, or entirely different chains.

## 3. Feedback controller

Output → analyser → score → controller → parameter change. Example: draft
clarity 4/10 → increase explanation structure, reduce sentence complexity,
add one example → revise draft. Creator defines: metric (clarity), evaluator
prose, thresholds (0–4 strong revision / 5–7 light / 8–10 accept), max
retries (2). The user might see clarity target / revision intensity / max
passes — or nothing at all if the creator makes feedback automatic.

Feedback controllers are usually inherently executed — an output must exist
before it can be assessed. A compiled approximation exists ("Draft the
answer, review it for clarity, and revise it before returning it.") but has
no trustworthy separation between generation, evaluation, and revision.
