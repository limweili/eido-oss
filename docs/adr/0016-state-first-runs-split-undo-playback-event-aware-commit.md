# ADR 0016: State-First Runs, Split Undo/Playback, Event-Aware Commit Funnel

Status: accepted (amended 2026-07-06: added the interaction-summary commit shape surfaced by #190/#220)

## Context

The run/commit spine consolidation (PRD #182) exposed three unanswered domain questions that every spine PR would otherwise re-answer by guess:

1. **What is a RunRecord/Output Version relative to the Intent Log?** ADR 0001 says "the event log is the long-term source of truth," which reads as if live state should be a projection rebuilt from the log. But the store treats cards, outputs, and RunRecords as durable schema objects mutated in place, and nothing in the app rebuilds runtime state from the log. The two readings place the commit seam in different places: either the commit funnel *owns* events (it is the event system's front door) or it *calls into* an event system that owns state.
2. **Do undo and playback share machinery?** Today undo is a bounded in-memory stack of semantic history actions (`HISTORY_LIMIT = 50`), while playback is the Timeline Projector over the Intent Log. CONTEXT.md already states they have different retention rules; nothing yet states whether the planned refactor may unify them.
3. **What is the commit contract?** The store's `commit(updater)` only persists; the Intent Log is appended by hand at ~27 call sites in three idioms — unconditional, event-guarded (`event ? append : skip`), and length-guarded (`events.length ? append : skip`). The length-guarded idiom encodes real, undocumented semantics: emit only if the mutation actually produced something. The candidate contracts were `commit(updater, events?)` versus a diff-callback form `commit(updater, eventsFor?: (diff) => IntentLogEvent[])`.

The decision below was made by the product owner with a two-model architecture consult on 2026-07-06. This ADR records it so every spine PR (#188, #189, #190) is reviewed against a stated boundary. It changes no production code.

## Decision

### 1. RunRecords and Output Versions are state-first schema objects

Live store state is the working truth. RunRecords and Output Versions are durable schema objects (ADR 0008 provenance records) created and mutated only through the commit funnel. The Intent Log is the permanent append-only **record** of meaningful board actions — the audit and playback substrate — not the runtime source that state is rebuilt from. ADR 0001 is amended with this "record, not runtime source" clarification.

Consequence for the seam: the commit funnel **owns** events. It is the event system's front door and the Intent Log's only append point — not a client calling into an event-sourcing engine.

### 2. Undo and playback are split systems

- **Undo/redo** is a session-only ephemeral ring buffer of mechanically captured inverse+forward patches (e.g. Immer `produceWithPatches`), capped at ~100 entries, cleared on session end or board switch. It is never persisted and never derived from the Intent Log tail.
- **Playback** is served by the permanent append-only Intent Log of semantic events, materialized lazily by the Timeline Projector (never required for live interaction).

Undo is deliberately NOT derived from the log tail: that design taxes every future event type with invertibility, and it breaks under multiplayer's per-client selective undo (ADR 0002 anticipates shared boards where "undo my last action" must skip other actors' interleaved events — patch-based per-client undo survives that; log-tail rollback does not).

### 3. One commit funnel is the only writer

The funnel is the ONLY writer to live state, the undo ring, and the Intent Log. "Funnel" means the funnel module's three entry points — `commit`, `commitInteractionSummary` (Decision 4), and the transient-write path `writeBoardState` (below); any `set()` on graph state outside them is a review-time violation. Per commit the funnel:

1. runs the updater under patch capture → inverse+forward patches;
2. pushes one undo-ring entry **iff the patches are non-empty OR the caller supplied an interaction-summary undo action** (never both — the shapes below are disjoint); either way the entry carries the commit's `commitId`;
3. stamps and appends the passed events to the Intent Log;
4. persists — unless the commit was empty (see below), in which case nothing is written at all.

A commit therefore takes exactly one of four shapes:

- **Mutating commit** (patches non-empty): one undo entry plus the passed events (possibly `[]`), all stamped with one `commitId` — invariant: **1 changed commit = 1 undo entry = all the events born from that mutation, sharing one `commitId`**.
- **Narrative commit** (patches empty, events non-empty, no undo entry): the events are appended under a `commitId`; no undo entry is pushed, because nothing board-undoable happened — the state either changed in other, already-undoable commits, or never entered the board undo ring at all (e.g. editor-local text, which has the text field's own undo). See "Standalone narrative events" under Decision 4.
- **Interaction-summary commit** (patches empty, caller-supplied semantic undo entry, events possibly `[]`): used when a user interaction's board state was already applied by transient no-history progress frames (live drag/resize frames, member reorder), so the funnel's patch capture is empty — yet the gesture as a whole must be undoable. The caller supplies one semantic undo action for the whole session (e.g. the gesture's before/after), and the funnel writes it plus the events under one `commitId`; **the undo entry must carry that `commitId`**, preserving the 1-changed-commit = 1-undo-entry = its-events invariant. #190 ships this as the funnel's summary variant (`commitNarrativeHistory`). Events may be `[]` when no log event exists yet for the interaction (group member reorder).
- **Empty commit** (patches empty, events empty, no undo action): nothing is written — no state change, no undo entry, no events, no persist. This makes the length-guarded idiom's "emit only if the updater changed something" a funnel invariant instead of a call-site convention.

The line between the two patch-empty shapes: if the summarized state ever sat in the board undo ring's jurisdiction (the user would expect Cmd-Z to reverse it), the commit is an interaction-summary and must carry the semantic undo entry; if it never did (field-local edits, or the mutation already has its own undo entry in another commit), the commit is plain narrative and must not mint one.

**Transient progress writes (`writeBoardState`).** The "state already applied by progress frames" in the interaction-summary shape is not an exception to "only writer" — it is the funnel's third, sanctioned entry point, shipped by #190 as `writeBoardState(updater, { persist? })`: a patch-captured state write that mints **no undo entry, no events, no `commitId`** (a no-op writes nothing, same as an empty commit). It is legal in exactly two cases:

1. **Progress frames of an in-flight interaction** — live drag/resize frames, mid-stream text/transcript chunks — where the gesture's settling commit (an interaction-summary or mutating commit) records the durable summary.
2. **Pure ephemera** — writes the user never expects Cmd-Z or playback to cover: editor-local text state (the field owns its undo), visual preferences, streaming/conversation progress, cached summaries.

Mechanical review rule: every `writeBoardState` call site must be attributable to one of those two cases — either point at the gesture-end commit that summarizes it, or at the ephemera class it belongs to. A `writeBoardState` whose durable effect users would expect to undo or see in playback, and which no subsequent commit summarizes, is a violation — that write belongs in `commit` or under an interaction-summary.

Undo and redo themselves route through the funnel and append compensating events (`undo.applied { targetCommitId }`, `redo.applied { targetCommitId }`), so playback records undos and the log stays append-only — no event is ever removed to represent an undo.

### 4. The commit contract (binding for #188)

```ts
type CommitResult = { commitId: string; changed: boolean }

commit(
  label: string,                        // names the undo entry (user-facing history label)
  updater: (draft: GraphState) => void, // mutation under patch capture
  events: IntentLogEventDraft[],        // REQUIRED — pass [] explicitly when nothing narrative happened
): CommitResult

// Interaction-summary variant (Decision 3's fourth shape). Shipped by #190 as
// `commitNarrativeHistory`; this ADR's binding name for the shape is
// interaction-summary — rename the helper to `commitInteractionSummary` when
// #220's fixes land (the shape and rules are binding; the identifier follows).
commitInteractionSummary(
  label: string,
  undoAction: HistoryAction,            // semantic before/after for the whole gesture; entry carries the commitId
  events: IntentLogEventDraft[],        // REQUIRED here too — [] allowed (e.g. member reorder, no log event yet)
): CommitResult
```

`events` is required, not optional: every call site states its narrative intent, and `[]` is a visible, reviewable claim rather than a forgotten parameter. The funnel stamps each event with `id`, `at`, `ideaId`, plus `commitId`, `actorId`, `clientTxnId`, and a monotonic local sequence number — the stable identity and causal metadata ADR 0002 requires, cheap to record now and unused today.

**Deriving event payloads (binding, from #184).** Events that *describe a state change* — `card.moved`, `card.resized`, group-membership changes — must be built from the shared card-diff module (`cardUpdateAction` plus the `cardPatchMoved`/`cardPatchResized` classifiers in `history.ts`, or wherever #188 relocates them), never from an ad-hoc diff. The caller derives the event payloads from that shared patch list and passes the finished events to `commit`. This is how the "one diff rule" invariant of #184 survives the new signature: a no-op produces no shared-diff patches, so no change-describing events exist to pass, and the empty-commit rule catches whatever remains. The funnel's own mechanical patch capture serves the undo ring only; it is never a second source of event payloads, and the characterization test (#187) pins that the two computations agree on whether a change happened.

**Standalone narrative events.** The store today has appenders whose only "mutation" is the log append itself (`recordCardContentEdited`, `recordCardStructuralChange`, `recordVersionNoteCreated`): the state change happened in earlier commits or interaction-local updates, and the semantic event is deliberately coarser than those writes (one `card.content.edited` per editing session, not per keystroke; one `card.moved` per drag, not per frame). These migrate (#190) by one of three shapes, chosen per site:

- **Fold** the event into the commit that performs the originating mutation, **required** whenever event and mutation are born from the same user action — e.g. `version.note.created` rides the commit that creates the note card, alongside its `card.created` event. This covers the 1:1 sites (`setCardIntentSignal`-style: one user action, one state write, one event): the state write belongs in the folding commit's updater; splitting such a site into a state-only write followed by a narrative commit severs the event from its mutation's undo entry and `commitId`, and is prohibited.
- **Interaction-summary commit** when the summarized state was applied by transient no-history progress frames and must remain board-undoable — drag ends, resize ends, member reorders. The gesture-end call supplies the semantic undo action plus the shared-diff-derived events (Decision 3's fourth shape).
- **Narrative commit** (`commit(label, () => {}, events)`, patches empty, no undo entry) when the event summarizes writes that were never in the board undo ring's jurisdiction — e.g. `card.content.edited` at editing-session end: the text writes themselves are editor-local state-only updates whose undo lives in the text field, so there is no board undo entry for the summary to mint.

What is prohibited is the fourth shape: suppressing a semantic event because the state "already changed" outside the commit that reports it. If the shared diff says something changed, the log must say so too.

All three existing append idioms map onto this contract with identical emitted-event semantics:

- unconditional append → `commit(label, updater, [event])`, or a narrative/interaction-summary commit for the event-only sites above;
- event-guarded append → the caller passes `event ? [event] : []`;
- length-guarded append → events are derived from the shared diff, so a no-op yields none to pass, and the empty-commit rule backstops the invariant.

### 5. Spine order: `commit-events` (#188) lands first

The decision gate in PRD #182 resolves to its first branch: the domain question resolved cleanly as "commit owns events," so the event-aware commit funnel (#188) lands first and the run start/settle pair (#189) consumes its signature. The gate's second branch (run-spine first, to gather evidence) existed only for the case where ownership stayed ambiguous — it did not.

## Considered Options

- Chosen: state-first RunRecords, split undo/playback, one funnel that owns events, `commit(label, updater, events)` with required events, #188 before #189.
- Not chosen: RunRecord as an event-sourced projection of the Intent Log — it would tax every event with replay completeness, force the log into the live path (today it is lazily materialized), and rebuild a runtime the app never needs; no feature requires byte-perfect state rebuild from the log.
- Not chosen: RunRecord as a UI projection — runs are durable provenance (ADR 0008) that must survive reload, export, and import independent of any rendered view.
- Not chosen: undo derived from the Intent Log tail — invertibility tax on every future event type; breaks per-client selective undo under future multiplayer.
- Not chosen: the diff-callback contract `commit(updater, eventsFor?: (diff) => IntentLogEvent[])` — the diff callback was motivated by two needs, and both are met without it: no-op suppression is enforced by the empty-commit rule, and patch-derived payloads come from the shared #184 diff module that callers use *before* calling `commit` (the funnel's mechanical Immer patches are the wrong vocabulary for semantic payloads anyway — events speak in positions, sizes, and group ids, not JSON-pointer paths). An optional callback would also re-open the "which idiom applies" guessing this contract exists to close.
- Not chosen: prohibiting narrative commits and folding every event into a mutating commit — folding `card.content.edited` into its originating mutations means one event per keystroke commit, and folding drag-end `card.moved` means restructuring live-drag interaction; both trade a coarse, human-meaningful log for mechanical noise. Folding is required only where the event and the mutation are born from the same user action.
- Not chosen: keeping drag/resize ends as plain narrative commits (the original three-shape model) — at gesture end the state was already applied by `recordHistory:false` progress frames, so funnel patch capture is empty, and "no undo entry on patch-empty commits" would have made drags non-undoable. #220's cross-review surfaced this; the interaction-summary shape (patch-empty + caller-supplied semantic undo entry) is the amendment that resolves it without weakening the no-op rule.
- Later (**flip condition — record and revisit, do not drift into it**): if the project ever requires byte-perfect state rebuild from the Intent Log (e.g. log-driven recovery or server-authoritative replay), revisit this decision toward event-sourced projections in a superseding ADR.

## Consequences

- Product: undo stays instant and bounded; playback and provenance stay complete and append-only; undo and the log can never disagree about whether a change happened, because change-describing events derive from the one shared diff rule and both artifacts pass through the same funnel invariants.
- Engineering: the append-only guarantee of ADR 0001 becomes enforced by construction at one seam instead of by convention at ~27 call sites; #189/#190 build on the #188 signature; the funnel is also where transient BoardChange emission attaches for incremental indexes and #154 action contracts.
- Trade-off: every mutation must route through the funnel's three entry points (`commit`, `commitInteractionSummary`, `writeBoardState`) — direct `set()` writes to graph state, and transient writes that dodge the summarize-or-ephemera rule, become review-time violations; the discipline is the point.
