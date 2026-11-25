# Concerns

Observable drift, risks, and open questions found during the first codebase map.

## Recent Cleanup Notes

| Change | Evidence | Follow-up |
| --- | --- | --- |
| The active app was promoted from `versions/v3/app` to the repository root | `package.json`, `src/`, `vite.config.ts`, `README.md`. | Keep future run commands root-relative. |
| The old prototype-version folder model was removed from the active tree | No `versions/` directory remains; v1/v2 are available through Git history only. | Do not recreate version folders for ordinary feature work. |
| The v3 plan is now archived | `docs/archive/initial-product-plan/`. | Treat it as historical intent; current behavior is source-grounded in `src/` and `docs/foundations/`. |
| Research folders were renamed into durable tracks | `research/README.md`; `research/01-technology-landscape/`; `research/02-source-studies/`; `research/03-performance-architecture/`. | New research should follow the track rules in `research/README.md`. |
| Current guidance is separated from historical material | `docs/README.md`; `docs/archive/README.md`; `docs/design/README.md`; `docs/release/README.md`. | Add new documents to the nearest indexed owner and state when a record is point-in-time rather than authoritative. |
| Repository tooling is grouped by execution concern | `scripts/README.md`; `scripts/ci/`; `scripts/electron/`; `scripts/maintenance/`; `scripts/release-signing/`; `scripts/vite/`. | Keep browser application modules in `src/` and build/operations code under the matching scripts subfolder. |

## Open-source transition

Commercial services and account/analytics code are removed by ADR 0051. Historical
managed-route provenance remains a compatibility obligation, not a feature to
restore. Existing vendor deployments and secrets can outlive repository deletion;
see [open-source handover](../agents/open-source-handover.md). R2/download delivery
remains; actual cloud teardown and public Git-history review require separate work.

## Engineering Risks

| Risk | Evidence | Why it matters |
| --- | --- | --- |
| Streaming chunks are not persisted until a later committed store action | `appendVersionText()` in `src/graph/store.ts` uses `set()` without `persist()`; `finishRun()` commits after success. | If the tab closes mid-stream, partial streamed output may be lost. The nearby comment says the debounced saver picks up the latest snapshot, but current code passes snapshots by value. |
| Conversation transcript chunks have the same streaming persistence caveat | `appendTranscriptChunk()` in `src/graph/store.ts` uses `set()` without `persist()`; later transcript/run actions commit. | A tab close mid-turn can lose the most recent streamed chunk until a committed action fires. |
| Legacy plaintext credential history can remain in browser storage files | `electron/localCredentialStore.ts`; `src/graph/apiCredential.ts`; `src/desktop/packagedProfileProof.ts`. | Current provider keys use OS-protected ciphertext outside Profile and Portable Export. Successful legacy migration removes the active renderer field and readable credential file, but browser `removeItem` or replacement does not securely erase historical LevelDB records. The packaged proof keeps its synthetic legacy input in memory so its whole-root byte scan can detect new plaintext writes without creating one itself. A locked protected store preserves its ciphertext and degrades AI without blocking Boards. |
| Assets are stored as data URLs inside board snapshots | `CardAsset.dataUrl` in `types.ts`; `clipboardAssets.ts`; disk/IndexedDB board snapshots. | Large pasted files can bloat local storage, disk store, and exported Idea files. |
| Direct browser OpenRouter call depends on CORS/provider behavior | `openRouter.ts`; no backend/proxy. | A provider-side change can break runs without code changes. |
| Model shortlist can age | `src/brain/models.ts` hard-codes OpenRouter slugs. | Slugs/availability may change; verify before relying on defaults. |
| Local harness output formats can drift | `electron/aiHarnessMainSession.ts` parses the installed CLIs' bounded JSONL output. Contract cases cover every harness, streamed/terminal reconciliation, Antigravity's documented `event`/`step_type` allowlist, and resistant-child shutdown; a real child fixture covers stdin/JSONL and a real missing executable covers spawn ordering. Claude Code, Codex, and Antigravity are live-verified on this host. | A CLI update can change event shapes or flags. Empty, divergent, or unrecognized successful output fails as incompatible and tells the user to update Eido or use a supported CLI version, rather than pretending the command is missing or silently dropping terminal text. Keep the parser narrow and re-run the Antigravity probe when its installed CLI changes. |
| Codex's read-only sandbox cannot reach Eido's live Agent Gateway | `electron/aiHarnessMainSession.ts` pins `codex exec` to `-s read-only`; `electron/profileLiveGatewayClient.ts` reaches the active app through a native helper and local socket. The same bounded `eido status` call returns `transport-failure` inside that sandbox and succeeds outside it. | An Eido-hosted Codex run cannot currently call `eido` back into the open app. Do not remove the sandbox or let the model launch another Eido process as a workaround; a future integration needs a narrow broker that preserves the Gateway contract. |
| Dependency advisory state can change without a source edit | Both the full-tree and production-only high-severity audits were clean on 2026-08-30 after patched direct/transitive updates; `npm run ci:required` now repeats the production audit after every locked install. | Keep the production audit release-blocking and the full-tree audit on its weekly cadence so runtime and packaging-tool advisories cannot age into accepted release state. |
| Content caches use a simple stable hash | `src/shared/stableHash.ts`; callers include group digest, source context, and compaction fingerprints. | Good enough for freshness hints, not a cryptographic guarantee. |
| Disk storage plugin is tied to Vite dev/preview | `vite.config.ts`; `scripts/vite/storagePlugin.ts`; `src/graph/save.ts` fallback behavior. | A deployed static build will fall back to IndexedDB unless an equivalent API exists. |
| Intent log starts at instrumentation time | `src/graph/store.ts` appends events for committed actions; older boards load with `intentLog: []`. | Playback can only replay history recorded after the log existed; older content appears as baseline state. |

## Product/Architecture Questions

| Question | Evidence | Status |
| --- | --- | --- |
| What should the final user-facing name for "Mod" be? | `docs/archive/initial-product-plan/05-build-path-and-open-questions.md`; `src/shared/words.ts`. | [ASK USER] |
| When should line-level anchors become real? | `Block` supports `blockId`; plan says textarea identity is best-effort; current `setCardText()` stores one block. | [ASK USER] |
| When does React Flow become limiting enough to graduate to tldraw? | v3 plan open question; current canvas built on `@xyflow/react`. | [ASK USER] |
| Should group compression stay an AI-generated output attached to the group card, or become a distinct record type? | Source stores group digest versions as `Output` on a `group` card. | [ASK USER] |
| Should Conversation Result remain a `result` card kind or become its own card kind? | `ConversationResultCard.tsx` renders `kind: 'result'` cards connected from Conversation cards using transcript-bearing `OutputVersion`s. | [ASK USER] |

## Highest-Value Next Docs

| Doc | Why |
| --- | --- |
| `docs/codebase/RUNBOOK.md` | Local startup, dev server, storage reset, OpenRouter setup, common failure recovery. |
| `docs/codebase/DATA_MODEL.md` | Source-of-truth schema map for `SavedBoard`, card kinds, connections, outputs, runs, Ideas, and migration expectations. |
| `docs/codebase/FEATURES.md` | Current user-facing workflows versus historical plans, especially groups, assets, Ideas, and compressed context. |
| `docs/codebase/ADR-CANDIDATES.md` | Non-binding list of decisions that may deserve ADRs later: React Flow boundary, OpenRouter direct browser calls, group digest modeling, test-in-CI policy. |
