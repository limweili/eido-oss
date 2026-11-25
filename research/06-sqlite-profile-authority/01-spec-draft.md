# Spec: Build Eido's SQLite Profile Authority and Local Agent Gateway

Status: published as [GitHub issue #520](https://github.com/limweili/eido/issues/520).
Label: `ready-for-agent`
Relationship: native blocker of Friends Alpha spec #448; terminal certification issue #528 blocks #471; vector implementation is a separate future backlog.

## Approved shared test seam

The primary acceptance seam is one **Local Profile Service** contract. The Electron renderer bridge, CLI, and stdio MCP adapter are transports into the same service; none owns a separate database or mutation implementation.

The service presents versioned profile-level operations for consistent inspection, optimistic command batches, durable flush, migration, recovery, Portable Export, and import. Production SQLite WAL, browser-development, in-memory, and fault-test implementations must preserve the same observable results where their capabilities overlap. Existing renderer actions continue to produce the current Board hydration shape, but persistence and agent transports cannot depend on SQL tables or paths.

The highest integration proof drives the packaged app and the CLI/MCP surfaces against one disposable Profile, then observes the same revision, Board, Mod library, Intent Log attribution, assets, recovery state, and Portable Export. Lower tests exist only where fault injection cannot be expressed safely at that seam.

## Problem Statement

Eido's current pre-Alpha local storage is not a safe or adaptable production authority. Ordinary changes parse, serialize, and replace one complete JSON store. Temporary rename lacks a complete durability protocol; overlapping read-modify-write work can lose newer state; malformed records may be silently filtered; the current `version: 1` fields do not form a governed compatibility model; the Mod library lives separately in browser-local settings; and image bytes dominate full-store writes.

Friends Alpha also establishes a compatibility floor. Shipping the JSON mechanism and later changing the physical authority would create an avoidable migration for every early user. Independent examination of tldraw offline demonstrates a practical local pattern—SQLite WAL working authority, validated portable transfer, and content-addressed assets—while Eido's own one-writer commit funnel and stable IDs already prepare the domain for transactions.

Near-future Eido requirements increase the value of making this decision now:

- the Mod system is expected to gain richer data-only controls, wires, presets, faces, permissions, layout, and provenance while preserving the template/instance split;
- users should be able to let local AI agents such as Codex and Claude inspect and change Eido through a safe CLI or MCP interface; and
- future semantic/vector search should be possible without turning derived embeddings into irreplaceable user data.

The user must not be required to understand SQLite, copy WAL files, resolve database locks, edit JSON, run migrations, operate a server, or grant agents arbitrary filesystem/database access. The system must remain offline-capable, single-user, secure by default, and autonomously testable by engineering agents.

## Solution

Make SQLite in WAL mode the authoritative record store for each local Eido Profile, owned by Electron main behind one Local Profile Service/Persistence Port. Keep large immutable payloads in content-addressed blobs. Preserve the renderer-facing Board snapshot as a hydration contract rather than exposing the physical database schema. Use explicit Profile, schema, record, asset, app, command, and export versions; stable global IDs; one serialized writer; optimistic revisions; transactionally consistent Intent Log attribution; copy-first migrations; verified recovery; and a separate Portable Export.

Move the app-level Mod library into the Profile as independently versioned template records. Keep stamped Mod instances self-contained on Boards as required by ADR 0022. Reserve optional data-only storage for future Mod controls, wires, presets, faces, permissions, layout, and provenance, without implementing the future Mod UI or executable plugins in this specification.

Add one Local Agent Gateway over the same service. A JSON CLI is the universal contract and a local stdio MCP server is a thin transport adapter. Agents receive capability discovery and consistent snapshots, then submit versioned, allowlisted, optimistic domain-command batches. Commands are validated and applied atomically through Eido's normal mutation, revision, event, and recovery rules. Arbitrary SQL, raw filesystem access, unrestricted JSON Patch, credentials, and raw Electron IPC are never exposed.

At most one process may own mutable Profile authority. If Eido is active, a command must route to that owner; otherwise a headless gateway may acquire the same exclusive ownership. A request that cannot establish safe ownership fails with a stable busy/conflict result and never edits SQLite concurrently.

Vector search is explicitly excluded. The only preparation is an architectural boundary for a future disposable Semantic Index derived from authoritative Profile records. No vector extension, embedding model, vector schema, migration, packaging, or UI enters the Friends Alpha compatibility floor.

## User Stories

1. As an Eido user, I want my Ideas to survive crashes and restarts, so that offline work is trustworthy.
2. As an Eido user, I want acknowledged edits to be durably committed, so that the UI never claims work is saved when it is only in memory.
3. As an Eido user, I want Eido to recover the newest complete revision after interruption, so that a partial write never becomes an empty Board.
4. As an Eido user, I want Eido to preserve a previous-good recovery point, so that corruption does not destroy my only copy.
5. As an Eido user, I want recovery to explain what happened, so that I can choose safely without understanding database internals.
6. As an Eido user, I want a one-click Portable Export, so that I can keep an off-device or manually shared backup.
7. As an Eido user, I want an export to verify its records and assets, so that a successful-looking backup is actually restorable.
8. As an Eido user, I want exports to import into a fresh Profile, so that I can move to another computer.
9. As an Eido user, I want the current pre-Alpha JSON store migrated copy-first, so that the original remains available if migration fails.
10. As an Eido user, I want future app versions to migrate every shipped Alpha format, so that updates do not strand my Ideas.
11. As an Eido user, I want an app that refuses unsupported future data safely, so that an older version cannot silently damage it.
12. As an Eido user, I want large images stored efficiently, so that ordinary edits do not rewrite every image.
13. As an Eido user, I want duplicate image bytes deduplicated without merging their logical identities, so that storage is efficient and Board meaning remains correct.
14. As an Eido user, I want uninstall/reinstall and application updates to preserve my Profile, so that software maintenance does not erase content.
15. As an Eido user, I want offline opening, editing, saving, recovery, export, and agent operations to work without an Eido server, so that local-first remains real.
16. As a Mod creator, I want Mod templates saved across Boards, so that my reusable thinking instruments are not tied to one browser origin.
17. As a Mod creator, I want template IDs and versions to remain stable, so that agents and future marketplace tools can reference them reliably.
18. As a Mod creator, I want future controls, wires, presets, faces, permissions, and layout data to round-trip even before every UI consumes them, so that storage does not force another destructive redesign.
19. As a Mod user, I want stamped Mod instances to remain self-contained on their Board, so that template edits or deletion never change existing work.
20. As a Mod user, I want future Mod data to remain declarative, so that opening a shared Board never executes untrusted code.
21. As a Mod user, I want applied Mod values and definitions preserved with run provenance, so that generated results remain explainable.
22. As a Codex or Claude user, I want to inspect my available Profiles and Ideas through a local command, so that an agent can understand Eido without scraping the UI.
23. As a Codex or Claude user, I want to inspect Cards, Connections, Mods, Outputs, Runs, and provenance as structured data, so that an agent can reason about the graph accurately.
24. As a Codex or Claude user, I want a bounded query interface, so that large Boards do not flood the agent context accidentally.
25. As a Codex or Claude user, I want capability discovery and version information, so that an agent can adapt to the installed Eido version.
26. As a Codex or Claude user, I want to preview an intended command batch before applying it, so that consequential changes can be reviewed.
27. As a Codex or Claude user, I want to create and edit Cards through named domain commands, so that the agent can act on my behalf safely.
28. As a Codex or Claude user, I want to create and change Connections through named domain commands, so that the agent can alter graph meaning without corrupting references.
29. As a Codex or Claude user, I want to inspect, create, update, and stamp Mod templates through named commands, so that agents can help build thinking instruments.
30. As a Codex or Claude user, I want related changes applied atomically, so that half a requested transformation never lands.
31. As a Codex or Claude user, I want stale-revision commands rejected with current revision information, so that the agent can re-read instead of overwriting newer user work.
32. As a Codex or Claude user, I want retries to be idempotent, so that a timeout cannot duplicate Cards, Connections, or Mods.
33. As a Codex or Claude user, I want agent changes attributed in Eido's durable history, so that I can tell what the agent changed and why.
34. As a Codex or Claude user, I want the CLI and MCP tools to produce equivalent results, so that tool choice does not change Eido behavior.
35. As a Codex or Claude user, I want writes to fail safely when another owner is editing, so that concurrent processes cannot corrupt the Profile.
36. As an Eido user, I want the agent interface to require explicit write operations, so that inspection never mutates my work.
37. As an Eido user, I want agent access scoped to the requested Profile or Idea, so that a tool cannot wander through unrelated local files.
38. As an Eido user, I want API credentials and signing secrets excluded from agent results, exports, and diagnostics, so that local automation does not leak them.
39. As an Eido user, I want no local network port merely to support agents, so that the offline app does not gain an unnecessary listening service.
40. As an Eido user, I want a failed or invalid agent command to leave the exact prior revision intact, so that automation errors are reversible operationally.
41. As a developer, I want the renderer, CLI, and MCP adapter to share one Profile service, so that three transports cannot drift into three definitions of Eido.
42. As a developer, I want the physical SQLite schema hidden behind the Persistence Port, so that Board and Mod code can evolve without SQL knowledge.
43. As a developer, I want browser-development and fault-test adapters to preserve the same observable contract, so that most behavior is testable without production data.
44. As a developer, I want every durable record class inventoried with ownership, version, identity, and retention, so that future sync and agents do not guess.
45. As a developer, I want transaction and migration behavior tested under injected failures, so that filesystem success paths are not mistaken for durability.
46. As a release agent, I want packaged Mac and Windows persistence evidence, so that a green unit suite cannot hide native runtime or locking failures.
47. As a release agent, I want the exact candidate tested from current JSON through update, migration, agent change, export, and relaunch, so that certification covers the real user journey.
48. As a release agent, I want the SQLite runtime, schema, and command versions in the release manifest, so that incidents are diagnosable.
49. As a future search developer, I want a disposable Semantic Index boundary, so that embeddings can be added without becoming authoritative Board data.
50. As a future search developer, I want vector implementation deferred to its own specification, so that unresolved model, privacy, native-extension, and UX choices do not contaminate Friends Alpha.

## Implementation Decisions

- The Local Profile Service is the one high-level acceptance seam. Renderer bridge, CLI, MCP, migration tooling, recovery tooling, and release checks call this service rather than reimplementing storage behavior.
- Electron main owns the packaged Profile and SQLite connections. The renderer never receives paths, SQL, database handles, filesystem primitives, or unrestricted IPC.
- SQLite WAL is the production record authority. Foreign keys, defensive mode, bounded busy handling, explicit transaction modes, checkpoint/backup rules, integrity checks, and supported-runtime constraints are recorded and enforced.
- The Persistence Port hides the production engine from renderer/domain callers. Browser-development, in-memory, and fault-test adapters remain available but packaged mode cannot fall back to IndexedDB or Vite middleware.
- Durable records are independently addressable by stable global ID and carry explicit kind, payload/schema version, owning Idea/Profile, logical revision, and timestamps/causal metadata where applicable.
- Evolving Card and Mod payloads may remain versioned validated JSON inside record rows until real query or integrity needs justify dedicated columns. SQLite adoption does not require a premature fully normalized schema.
- Board hydration remains compatible with the current runtime Board meaning. Full-board work is permitted at load, import, export, migration, and explicit checkpoint boundaries, not on typing, dragging, streaming, or animation-frame paths.
- The Intent Log remains an append-only semantic record and live state remains state-first under ADR 0016. SQLite transactions atomically persist the live record changes, logical commit identity, and associated Intent Log events.
- The Profile includes Idea summaries, Board records, the Mod library, approved Profile/device settings, compatibility metadata, migration ledger, and recovery metadata. API credentials remain in OS-protected storage and never enter the Profile.
- The Mod library becomes first-class Profile data. Mod templates and stamped Board instances remain separate identities with separate versioning; stamping deep-copies data and remaps the complete internal ID/reference closure.
- Future Mod fields—controls, wires, presets, faces, permissions, layout, descriptions, and provenance—remain optional, data-only, validator-governed, and round-trip preserving. Unknown future fields are preserved or rejected according to an explicit compatibility policy; they are never silently normalized away.
- Executable Mods, arbitrary scripts, dynamic native extensions from a Board, and remote marketplace code are prohibited.
- Large immutable assets use content-addressed blob files. Logical asset identity remains distinct from the content hash, and Portable Export closure proves every referenced blob is present and correct.
- One mutable Profile owner is enforced with process ownership and database locking. A second mutator either routes to the active owner or fails explicitly; it never relies on last-write-wins.
- Every agent mutation uses a versioned domain command with expected revision, actor identity, client transaction/idempotency key, capability scope, and complete batch validation. There is no raw SQL or generic patch command.
- Initial read capabilities cover Profile status, Idea listing, bounded Board/graph inspection, record lookup, Mod library inspection, revision/compatibility state, and export planning.
- Initial write capabilities cover a deliberately admitted subset of existing Board actions for Card lifecycle/content, Connection lifecycle/meaning, and Mod template/instance operations. The command registry records undo, playback, collection, event, and BoardChange expectations; not every internal store action is automatically exposed.
- CLI commands emit stable JSON on stdout, diagnostics on stderr, stable exit codes, schema/version metadata, and bounded pagination. Human-friendly rendering is an optional view over JSON, not the contract.
- The local MCP server uses stdio and maps tools/resources to the same command registry. It does not listen on TCP, create a localhost HTTP API, or embed a reusable authentication token.
- Inspection is non-mutating. Mutation tools are explicit, support dry-run where meaningful, report affected IDs/revision, and never upload content.
- If the GUI owns the Profile, gateway commands route to that owner through an authenticated local process boundary. If no owner exists, a headless process may acquire exclusive ownership and execute the same service. Unprovable routing/ownership returns a stable busy error.
- The current pre-Alpha JSON store and browser-local Mod library/settings receive a copy-first migration. The migration validates source, creates a new SQLite Profile, verifies logical equivalence and asset closure, and retains the untouched source plus a report.
- Portable Export is independent of the physical database. It contains a versioned manifest, complete logical data, referenced blobs, digests, and compatibility metadata; it excludes WAL files, locks, caches, credentials, and derived indexes.
- Recovery prefers the newest verified complete revision, never a normalized empty Profile. Restore quarantines current state and creates a new highest revision rather than moving history backwards silently.
- Vector search is not implemented. Future embeddings and `sqlite-vec` state belong to a rebuildable Semantic Index sidecar under ADR 0027 and require a separate specification.
- Source remains private. Packaged production code is bundled/minified without source maps or internal docs, while acknowledging that offline client binaries can be reverse engineered and must contain no secrets.
- The SQLite epic is a required producer for Friends Alpha. Exact-build release certification includes its terminal packaged test evidence; #448 retains signing, updater, canary, website, and release-captain ownership.

## Testing Decisions

- Good tests assert user-visible or contract-visible behavior: acknowledged revision, loaded graph, Mod template/instance meaning, Intent Log attribution, export contents, recovery choice, CLI/MCP result, signature/runtime evidence, or explicit failure. Table names and internal statement counts are not acceptance behavior.
- The primary contract suite drives the Local Profile Service with the same command/query fixtures across production SQLite, in-memory, browser-development where applicable, and fault-test adapters.
- A packaged end-to-end suite drives the renderer bridge and CLI/MCP against one disposable Profile and proves they converge on the same observable Board, Mod library, revision, history, and assets.
- Existing save/load compatibility, storage merge, commit-funnel, action-contract, Mod normalizer, Mod library persistence, asset compatibility, and persistence-performance suites are prior art and must remain green or be deliberately superseded with equivalent behavior.
- SQLite tests cover WAL mode, transaction rollback, busy/lock contention, checkpoint, backup, integrity check, process termination, partial/corrupt database combinations, disk full, read-only storage, path/permission errors, and post-write reopen verification.
- Fault tests terminate or fail after each meaningful phase: transaction begin, record writes, Intent Log append, blob creation/flush, commit, checkpoint, backup, promotion, migration step, export write, and read-back verification.
- Concurrency tests interleave GUI commits, agent reads, stale agent writes, duplicate retries, process ownership loss, second instance, update quit, and crash. Exactly one revision wins and rejected work remains inspectable/retryable.
- Migration fixtures cover a scrubbed synthetic current `eido-v3` source, missing/duplicate IDs, malformed/future versions, inline assets, multiple Ideas, active-Idea state, Mod library templates, device settings classification, and interrupted rerun. No private save becomes a fixture.
- Logical-equivalence tests compare source JSON to migrated SQLite hydration without requiring byte-identical ordering. Stable IDs, meaningful order, references, runs, outputs, provenance, Mod instances, and assets are preserved.
- Mod readiness fixtures include old and future-shaped optional controls, wires, presets, faces, permissions, layout, dangling references, unknown kinds, library template versioning, stamping/remapping, and Board portability without the library.
- Agent contract tests cover schema negotiation, capability discovery, pagination, read/write separation, dry-run, optimistic revision rejection, atomic batch rollback, idempotent retry, actor/client transaction attribution, stable errors, bounded output, scope enforcement, and credential/path redaction.
- CLI/MCP parity tests run the same inspection and mutation scenarios through both transports and compare normalized results and final Profile state.
- Security tests prove no arbitrary SQL, filesystem path, raw IPC, environment secret, API key, or network listener is exposed. Fuzz malformed command payloads and oversized input within defined limits.
- Agent command coverage is explicit: every public command maps to declared mutation/event/undo/playback expectations, while every non-public internal action remains unreachable through the gateway.
- Portable Export tests verify full logical closure, blob digests, deterministic manifest rules, fresh-Profile import, future-version refusal, tamper detection, and exclusion of WAL/locks/caches/credentials/derived indexes.
- Performance evidence records commit latency, checkpoint/backup time, cold/warm load, migration, export/import, agent query/mutation latency, database/blob size, and write amplification for smoke, medium, large, and image-heavy fixtures.
- Mac Apple Silicon and Windows x64 packaged tests cover clean install, current-JSON migration, create/edit/restart, immediate-edit update flush, crash recovery, export/import, CLI inspection, CLI mutation, MCP parity, Unicode/long paths, second-owner contention, uninstall/reinstall, and offline relaunch.
- Release evidence records exact source SHA, runtime/SQLite versions, schema/command/export versions, artifact hashes, test fixture versions, and the exact signed candidates tested. A rebuild invalidates the evidence.

## Out of Scope

- Vector embeddings, `sqlite-vec` integration, vector schema/tables, embedding models, KNN queries, semantic-search UI, or Semantic Index packaging. These require a future specification under ADR 0027.
- Implementing the redesigned Mod workbench, new control renderers, wires UI, presets UI, faces, permissions UI, marketplace, or sharing. This spec prepares durable data and agent contracts only.
- Executable Mods, user-provided JavaScript, dynamic plugins, untrusted native extensions, or remote code loading.
- Arbitrary SQL, raw database files as an API, generic JSON Patch, unrestricted filesystem access, or exposing the physical schema as the agent contract.
- Remote MCP, localhost HTTP/TCP servers, LAN control, account-based agents, cloud mediation, or unattended remote access.
- Cloud storage, multiplayer, sync protocol, server ordering, CRDTs, accounts, or Eido-hosted databases.
- Making the Intent Log the runtime source of truth, persisting the undo ring, or changing one-graph semantics.
- Selecting or changing #410's renderer architecture, cold-data strategy, image rendition lifecycle, or canvas behavior.
- Custom at-rest encryption. Profile records rely on OS account/disk security for Friends Alpha; credentials remain OS-protected separately.
- User-facing direct editing of SQLite, database administration tools, or requiring users/founder to understand recovery internals.
- General-availability support, billing, licensing enforcement, or true binary download access control.

## Further Notes

- ADR 0025 supersedes ADR 0004's deferred production record-store choice while retaining its records-and-blobs direction.
- ADR 0026 extends ADR 0006 from engineering agents consuming contracts to product agents safely inspecting and changing user-authorized local Eido data.
- ADR 0027 is a backlog boundary, not authorization to add a vector dependency during this epic.
- ADR 0016 remains binding: live state is state-first, the Intent Log is the durable semantic record, and all mutations pass through one funnel. The Profile Service must preserve that meaning rather than inventing SQL-side mutation semantics.
- ADR 0022 remains binding: Mods are declarative data; templates are app/Profile-level; Board instances are frozen self-contained stamps; library edits do not mutate existing instances.
- The current action-contract inventory is useful prior art but is not automatically safe for external exposure. Public agent commands are a deliberately smaller, versioned product API.
- Package/lockfile, Node/Electron runtime, shared workflows, Board hydration, asset contracts, and release-policy edits remain serialized hotspots coordinated with #408/#410/#448.
- SQLite and Agent Gateway implementation may begin with contracts, fixtures, schema prototypes, and pure tests. Native runtime/package changes wait for the protected Node/Electron dependency boundary already recorded by #448.
- The public binary repository never exposes the private source repository. Production bundles omit source maps/internal docs, but offline JavaScript remains inspectable and must not contain secrets.

### Primary references

- tldraw offline production audit: `research/05-production-release/10-tldraw-offline-benchmark-synthesis.md`
- Mod redesign research: https://github.com/limweili/eido/pull/442
- Friends Alpha spec: https://github.com/limweili/eido/issues/448
- Node SQLite API: https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
- SQLite atomic commit: https://www.sqlite.org/atomiccommit.html
- SQLite WAL: https://www.sqlite.org/wal.html
- Model Context Protocol specification: https://modelcontextprotocol.io/specification/
- Deferred `sqlite-vec` candidate: https://github.com/asg017/sqlite-vec
