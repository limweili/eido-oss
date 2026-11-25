# Semantic Context Layer

The context layer answers one question: **for a given thought, which other thoughts feed it, in what order, and why?** As the user places and connects cards, the board becomes a graph of interconnected thoughts. This layer is how every feature — AI runs, previews, future lineage and multi-hop reasoning — reads that meaning. Governing decisions: ADR 0011, ADR 0012, ADR 0017, ADR 0018, ADR 0030.

Reference inspiration: Neo4j (incremental index maintenance, explicit index lifecycle, base+delta reads). Patterns only — Eido's version is built ground-up for its own graph.

## What exists today (source evidence)

| Piece | Where | Notes |
| --- | --- | --- |
| Graph walks | `src/graph/graphHelpers.ts` | `cardById`, `incomingConnections`, `outgoingConnections`, `membersOf` — array scans, fine at current scale, the seam to make index-backed |
| Context query seam | `src/graph/contextQuery.ts` | Deterministic selection of what feeds a card under a versioned `ContextPolicy` (see below). `deepThoughtPolicy(n)` walks up to n hops along helps-connections — bounded, cycle-safe, deterministic; the default 2-hop policy is byte-identical to before |
| Context contracts | `src/graph/contextContracts.ts` | Per-card-kind declaration of connection behavior (ADR 0017): canConsume, contributes, traversal, connectionDefaults, presentation. The context query, store connect path, compiler, and connection rendering read it; none branches on card kind directly |
| Lineage queries | `src/graph/lineage.ts` | `lineageOf` walks recorded run provenance backwards, generation by generation ("where did this come from"); `dependentsOf` walks the live graph forwards ("what could go stale if this changed") — both pure, deterministic, cycle-safe |
| Connection meaning | `Connection` in `src/graph/types.ts` | Directed, with `strength` (strong/weak, shown as Direct/Light), `polarity` (helps/pushesAgainst, shown as Helps/Avoid), `role` (feeds/modifies), optional `reason` (why an Avoid path died), `meta.contextOrder`, `meta.groupMode` |
| Prompt assembly consumer | `src/brain/compiler.ts` | `gatherConnectedThought` turns a context selection into the compiled instruction the user can inspect: Direct helps become `BUILD ON`, Light helps become `INFLUENCES`, and Avoid connections become `ALREADY EXPLORED — do not retread` |
| Context preview projection | `src/brain/compiler.ts`; `src/brain/contextCompaction.ts`; `src/canvas/ContextPeek.tsx`; `src/canvas/VersionContext.tsx`; `src/canvas/MarkdownPreview.tsx`; `src/shared/markdown.ts` | `gatherConnectedThought` also returns `preview.context` and `preview.mods`, a read-only projection of the same context selection and budget plan: relation, hop, readable connection label, shortened/will-shorten/left-out status, Avoid reason, and applied Mods. Live previews and frozen Result/Conversation/Group provenance render task, Card, Mod, shared-context, and per-turn content through the same shared Markdown projection instead of walking connections or exposing raw syntax. Only the explicit **Show text** disclosure presents the raw compiled text sent to AI. |
| Mod emission seam | `src/mods/prompt.ts`; `src/brain/modBlock.ts`; `src/brain/compiler.ts` | `readModContext` is the one Mod-to-prompt API. Each connected Mod contributes its treatment followed by its value sentences; `renderModsBlock` preserves connection order in one `MODS` block. Repeated kinds each speak and no treatment is deduplicated. Ask, Conversation, group-digest, preview, and provenance consumers share this output. |
| Mod load normalizer | `src/mods/normalizer.ts` | Current Mod documents are repaired to safe shapes with stable nested member IDs before the prompt engine or faces consume them; valid specs keep their meaning stable. Legacy browser `Card.mod` payloads are dropped at the Board-load seam while adjacent Board data survives. They are never converted into current Mods (ADR 0030). |
| Connection-scoped Mod application | `src/brain/compiler.ts`; `src/brain/conversationCompiler.ts`; `src/graph/contextContracts.ts` | Only a `modifies` connection applies a Mod. On an Ask it shapes that compile. On a Conversation it is room-level guidance for every participant; on a participant source Ask it is private guidance for that participant's turns. Connection polarity is still respected, so an Avoid connection does not become guidance. |
| Context fingerprints | `src/brain/sourceContext.ts` | Hashes graph content a run consumed so "source changed" hints work. Idea-level AI settings, including the boundary-injected system prompt, are intentionally outside the fingerprint |
| Ordering | `orderedIncomingConnections` in `compiler.ts` | User-controlled `contextOrder` wins, connection order breaks ties |

The current default policy is exactly the behavior the product has today: one hop into the target card, plus a second hop following strong `helps` connections only; `pushesAgainst` stays separate as Avoid/anti-context for the compiler's already-explored section; `modifies`/mod cards become modifiers; title cards are excluded; groups expand by `groupMode`. The kind-specific rules in that sentence live in the context-contract registry, not in traversal code.

## Invariants (do not break)

1. **Deterministic and explainable.** Same graph + same policy = same selection. Every included card carries the reason (connection, hop, relation). No hidden ranking. Embeddings/similarity may layer on later as a *separate, labeled* policy — never silently replacing the deterministic base.
2. **One seam.** Features must not walk `board.connections` with private rules. Ask for a selection from the context query seam; policies are named and versioned so provenance can record which policy produced a run. Preview-only metadata belongs on the compile/query return shape, not in a second traversal.
3. **Reads through helpers/indexes.** Consumers never assume arrays. When the graph index lands (salvaged from the scalable-foundations branch), helpers become index-backed with no consumer changes.
4. **Incremental maintenance.** Any index this layer keeps is updated from the store's change stream (the same change that mutated the data), never rebuilt per mutation on hot paths. New/heavy indexes get an explicit lifecycle (building → ready) so big boards can build them lazily without blocking.
5. **Canvas-agnostic.** This layer lives in graph core. No React Flow, no pixels.
6. **Visible card content flows downstream.** A result card's context text is its chosen version's answer plus that version's follow-up thread, clearly labelled (ADR 0011, PRD #236). One seam supplies it — `contextText` in `src/brain/compiler.ts`, flattening threads through `src/brain/followUpThread.ts` — and Ask compiles, conversation shared context, and group digests all read it. Follow-up changes are content changes: they change the source fingerprint (`sourceContext.ts`) and trip the source-changed badge downstream. Only settled messages leave the card — a still-streaming reply stays card-only until it finishes or is stopped, and context and fingerprint share one filter (`settledFollowUpMessages`) so the badge flips exactly once per settle (issue #248). Every seam that settles a `streaming` reply honours that flips-once guarantee: a reply orphaned at `streaming` (its stream died with a past session) settles to `stopped` at the board-load seam (issue #251), and duplicating a board aborts any live follow-up stream before snapshotting — the runner hands its stop function to the store (`registerFollowUpStreamStopper` in `src/graph/store.ts`), since the store cannot import the runner — then settles the snapshot as the backstop for orphans no live run owns. So no copy is born streaming, and nothing writes into the copy after it exists: a duplicated reply's `stopped` status and text are final, with no stream tail churning the fingerprint chunk by chunk (issues #267, #286). One session-only transient is accepted by design: undo/redo replays value patches, so a redo can restore a `streaming` reply — legitimately, when its stream is still running (writers address by version/message id, so chunks resume landing in it), or as a spinner with no stream when it already ended. The restore seam does not settle, because it cannot tell those apart without reaching into the stream registry; the orphan case stays card-only (never leaks downstream) and heals at the next board load.
7. **Mods modify only through their connection.** `readModContext` emits each connected Mod's treatment and sentences once; the compiler preserves that per-Mod grouping and order in one `MODS` block without deduplicating repeated kinds. A Mod does not enter ordinary context, and its scope comes from the `modifies` connection rather than from a property on the Mod card (ADR 0017, ADR 0030).

## Index design (reviewed) — how graph indexes stay fast

Reviewed design for issue #136. Implementation issues (#107, #91, #144) build against this section. The goal is invariant 4 made concrete: index cost is proportional to what changed, never to board size, on any hot path.

### One funnel, one change stream

Every board mutation flows through the ADR 0016 funnel in `src/graph/store.ts`: `commit`, `commitInteractionSummary`, or the state-only progress writer. The state-changing paths derive `BoardChange` from the actual before/after board slice and the captured patches, then publish it as transient store state (`lastBoardChange` + `boardChangeSeq`, monotonic within one board and reset to zero on board switch — an index must rebuild, not resume, when the board changes under it). A change record says what happened, by reference — never cloned content:

```ts
type BoardChange = {
  // Which top-level collections changed this commit.
  cards?: { added?: string[]; updated?: string[]; removed?: string[] }
  connections?: { added?: string[]; updated?: string[]; removed?: string[] }
  outputs?: { added?: string[]; updated?: string[]; removed?: string[] }
  runs?: { added?: string[]; updated?: string[]; removed?: string[] }
  // Field guard: which aspects of updated cards changed. An index that only
  // cares about geometry skips content-only commits entirely (tldraw's
  // epoch lesson: bump only when the indexed property changed).
  cardAspects?: Array<'position' | 'size' | 'content' | 'grouping' | 'layer'>
}
```

The record is derived, not declared: call sites do not hand-write hints that can drift from the real mutation. Mutating commits, progress writes, and undo/redo replay emit change records when they touch cards, connections, outputs, or runs. Narrative and empty commits do not emit a board change because they do not change board state.

### Two tiers

**Tier 1 — identity-keyed sub-index cache (the correctness backstop).** Salvage verdict on `src/graph/graphIndex.ts` from the `codex/scalable-foundations` branch: **salvage, with review**. It is the right Tier 1: per-collection sub-indexes (cards / connections / outputs / runs) rebuilt only when that collection's array identity changes, O(1) lookups, and attribution counters (hits, misses, rebuild causes) that make degradation visible. Its limit: any mutation to a collection still rebuilds that whole sub-index — acceptable for read-heavy paths at today's scale, not an end state for drag/typing.

**Tier 2 — change-fed incremental maintenance.** Indexes subscribe to `BoardChange` and apply deltas: a moved card updates only its spatial cells; a new connection touches only two adjacency entries. Rules:

1. **Apply is O(changed entries).** Full rebuild is allowed only on load, import, migration, checkpoint (ADR 0010) — or as an explicit, counted fallback when the change record is missing/unknown.
2. **Field-guarded invalidation.** An index declares which aspects it cares about; commits without those aspects don't touch it at all.
3. **Explicit lifecycle.** `building → ready → stale`. Heavy indexes build lazily (large boards must not block first paint); consumers either wait or fall back to a scan, and the state is inspectable.
4. **Counted fallbacks.** Every fallback rebuild increments an attribution counter (Tier 1 already has the pattern). A silent slow path is a bug; a counted one is a to-do.
5. **Equivalence testable.** For any index, applying N changes must equal rebuilding from scratch — that property test ships with every Tier 2 index.

### Who implements what

- **#107** (graph index module): land Tier 1 — salvage the codex-branch cache + selectors, wire `store.graph()`, keep the counters.
- **#91** (render paths onto shared indexes): consume Tier 1 selectors; no private lookups.
- **#144** (incremental spatial index): first Tier 2 consumer — needs `commit()` to emit `cards.updated` + `position` aspect from move/drag actions; do that minimal emission in the same slice.
- The append-only intent log remains semantic graph data used by playback; renderer-only appearance must not turn it into a board-wide hot-path projection (ADR 0021). The retired card-level intent signal is not current behavior (ADR 0022).

### Action contracts

Issue #154 landed the slim action-contract layer in `src/graph/actionContracts.ts`. It is intentionally data, not an execution engine: each contract names existing store actions, their commit shapes, undo/playback behavior, affected collections, Intent Log event types, and whether they emit `BoardChange`. Tests pin two invariants: every declared action exists on the current store, and every action in the declared board mutation surface is covered exactly once. The contracts are JSON-serializable so undo/redo tooling, timeline/playback work, diagnostics, and future sync admission can inspect the same surface without importing store implementation details.

## Context budget tunables (ADR 0015)

All engineering parameters for context budgets live in code next to their use; this table is the developer-facing record. None of these are surfaced in the UI.

| Tunable | Value | Where | Why |
| --- | --- | --- | --- |
| Token estimation | QuadChars: 4 printable ASCII chars = 1 token, every other char = 1 | `src/shared/tokenEstimate.ts` | OpenRouter's own model-agnostic normalization; no tokenizer dependency; error absorbed by the margin below |
| Budget per ask | 80% of the model's context window | `BUDGET_WINDOW_SHARE` in `src/brain/modelWindows.ts` | 20% margin covers estimation error and completion headroom |
| Budget cap | 256k estimated tokens | `BUDGET_CAP_TOKENS`, same file | Above this, cost and latency dominate long before window limits |
| Model window source | OpenRouter's published catalog, cached on the device and refreshed at most daily | `ensureModelWindowsFresh()` in `src/brain/modelWindows.ts` | The cache was read by every budget and written by nothing until #1034, so every current shortlist model resolved to the fallback. Where a catalog entry gives both a headline `context_length` and a smaller `top_provider.context_length`, the smaller wins: budgeting against a window the serving endpoint will not honour is refused after the person has already waited. Gated on holding an OpenRouter key |
| Unknown model window | OpenRouter 128k; Claude Code 200k; Codex account default 256k; Antigravity 1m | `CONTEXT_WINDOW_FALLBACK_TOKENS` and provider branches in `contextWindowFor()`, same file | Provider-aware floors avoid compacting harness aliases as generic OpenRouter models; used whenever the catalog is unavailable or does not list the slug. These floors are per-harness, not per-model: a local CLI's aliases (`sonnet`, `default`) are not OpenRouter slugs and appear in no catalog. Antigravity took the 1m floor when the Gemini CLI provider was retired on 2026-08-20, on the reasoning that it fronts the same vendor's long-window models; that floor is inherited, not separately measured against an installed `agy` |
| Hand-written model table | none, deliberately | removed from `src/brain/modelWindows.ts` (#1034) | There was one: seven slugs, none of them still in the product by the time it was read. A hand-kept table of a 400-model catalog cannot stay right, and a quietly wrong table is worse than none because it looks like knowledge. Ask the provider instead |
| Which number in a refusal is the limit | the smallest, after setting aside any number the message says is part of the request | `contextOverflowLimit()` in `src/brain/openRouter.ts` | The count that broke a limit is larger than the limit it broke, so the smaller number is it. But the commonest wording states four: "maximum context length is 128000 tokens. However, you requested 132000 tokens (116000 in the messages, 16000 in the completion)." The smallest there is the completion allowance, and recorded as the window it would cut this model to an eighth of its size on this device, permanently. Numbers followed by "in the messages" or "in the completion" are set aside rather than the brackets around them, because some providers bracket the limit itself |
| Window correction | any limit a provider states while refusing a request | `recordModelWindow()`, same file | What a provider did outranks what its catalog says, and the correction survives the next daily refresh. Three guards, because this is the one number that persists across runs: a correction may only ever shrink the window (a refusal is no evidence of a bigger one), must be at least `MIN_PLAUSIBLE_WINDOW_TOKENS` (a refusal message is prose, and a year or a mid-digit clip would set a threshold below the instruction itself), and is dropped once the catalog's published number for that model moves, which means it was re-released and the old refusal no longer describes it |
| Catalog retry backoff | 30 minutes after a failed fetch | `WINDOWS_RETRY_INTERVAL_MS`, same file | Without it an offline device fires one doomed request per run |
| Summary target size | ~600 characters | `COMPACTION_TARGET_CHARS` in `src/graph/contextBudget.ts` | Used to estimate the gain from compacting before the summary exists |
| Compaction model and effort | the Idea's own provider, model, and reasoning effort | `compactionModelForSettings()` in `src/brain/contextCompaction.ts` | Summarising inherits the Idea's AI settings on every provider, so a summary is made by whatever would have answered the Ask. Summaries are cached by content + model + system-prompt fingerprint, so each card compacts once per effective execution envelope and a change of model remakes them rather than reusing a summary the new model did not write |
| Loop compaction threshold | 80% of the model's window | `COMPACTION_THRESHOLD_SHARE` in `src/brain/conversationCompaction.ts` | ADR 0038. The 20% is the room the summariser needs to write in, plus estimator error on the unmeasured tail. Public harnesses that shipped 95% report it is too late |
| Tail kept whole | 12k estimated tokens of the freshest blocks or turns, capped at half the threshold | `compactionTailBudget()` in `src/brain/conversationCompaction.ts`, used by the loop and the card alike | Whoever is compacting is mid-thought, and the freshest part is what the next step builds on; summarising it would summarise the part that did not need it. A single block larger than the budget is summarised like any other, because keeping it would defeat the compaction. The cap is not decoration: a 16k model has a 13,107 threshold, so a fixed 12k tail would keep everything but the first block, nothing would ever clear the floor, and the run would walk into the refusal this exists to prevent. On any ordinary window the fixed number binds and nothing changes |
| Compaction floor | 8k estimated tokens of summarisable material, capped at a quarter of the threshold | `compactionMaterialFloor()`, same file | Below this a compaction costs a whole completion to reclaim almost nothing and fires again on the next turn. Capped for the same reason as the tail: on a small window a fixed 8k floor is most of the budget, so nothing would ever clear it |
| Loop summariser model | the run's own model | `compactConversation()` in `src/brain/openRouter.ts` | A cheap small model cannot hold a conversation that is by definition near a large window; the saving buys a call that fails exactly when needed |
| Summariser failures before giving up | 2 in a row | `COMPACTION_FAILURE_LIMIT` in `src/brain/conversationCompaction.ts` | Each attempt is a full-price call at the size of the window. A summariser that is simply unavailable must not be asked once per remaining turn. The run keeps its tools throughout and lets the provider be the one that says no |
| Native usage | read from the last frame of every stream | `StreamedTurn.usage`, same file | OpenRouter reports usage on every completion with the model's own tokenizer. It is authoritative for everything sent up to that point, so only what is appended afterwards is estimated |
| Estimator calibration | ratio of provider-reported prompt tokens to the QuadChars estimate of the same request, per model, in memory | `src/brain/tokenCalibration.ts` | QuadChars runs 10-25% off, and running low is the dangerous direction: a card the estimator reads as 68% full while the model reads it as 85% sails past the threshold into a refusal. Every completion reports real usage for bytes Eido has already estimated, so the error is measurable for free. Samples under 1k tokens and ratios outside 0.5-3 are ignored as noise or mismatch, and a request carrying an image or a file is not sampled at all (the estimator sees a filename, the provider sees a picture, and that gap is the attachment rather than the tokenizer); the freshest sample wins; never persisted, because a bad ratio written to the device would steer every later run with nothing to correct it |
| Card compaction threshold | 80% of the model's window, measured on the whole assembled follow-up instruction | `cardCompactionThreshold()` in `src/brain/cardContextCompaction.ts` | ADR 0038. The same share of the same window as the compile budget and the loop, so a card, its run, and its follow-ups can never disagree about how full it is |
| When a summariser is asked again about material it could not shorten | only once there is a floor's worth of discussion it has not already refused | `declinedMaterial` in `src/brain/followUpRunner.ts` | Some discussion is already as short as it can be said. Asking whether the whole plan was declined would be no guard at all: a card over its threshold has a full tail, so nearly every follow-up pushes one more turn into the material and makes the plan look new. Keeping the cost proportional to what the reader added is the same rule the note reuse follows |
| What a reader is told when nothing can be cut | "Too long, reduce and try again" | `errTooLong` in `src/shared/words.ts`, classified in `plainError()` | An Ask whose compiled instruction is already past the window fails before a word is generated, and no compaction can help it: there is no history to summarise, only what the reader's own graph compiled. The generic failure sent them to check a key that was working. The refusal also corrects the believed window, so the next run compiles under a truthful budget and may simply succeed |
| Cards remembering a note | 64, oldest evicted first | `CARD_MEMORY_LIMIT`, same file | A note is a saving, not a correctness requirement, so evicting one costs the next follow-up a summariser call and nothing else. Unbounded, a long session holds one entry per version it ever followed up |
| What a note is written from | the dropped turns, their lookups, and the previous note folded in once | `renderThreadMaterial()`, same file | A compaction trail row is deliberately excluded. Its detail IS the previous note, which already arrives once as material, so transcribing the row would carry the whole note twice at the exact moment the window is scarce |

The planner itself (`src/graph/contextBudget.ts`) is pure and deterministic: weak before strong, bottom of the user's order first, task text and Mods never touched, drops only after everything compactable is compacted — and the outcome is recorded on the run (`RunRecord.contextBudget`), shown on the result version and in the chain preview. Never silent.

The same budget applies to **conversation runs**: each participant's private context is compiled under its own model's budget (`resolveConversation` in `src/brain/conversationCompiler.ts`), the runner does the same two passes an Ask run does (learn what needs compacting, ensure summaries exist, recompile), and the per-participant outcomes merge into one `RunContextBudget` on the conversation run so the Conversation Result shows the same shortened-context marker.

## Compaction while a card is in use (ADR 0038)

The budgets above are decided once, before a run starts. They are the right
shape for an Ask, whose prompt is compiled and then sent. They are the wrong
shape for anything that keeps growing after that, and two things do.

**A Result Card's own context.** Every follow-up re-sends the whole of it: the
frozen run context the card was made from, the version text being discussed, and
every turn of the discussion so far. Ask enough follow-ups and it outgrows the
window, whatever put the text there.

**The loop Eido runs itself.** Its conversation grows on every turn: each
assistant turn with its tool calls, each capped tool result, all of it re-sent
every iteration.

Both measure themselves before sending and compact rather than walking into a
refusal, at the same share of the same window.

### At the card (`src/brain/cardContextCompaction.ts`)

The measurement is deliberately of the card and nothing else: the whole
assembled instruction plus the board's guidance and Eido's framing, corrected by
what this model was last seen to actually charge, against the window of the
model that will be sent it. Tool declarations and the travelling brief on an
agentic follow-up are outside that count on purpose: a fixed few hundred tokens
against a six-figure threshold, and they live below the injection point this
seam may not see through. It does not know or care what put the text there.
Web mode, a research run's lookups, tool trails, and whatever gets plugged into
a Result Card later all arrive as the same thing at this seam. If it enters the
card's context, it is counted, and no future feature has to remember to register
itself here.

- **What may be cut** is only the discussion. The frozen run context and the
  version text are the card's identity, not its history; a summary of them would
  be a different card.
- **The cut** lands between turns. A question and everything answering it are one
  unit, so a note can never strand a question without its answer.
- **The note replaces those turns in the outgoing request only.** The reader
  keeps every word of their discussion on the card, and everything the thread
  feeds downstream still reads the whole of it. Nobody loses a conversation
  because it got long.
- **The note is reused.** It is held in memory against the messages it stands in
  for and re-applied on the next follow-up. A thread that changed underneath it
  drops it, and so does a window with room to spare: a note is a saving, not a
  state the card is stuck in.
- **A card never pays to summarise its own summary.** What a cut is worth is
  judged on what the summariser will actually be handed, which excludes a note
  it is already given once and the trail row recording it. So the cost is
  proportional to new discussion, not to questions asked. A rebuilt request that
  is not smaller than the original is discarded along with its note.
- **Material that could not be shortened is not offered twice.** Some discussion
  is already as short as it can be said, and a summariser handed it returns a
  note the same size. Those messages are remembered as declined and not sent
  again, until the discussion grows past them and becomes a different question.
- **It shows in the trail** the reply already uses, whatever the card is armed to
  do: a plain discussion compacts exactly as an Agentic Run does, and the reader
  is owed the same account of it.

`src/brain/followUpRunner.ts` owns when to call it. Every path that is not a
clean compaction sends the instruction unchanged, on purpose: a discussion too
short to be worth cutting, a summariser that failed, a summariser that said
nothing. None of those prove the request will be refused, and refusing to send
on Eido's own estimate would fail a follow-up that would have worked.

### Inside a run (`src/brain/conversationCompaction.ts`)

- **The measurement** is the usage OpenRouter reported for the last request,
  counted with the model's own tokenizer, plus a QuadChars estimate of only what
  has been appended since. With no usage reported, the estimator covers the lot.
- **The cut** lands between complete blocks. An assistant turn that called tools
  and the tool messages answering it are one unit; separating them is a
  malformed request the provider rejects before the model sees it.
- **What survives verbatim** is the system framing, the travelling brief, and
  the person's compiled instruction. That instruction is the task, and a summary
  of the task is a different task.
- **What replaces the middle** is a handoff note the run's own model writes,
  asked for as five fixed headings. One note per run: each compaction is given
  the previous note as material and supersedes it.
- **When it cannot help**, the tools come off and the model is told plainly that
  there is no room left, in words distinct from the repeated-failure guard's.
  Only a cut that was actually made and still did not clear the threshold counts
  as proof of that. A summariser that failed, or a conversation with nothing but
  its instruction in it, proves nothing about how much room the run has: the
  history stands, the tools stay, and the provider gets to be the one that says
  no.
- **A refusal Eido did not predict** is recoverable once: take the limit the
  provider stated, compact, send again. The retry happens only when the
  conversation actually changed, because re-sending the same bytes buys a second
  refusal at the price of a whole request. A second refusal in a row fails the
  run.

`src/brain/conversationCompaction.ts` owns the shape of the operation and knows
nothing about the wire; `src/brain/openRouter.ts` owns when to call it and what
to do when it cannot help. Provider-owned harnesses are untouched: Codex and
Claude Code run their own loops and their own compaction.

### Three mechanisms, three names

None of these is the same thing, and the names are worth keeping apart.

| Name | Shortens | Cached | Cost |
| --- | --- | --- | --- |
| Card compaction (ADR 0015) | a Card's text, so a compiled prompt fits its budget | by content fingerprint | nothing per run |
| Card context compaction (ADR 0038) | a Result Card's discussion, in the outgoing follow-up only | in memory, against the messages it covers | one completion per stretch of new discussion worth cutting, never one per question |
| Loop compaction (ADR 0038) | a conversation in flight | never, it is never the same twice | one completion each time it fires |

## Future work (prepared for, not built)

- **Index-backed helpers**: adjacency maps (`connectionsForCard`) maintained incrementally; replaces array scans in `graphHelpers.ts`. First real consumer: compiler on large boards.
- **Per-hop weighting** for deep policies (depth landed in #140): weight what a hop contributes, not just whether it is included.
- **Provenance UI over lineage**: the queries landed in #142 (`lineage.ts`); a screen that renders them is future product work.
- **Worker-owned indexes**: when profiling shows main-thread index cost, move heavy indexes behind a message seam (Penpot pattern; Neo4j lifecycle pattern).
- **Semantic view UX**: any future on-screen "context view" renders this layer's answers; it must not grow its own graph.

## How to extend

Adding a feature that needs "what's connected to X"? 1) Express it as a policy (or reuse one) in `contextQuery.ts`, 2) consume the returned selection, 3) record the policy name/version in provenance if AI consumes it, 4) update this doc's tables.
