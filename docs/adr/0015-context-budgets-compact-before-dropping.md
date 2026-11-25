# ADR 0015: Context Budgets Compact Before Dropping

Status: accepted

## Context

Context gathering (ADR 0012) takes everything connected with no size limit; on a large board one Ask can exceed a model's context window. Something must give, deterministically and visibly. The app has no tokenizer, runs many models across providers through OpenRouter (per-card model selection), and industry practice for agent context management (Claude Code, Google ADK, Microsoft Agent Framework, Redis guidance) converges on: trigger on a token threshold, summarize the low-priority tail rather than drop it, never touch the instructions, cache summaries, and surface what happened — research also warns that silent compaction erases constraints. Founder review (July 2026) set the product rule: keep the strength signal first, compress rather than cut, show the user when it happened.

## Decision

When an Ask's gathered context exceeds its budget, lower-priority context is **compacted** (replaced by a cached AI summary), not dropped. Priority order: connection strength first (weak before strong), then the user's explicit input order (bottom first). The Ask's own task text and Mods are never compacted. If everything compactable is compacted and the budget is still exceeded, entries drop in the same priority order — and both compaction and drops are reported, never silent: the preview and the result version carry a plain-language marker ("some context was compacted / left out"), with the affected cards listed, recorded in run provenance.

Users control one three-position setting (Settings page, plain words): **Never** (trim with a note instead of compacting), **When needed** (default — full text until the budget is hit), **Eager** (weak links always arrive compacted).

Engineering parameters (documented here for developers; not surfaced in UI):

- **Token estimation: QuadChars** — every 4 printable ASCII characters count as 1 token, every other character as 1 token. This is OpenRouter's own model-agnostic normalization; adopting it verbatim avoids a tokenizer dependency and matches the billing platform's method (~10–25% of native counts, absorbed by the margin below).
- **Budget per ask** = 80% of the target model's context window (from OpenRouter's models list, cached locally), **capped at 256k estimated tokens**. Unknown model → assume a 128k window. The 20% margin covers estimation error and completion headroom.
- **Compaction summaries** are produced by the Idea's own selected provider, model, and reasoning effort, and cached by content fingerprint (the existing group-digest pattern): a card is compacted once and reused until its text changes, so compaction adds no per-run token cost.

  Amended 2026-08-20 on founder direction. This originally read "a small/cheap model", and the code carried a fixed cheap model plus a forced lowest reasoning rung. That policy predated local CLI providers, where a separate cheap model is not something Eido can choose on the user's behalf, and it meant the summarising step could send a reasoning value the active provider had no rung for. Summarising now inherits whatever the Idea is set to, so one setting explains every call Eido makes. The cost of that is real and accepted: summarising is billed like any other call, and a high reasoning setting is now spent on it too. The summary cache is keyed on the model, so changing model discards the old summaries and remakes them once rather than serving a summary the new model did not produce.
- **Calibration path:** OpenRouter returns native-tokenizer usage on every response; recording it per run lets estimates (and future cost displays) be corrected from observed history rather than guesses.

## Considered Options

- Chosen: compact-then-drop by priority (strength, then user order), QuadChars estimation, 80%-of-window budget capped at 256k, three-position user setting, visible markers.
- Not chosen: trim-only — simpler, but silently weakens answers by discarding meaning the user connected on purpose.
- Not chosen: recency-first priority — drops old-but-load-bearing anchor notes; strength already means "matters more" everywhere in the product.
- Not chosen: shipping a real tokenizer per model — heavy dependency for ±15% accuracy the margin already covers.
- Not chosen: numeric budget dials in the UI — token jargon in a product committed to plain language.
- Later: per-model calibrated estimates and measured cost display from recorded usage; token-based budgets replacing count/size heuristics in policies.

## Consequences

- Product: big boards keep working; nothing the user connected silently vanishes — it gets smaller, visibly, weakest first, and the cut is explainable on the result forever via provenance.
- Engineering: budgets and trimming live in the context layer behind the policy seam (ADR 0012); compaction reuses digest caching; all tunables (256k cap, 80% margin, QuadChars, summary target size) live in one documented place in `docs/foundations/context-layer.md`.
- Trade-off: compacted context can lose nuance a full text had — accepted because the alternative (dropping or overflowing) loses more, the user can force full text by reordering/strengthening links, and Never/Eager settings hand the dial to the user.
