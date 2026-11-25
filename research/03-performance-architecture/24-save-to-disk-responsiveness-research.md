# 24: Save-to-disk responsiveness and low-maintenance autosave research

> Date: 2026-08-21
> Status: research complete; the chosen renderer scheduling policy is implemented
> Scope: desktop Profile persistence, browser-development persistence, rich-Card typing, Board gestures, and the smallest safe path to a snappy UI
> Source policy: primary sources only: official product documentation, first-party source repositories, web-platform guidance, and SQLite's own documentation

## Executive decision

Eido should treat the in-memory Graph state as the **hot interaction authority** and disk/Profile persistence as an **asynchronous, coalesced durability lane**. A keystroke, click, selection, pan, zoom, resize, or drag must update the in-memory state and paint without awaiting serialization, IPC, filesystem I/O, or revision confirmation.

The lowest-maintenance path is not a new document database or a CRDT. It is a tighter version of the scheduling seams Eido already has:

1. Keep the latest in-memory state immediately available to the editor and Board.
2. Coalesce repeated changes into one pending save, preserving only the newest snapshot when intermediate states are not user-visible durable checkpoints.
3. Keep at most one native commit in flight and one latest queued commit; do not start a second whole-Profile capture while the first is still committing.
4. Let routine text and completed geometry reset one shared quiet period, then flush explicitly on user checkpoints and application lifecycle events.
5. If capture/serialization itself is expensive, move only that preparation step to an idle/background task with a bounded timeout. Never rely on idle scheduling without a timeout, because required work can otherwise be delayed for seconds.

Do not begin with a separate native storage format for Card text versus Card position. That would create a second revision/conflict/recovery path. First separate the **scheduling policy** while continuing to submit the existing authoritative projection. Only if measurements show whole-snapshot capture remains the dominant cost should Eido consider a light normalized or delta seam.

## Chosen implementation

The low-maintenance policy is now implemented without changing the SQLite/Profile authority or the renderer-facing `SavedBoard` contract:

- The in-memory Graph and mounted editor apply routine edits immediately. `NoteCard` keeps the live editor echo local while the Graph receives the newest value, so typing does not await whole-Profile capture or native save confirmation.
- Browser-development saves use a lazy latest-source saver with a 3,000 ms quiet period. Repeated edits do not capture or clone a large Board until the timer expires; `saveState` becomes `saving` as soon as a pending source is scheduled and returns to `saved` only after the newest source finishes writing.
- Packaged routine text edits and released geometry use one shared 3,000 ms post-paint quiet window. The existing renderer queue permits one native commit in flight and retains only the newest queued projection.
- Editor-completion narrative events join the same routine quiet lane because the exact text is already current in the hot editor and Graph. Explicit Profile checkpoints, lifecycle transitions, Agent barriers, and shutdown flush the pending routine state before requiring their exact durable revision. Other ordinary semantic mutations retain their immediate path.
- Browser-development scheduling binds the exact Idea ID and immutable Graph collection identities immediately while leaving the content-proportional `SavedBoard` projection lazy. A lifecycle flush drains work that arrives during an in-flight write and swaps the Board only after the barrier succeeds; failure keeps the current Board, leaves `saveState` failed, and blocks the lifecycle. Current-Idea deletion rejects late save capture for the deleted Idea.

The implementation is guarded by `src/graph/saveDebouncedSaver.test.ts`, the packaged scheduling cases in `src/graph/profileRendererStore.test.ts`, gesture persistence characterization in `src/graph/dragGesturePersistence.char.test.ts`, and editor echo/reconciliation coverage in `src/canvas/cards/NoteCard.editorEcho.test.tsx` and `src/canvas/cards/RichMarkdownEditor.externalUpdates.test.tsx`. These tests prove scheduling and authority boundaries; they do not claim that every host will produce a particular frame rate.

## What established systems actually demonstrate

### VS Code: configurable quiet-period and focus/window checkpoints

VS Code documents four save modes: explicit save, save after a configurable delay, save when focus leaves the dirty editor, and save when focus leaves the window. Its documented default delay for `afterDelay` is 1,000 ms. It also backs up unsaved changes so they can be restored after an unexpected close ([VS Code Save / Auto Save and Hot Exit documentation](https://code.visualstudio.com/docs/editing/codebasics#_save-auto-save)).

**Applicable pattern.** A quiet period is an established product contract, not an arbitrary implementation detail. Focus/window exit and explicit checkpoints complement the timer rather than requiring the timer to be the only durability guarantee.

**Important limit.** VS Code's 1,000 ms default is a product choice for files and cannot be copied as Eido's correct value. Eido's implemented three-second delay reduces repeated saves, but it also increases the amount of work that exists only in memory after a crash. The explicit checkpoint and lifecycle flush paths document and bound the ordinary durability trade-off; a future recovery/backup path could reduce the unexpected-crash loss window.

### Tiptap + Yjs: local changes can be durable without whole-document writes

Tiptap's official offline guide wires an editor to Yjs and `y-indexeddb`; it states that changes are stored locally and remain available after closing the tab or losing connectivity ([Tiptap offline support](https://tiptap.dev/docs/guides/offline-support)). Yjs exposes document updates as binary update messages, says updates are commutative and idempotent, and provides APIs to encode only the difference relative to a state vector and to merge multiple updates ([Yjs document updates](https://github.com/yjs/yjs#document-updates)).

**Applicable pattern.** A local editor can apply every edit to its live in-memory model while persistence records updates asynchronously. Batching several updates before durable storage is possible when the storage model is update-oriented.

**Important limit.** Eido is not currently a Yjs/CRDT document. Adopting Yjs or another CRDT solely to make typing faster would be a major data-model decision, not a low-cost autosave optimization. The useful lesson is the separation of the hot update stream from durable storage, not the library choice.

### Yjs Hub: fast transient queue, periodic durable compaction

The first-party Yjs Hub documentation describes a real-time layer that publishes updates immediately, queues a persistence task, and periodically merges pending updates into durable storage. It explicitly says the persistent layer may be configured to persist at intervals and that stale transient updates are cleaned after durable storage succeeds ([Yjs Hub persistence architecture](https://github.com/yjs/yhub#persistence-layer-postgresql--s3)).

**Applicable pattern.** Separate “available to the live editor” from “durably checkpointed.” A queue with one newest pending checkpoint prevents a slow disk operation from making every subsequent interaction wait behind each intermediate state.

**Important limit.** Yjs Hub has Redis, workers, and a server-side update protocol. Eido should not import that machinery for a single-user local Profile. The small Eido analogue is an in-process queue and one existing native commit path.

### Chromium scheduling: idle work needs a deadline

Chrome's first-party guidance describes `requestIdleCallback` as a way to run non-critical work when the browser has free time, but recommends a `timeout` for work that must eventually run. The same guidance shows processing a queue in small chunks, checking the remaining idle budget, and scheduling another callback when the queue is not empty ([Chrome requestIdleCallback guidance](https://developer.chrome.com/blog/using-requestidlecallback)).

**Applicable pattern.** Expensive snapshot capture, JSON encoding, or preview preparation can be scheduled as low-priority work after the user-visible mutation. The queue must be bounded/coalesced, and the timeout must prevent starvation.

**Important limit.** Idle callbacks are not a substitute for chunking or a guarantee that a large JSON clone will be cheap. A single large capture can still monopolize the main thread. The first measurement should isolate capture, serialization, IPC, native commit, and confirmation rather than merely moving the whole operation into an idle callback.

### SQLite: durability is a transaction boundary, not a reason to block every input

SQLite's official atomic-commit documentation explains that a transaction's commit boundary is the point at which the required journal state is safely established; the database presents either the old or complete new state after failure ([SQLite atomic commit](https://www.sqlite.org/atomiccommit.html)). SQLite's WAL documentation describes appending committed transactions to a write-ahead log and later checkpointing them into the main database ([SQLite WAL format](https://www.sqlite.org/walformat.html)).

**Applicable pattern.** Grouping multiple logical UI changes into one transaction/checkpoint can reduce commit overhead while preserving an atomic durable state. If Eido's native Profile bridge already supplies atomic revisioned commits, the renderer should use that seam rather than inventing a second file-writing protocol.

**Important limit.** Enabling WAL or changing SQLite schema is not automatically a win for Eido. The current pain may occur before native SQLite I/O: during renderer-side whole-state capture, JSON cloning, IPC marshalling, or DOM/editor work. Measure those stages first.

### ProseMirror: the live editor already has a transaction boundary

ProseMirror's guide describes editing as applying transactions to an existing in-memory editor state, producing a new state; the state update is separate from any application-specific persistence or transport ([ProseMirror guide](https://prosemirror.net/docs/guide/)).

**Applicable pattern.** Eido should keep the editor transaction/state update on the hot path and make persistence an observer/checkpoint consumer. A save observer must not synchronously rebuild or serialize the entire Board before the editor can paint the typed character.

**Important limit.** This is an editor-state principle, not proof that Eido's current React/store wiring obeys it for a 600k-character Card. The exact call path needs a runtime profile.

## Eido source-grounded baseline

The following are repository observations, not external claims:

- Browser-development persistence uses `makeDebouncedSaver(3_000, ...)`, retaining a lazy source for only the latest `SavedBoard` before calling the save function ([`src/graph/store.ts`](../../src/graph/store.ts#L1705-L1759), [`src/graph/store.ts`](../../src/graph/store.ts#L2744-L2753), [`src/graph/save.ts`](../../src/graph/save.ts#L541-L622)).
- Packaged routine text edits and released geometry share a 3,000 ms post-paint Profile capture quiet window ([`src/graph/store.ts`](../../src/graph/store.ts#L1368-L1563)). There is no separate 600 ms text timer or 250 ms gesture fallback in the chosen policy.
- `setCardText` uses the deferred text path, and `recordCardContentEdited` coalesces its editor-completion narrative event into the same routine lane. High-frequency streaming writes can update in-memory state without forcing an immediate save ([`src/graph/store.ts`](../../src/graph/store.ts#L3367-L3393), [`src/graph/store.ts`](../../src/graph/store.ts#L4424-L4448), [`src/graph/store.ts`](../../src/graph/store.ts#L4534-L4561), [`src/graph/store.ts`](../../src/graph/store.ts#L4805-L4829)).
- Browser-development requests bind the Idea target and immutable collection identities while the `SavedBoard` projection stays lazy. Lifecycle flush waits for writes arriving during the in-flight write, blocks Board replacement on failure, and gates late current-Idea writers during deletion ([`src/graph/store.ts`](../../src/graph/store.ts#L1705-L1742), [`src/graph/store.ts`](../../src/graph/store.ts#L2777-L2811), [`src/graph/store.ts`](../../src/graph/store.ts#L2914-L2958), [`src/graph/save.ts`](../../src/graph/save.ts#L553-L631)).
- The editor source revision makes a true external Graph replacement authoritative even when its bytes equal an earlier source, while local Graph echoes do not re-import the mounted editor ([`src/canvas/cards/MarkdownCardEditor.tsx`](../../src/canvas/cards/MarkdownCardEditor.tsx#L23-L125), [`src/canvas/cards/RichMarkdownEditor.tsx`](../../src/canvas/cards/RichMarkdownEditor.tsx#L191-L227), [`src/canvas/cards/RichMarkdownEditor.externalUpdates.test.tsx`](../../src/canvas/cards/RichMarkdownEditor.externalUpdates.test.tsx#L135-L190)).
- Packaged Profile persistence captures a renderer commit state, performs inert JSON capture, and keeps one active commit plus one queued latest projection ([`src/graph/profileRendererPersistence.ts`](../../src/graph/profileRendererPersistence.ts#L390-L730)).
- The Profile GUI save scheduler itself coalesces queued generations and serializes submissions, but this does not make the caller-side projection capture free ([`src/persistence/profileGuiSaveScheduler.ts`](../../src/persistence/profileGuiSaveScheduler.ts#L140-L454)).
- Existing persistence measurements report a 23 ms serialization time for a large 5,000-card fixture, while the saved payload was 15.9 MB and the intent log was 12.4 MB. That baseline is not a 600k-character rich-Card measurement and should not be used as a proxy for the current typing symptom ([`11-persistence-payload-baseline.md`](11-persistence-payload-baseline.md)).

The important implication is that “Save to disk” may include several distinct costs: capturing a detached renderer projection, traversing/cloning a very large Card, serializing or encoding it, crossing the renderer/native bridge, committing a revision, and confirming that revision. The label shown to the user hides those stages. A stage-timed profile is the first required experiment.

## Low-cost candidate policy for Eido

### Lane A: hot in-memory interaction

The editor, selection, drag geometry, zoom, pan, and resize must update the in-memory Graph immediately. No caller should await a durable commit before painting. This is the highest-value fix for “typed text appears seconds later.” If the state update itself is slow, autosave scheduling cannot solve it; that needs a separate editor/store profile.

### Lane B: coalesced durable checkpoint

Keep the existing authoritative Profile projection and revision protocol. Improve its scheduling rather than introducing a second persistence format:

- text: reset a 3,000 ms quiet-period timer on each routine edit; this is the chosen responsiveness trade-off, not a claim that three seconds is universally optimal;
- geometry: after release paint, reset the same 3,000 ms quiet-period timer used by routine text so rapid mixed interactions produce one latest capture;
- while a commit is active: retain only the newest pending projection, with explicit metrics for dropped intermediate generations;
- on idle: prepare the expensive capture in a bounded background/idle task where supported, with a timeout fallback;
- explicit checkpoints: flush on user-requested save/export, lifecycle transitions, Agent barriers, and app/window close; deselection remains a local interaction and does not synchronously block on disk;
- status: distinguish “local changes applied,” “save queued,” “saving,” “saved,” and “recovery required.” A “Saved to disk” label must not imply that the last keystroke has already crossed the native durability boundary.

The product uses 3 seconds as the routine quiet period. Evidence from VS Code supports configurable delay plus focus/window checkpoints, not a universal 3-second optimum. This creates an intentional crash-window trade-off: routine changes made within the quiet period can remain in memory if the process dies unexpectedly, while explicit lifecycle and checkpoint paths flush before their durability boundary. A future recovery/backup path may reduce that loss window, but it is not part of this low-cost scheduling change.

### Lane C: only if profiling proves whole-snapshot capture is the cliff

Consider a light dirty-lane representation that still emits the existing full authoritative projection at checkpoints:

- maintain dirty Card IDs and dirty geometry IDs in memory;
- avoid recapturing unchanged oversized Card payloads while a position-only change is queued;
- reuse immutable/captured subtrees where the current contract allows it;
- schedule one complete projection only when a durable checkpoint is due.

This is still a renderer-side optimization. It must not silently create a second native revision stream. A true per-Card delta/event journal, CRDT, or normalized native store is a later architecture project and needs its own compatibility, crash recovery, migration, and export proof.

### O-card caching is not the first save optimization

The oversized-visible (O) policy controls rendering residency and activation. Caching an O Card's shallow/painted representation may reduce activation or paint work, but it does not automatically reduce the cost of saving the underlying full Card. O-card caching should be pursued only if a profile attributes the observed delay to preview/editor preparation rather than Profile capture or commit.

## Recommended measurement before implementation

Add a disposable or test-only stage-timing trace around one 600k+ Card edit and one rapid multi-Card drag sequence. Record, separately:

1. editor/store mutation and time until the typed character is painted;
2. snapshot/projection capture duration and bytes/nodes traversed;
3. JSON/binary serialization duration and output bytes;
4. renderer-to-native bridge duration;
5. native commit duration and revision confirmation duration;
6. queue depth, number of coalesced generations, and time from local mutation to durable confirmation;
7. main-thread long tasks and frame gaps during typing, drag, pan, zoom, selection, and deselection.

The first implementation should be selected by the largest stage that overlaps user input. If capture is the problem, increasing the debounce alone only hides the work and may create a larger burst. If native commit is the problem, a renderer queue and delayed checkpoint can help. If the editor mutation or React render is the problem, save scheduling is not the root fix.

## Decision matrix

| Candidate | Maintenance cost | Durability risk | Likely value | Decision |
| --- | ---: | ---: | ---: | --- |
| Keep latest in-memory state; never await save in input/gesture path | Low | None beyond existing queue | High if save currently blocks paint | **Adopt/check first** |
| Use a 3 s routine quiet period | Low | Larger crash-loss window | Medium; reduces save frequency and avoids repeated capture during bursts | **Adopted with checkpoint/lifecycle flush** |
| Coalesce one active + one latest queued checkpoint | Low | Low if revisions/flush stay intact | High during bursts | **Adopt/check first** |
| Idle/background capture with bounded timeout | Low–medium | Must flush lifecycle/checkpoints | Medium if capture is the cliff | **Prototype after stage timing** |
| Separate renderer scheduling for text vs geometry, same native projection | Medium | Low if one revision lane remains | Medium-high | **Reject for now; the shared quiet lane is simpler** |
| Native per-Card delta store / event journal | High | Migration/recovery/export complexity | Potentially high at very large scale | **Defer** |
| Introduce Yjs/Automerge solely for autosave | Very high | New model and compatibility obligations | Unproven for this product | **Reject for now** |
| Cache O-card previews as a save optimization | Low–medium | Cache invalidation risk | Unknown; unrelated unless profiled | **Do not conflate** |

## Sources

- [VS Code: Save / Auto Save and Hot Exit](https://code.visualstudio.com/docs/editing/codebasics#_save-auto-save)
- [Tiptap: Offline support](https://tiptap.dev/docs/guides/offline-support)
- [Yjs: Document updates](https://github.com/yjs/yjs#document-updates)
- [Yjs Hub: Persistence layer](https://github.com/yjs/yhub#persistence-layer-postgresql--s3)
- [Chrome for Developers: Using `requestIdleCallback`](https://developer.chrome.com/blog/using-requestidlecallback)
- [SQLite: Atomic commit](https://www.sqlite.org/atomiccommit.html)
- [SQLite: WAL-mode file format](https://www.sqlite.org/walformat.html)
- [ProseMirror: Guide](https://prosemirror.net/docs/guide/)
