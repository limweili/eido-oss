# Eido Friends Alpha: storage, migration, and recovery pressure test

Date: 2026-07-16

Scope: local-only desktop persistence for a small Friends Alpha; no private Eido save was opened, copied, or modified.

## Verdict

The current whole-file JSON store is **not safe enough to ship as the only copy of a friend's work**. The proposed local-first desktop direction is practical, but only after the persistence boundary becomes a single-writer, fail-closed subsystem with durable commits, recovery generations, versioned migrations, and a lossless export path.

The smallest realistic production design is **not a full SQLite rewrite**. It is:

1. one Electron main-process **Persistence Engine** that serializes every mutation;
2. a strictly versioned JSON metadata snapshot with verified previous-good and scheduled recovery generations;
3. content-addressed immutable blob files for images and other large assets;
4. copy-first, roll-forward migrations with no automatic downgrade writes;
5. a visible recovery flow that never silently substitutes an empty store;
6. synthetic crash, concurrency, migration, and 85 MB-profile tests on macOS and Windows.

That design is viable for a small Friends Alpha because Eido's measured non-image payload is still 11.89 MB, below the repository's existing 25 MB normalization trigger. The existing 84.67 MB image-heavy save, of which 72.77 MB is image data URLs, means the **asset blob split is now a release prerequisite**, not an indefinite optimization. See [Eido's persistence payload baseline](../03-performance-architecture/11-persistence-payload-baseline.md) and [ADR 0004](../../docs/adr/0004-hybrid-storage-now-records-and-blobs-later.md).

SQLite remains the right likely destination for individually addressable graph records and the event journal, but adopting it before the Friends Alpha would add native-module packaging, schema, backup, and recovery work without removing the need for blobs, migrations, backups, or recovery UX.

## Research method and limits

This review uses only sources owned by the relevant projects: Eido source and ADRs, Node and Electron documentation, SQLite's own documentation, Joplin source/docs, VS Code source, and upstream project issue reports. Issue reports are evidence that a failure happened and that recovery UX matters; they are not estimates of incident frequency.

No storage design is literally bulletproof. Local-only software cannot protect against loss of the entire disk, ransomware, theft, or a user deleting both the active profile and backups on that disk. The product must say this plainly and provide lossless export plus an optional user-chosen backup destination.

## What Eido does today

### Useful foundations

- `src/graph/save.ts` already exposes an `IdeaStore` interface. That is the natural seam to deepen rather than adding a second persistence abstraction.
- `scripts/vite/storagePlugin.ts:145-151` writes a unique temporary file and renames it over the active file. This avoids exposing a partially serialized JSON document during an ordinary process-level failure.
- The save-file SOP already requires copy-first migrations, scrubbed fixtures, verified backups, and preservation of cards, connections, outputs, runs, intent logs, assets, and metadata.
- ADR 0004 already rejects keeping all data forever in one large JSON payload and prepares records plus blobs.

### Release-blocking gaps

1. **The write is not durable.** At the review point Eido and its #410 benchmark workflows use Node 20; the release program moves to Node 22.12+ only after the protected #408 evidence boundary. Under either runtime, `writeStore` uses `fs.writeFile(..., 'utf8')` and then `rename` without establishing durable commit semantics. Node 20 documents that `writeFile` defaults `flush` to `false`; `flush: true` is what invokes `fsync`. Node also does not describe `rename` as a durable transaction. The current code therefore cannot claim that a reported save survived sudden power loss. [Node 20 `writeFile` documentation](https://nodejs.org/docs/latest-v20.x/api/fs.html#fspromiseswritefilefile-data-options)

2. **Writes are not serialized.** Each mutation reads the whole store, awaits, changes its private copy, and writes the whole store. Two overlapping calls can both read revision N and commit different N+1 snapshots; the last completion wins, even if it contains older user intent. Node explicitly warns that promise filesystem operations are not synchronized or thread-safe and that concurrent modification can corrupt data. [Node filesystem promise warning](https://nodejs.org/docs/latest-v20.x/api/fs.html#promises-api)

3. **The debouncer can forget failed work and can complete out of order.** `makeDebouncedSaver` clears `latest` before awaiting the save and catches the error without re-queueing that exact snapshot. A second timer can also start another save while the first is in flight. A stale first save that finishes last can overwrite a newer save.

4. **Normal loading silently drops data.** `normalizeStore` filters out an Idea when either the summary or Board does not validate, reconstructs `boards` only from survivors, and always returns `version: 1`. A damaged or future-version object can therefore appear as a smaller valid store and be persisted over the only complete copy. Salvage belongs in an explicit import/recovery path, not the normal production load path.

5. **There is no migration registry or future-version refusal.** The literal version remains `1`; no ordered migrations, minimum reader/writer version, migration journal, or downgrade guard exists.

6. **The whole-file write amplification is already material.** Eido's deterministic large fixture is 15.9 MB and its image-heavy reference save is 84.67 MB. Every debounced save rewrites the full payload. Base64 itself maps each 3 input bytes to 4 encoded characters, before JSON overhead. [RFC 4648, Base64 encoding](https://www.rfc-editor.org/rfc/rfc4648.html#section-4)

7. **A same-disk temporary file is not a backup.** It helps an interrupted write but not logical deletion, bad migrations, filesystem damage, disk loss, or a valid-but-wrong application write.

## What production projects actually do

| Project/source | Production pattern | Lesson for Eido |
| --- | --- | --- |
| Electron | `requestSingleInstanceLock()` lets a primary app reject another instance. [Official API](https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata) | Use it, but also serialize writes inside the primary process; the process lock alone does not prevent overlapping async commits. |
| VS Code | Electron main is the owner of storage connections. Its SQLite layer retries `SQLITE_BUSY`, checks integrity, creates a backup after a clean close, and attempts backup recovery. [Main-process ownership](https://github.com/microsoft/vscode/blob/a0f557bab71daa15048f8a856f4b2518c04aed8e/src/vs/platform/storage/electron-main/storageMain.ts#L40-L72), [backup and recovery implementation](https://github.com/microsoft/vscode/blob/a0f557bab71daa15048f8a856f4b2518c04aed8e/src/vs/base/parts/storage/node/storage.ts#L175-L355) | A database library is not the recovery design. Ownership, integrity checks, backups, and explicit error paths still have to be built. Eido data is more valuable than VS Code's rebuildable UI state, so corrupt originals must be quarantined, never deleted. |
| VS Code incident | A verified corruption bug fell back to memory and bypassed the expected recovery path; the fix changed recovery behavior. [microsoft/vscode#93428](https://github.com/microsoft/vscode/issues/93428) | “Keep the app open” fallback behavior can itself prevent recovery. Eido must show a recovery state and must not let an empty/in-memory fallback overwrite disk. |
| Joplin | A self-contained local profile uses `database.sqlite` for notes/metadata, a separate hash-named `resources/` directory for attachments, and a profile lock. [Official profile documentation](https://joplinapp.org/help/dev/spec/user_profile/) Its desktop startup creates the resources directory and opens the SQLite database. [Source](https://github.com/laurent22/joplin/blob/54b8e697509b399dc83ffd2d77841d950299fb70/packages/lib/BaseApplication.ts#L738-L812) | Separating queryable records from immutable assets is a proven offline-first desktop shape. Backups must cover the complete profile, not just metadata. |
| Joplin migrations | Joplin keeps a database version, applies ordered migrations transactionally, and refuses an unknown profile version that indicates an older app opening newer data. [Migration implementation](https://github.com/laurent22/joplin/blob/54b8e697509b399dc83ffd2d77841d950299fb70/packages/lib/JoplinDatabase.ts#L386-L415), [transaction and version update](https://github.com/laurent22/joplin/blob/54b8e697509b399dc83ffd2d77841d950299fb70/packages/lib/JoplinDatabase.ts#L962-L994) | Schema versioning and downgrade refusal are ordinary production requirements, not enterprise over-engineering. |
| Joplin export | JEX is a lossless, re-importable archive containing notes and metadata. [Official import/export documentation](https://joplinapp.org/help/apps/import_export/) | Eido needs a storage-independent portable export. Copying implementation files is not the user-facing recovery contract. |
| Codex upstream incident report | A corrupt/truncated local SQLite file can block startup even when rebuildable JSONL data remains; the report proposes quarantining the DB and distinguishing corruption from lock, permission, and migration errors. [openai/codex#21750](https://github.com/openai/codex/issues/21750) | Never treat every open failure as corruption, never delete forensic evidence, and put recovery at the single open boundary. |

## Why “just use SQLite” is not enough

SQLite is much more crash-tested than a custom JSON transaction layer. Its rollback journal and WAL are explicitly designed so interrupted transactions appear atomic across application crashes, OS crashes, and power loss. [SQLite atomic commit](https://www.sqlite.org/atomiccommit.html)

It still has operating constraints:

- WAL requires one host and shared memory; it does not work over a network filesystem. Only one WAL writer exists at a time. [WAL constraints and concurrency](https://www.sqlite.org/wal.html)
- The WAL and shared-memory sidecars are persistent database state. Separating a live database from its WAL can lose committed transactions or corrupt the database. [WAL file lifecycle](https://www.sqlite.org/wal.html#the_wal_file)
- Copying a live database file can capture mixed old/new pages. Safe online backups use SQLite's backup API or `VACUUM INTO`; raw copying is safe only while no transaction is active and journal sidecars are handled correctly. [SQLite corruption guide](https://www.sqlite.org/howtocorrupt.html#_backup_or_restore_while_a_transaction_is_active)
- SQLite warns that broken locks, direct file access around open connections, multiple linked copies of SQLite, disabled sync, or faulty storage can still corrupt data. [SQLite corruption guide](https://www.sqlite.org/howtocorrupt.html)
- A WAL-reset race affected versions through 3.51.2 and was fixed in 3.51.3, with backports to 3.50.7 and 3.44.6. [Official WAL-reset notice](https://www.sqlite.org/wal.html#the_wal_reset_bug)

If Eido later adopts SQLite, the release must record and test the exact bundled SQLite version, use a release containing the WAL-reset fix, keep one SQLite implementation and one main-process owner, use `synchronous=FULL`, use WAL only on a local profile directory, and back up through SQLite APIs. The native Node/Electron binding and ABI rebuild also become part of every packaged release, which is a practical reason not to pull this work into the first Friends Alpha without a measured need.

## Adversarial failure analysis

| Failure | What happens today | Required Alpha behavior |
| --- | --- | --- |
| Two saves overlap | Both may read the same old file; completion order decides what survives. | One commit queue with a monotonic revision. Coalesce only snapshots that have not started; never allow two persistence commits in flight. |
| Save fails after the debouncer clears its snapshot | UI says failed, but the exact dirty snapshot is no longer owned by the saver. | Retain dirty state until verified commit. Retry that state; newer state may supersede it only explicitly. Block quit/update or obtain informed confirmation while dirty. |
| Power fails after temp write but before durable metadata update | The active file may remain old, and the temp file may not be durable. | Flush candidate data, verify it, preserve a previous-good generation, atomically promote, then read back. Recovery selects the highest fully verified generation. |
| Disk fills mid-save | Temp or backup write fails; current code has no space preflight or recovery UX. | Compute operation-specific required bytes, check available space, leave active generation untouched, retain dirty memory state, and show an actionable “storage full; not saved” state. Never delete backups to make an in-flight commit look successful. |
| Antivirus/indexer temporarily holds a file on Windows | Rename can fail with transient access/busy errors. | Bounded retry with backoff for known transient errors; on exhaustion, keep dirty state and preserve candidate for diagnosis. Test on packaged Windows, not only Linux CI. |
| External editor or sync tool changes the file | Next whole-file write can silently overwrite the external change. | Compare file identity/revision/hash before commit. On mismatch, stop writes and offer explicit import-as-copy/reload; never merge opaque JSON automatically. Do not support profile directories on network/sync filesystems in Alpha. |
| Future app writes schema N+1, then older app opens it | Current normalization can turn it into version 1 and discard unknown data. | `minReaderVersion`/`minWriterVersion` gate. An old app opens read-only for export or refuses safely; it never writes. |
| Migration crashes halfway | No registry or resume state exists. | Migrate a verified copy, never the active file. Only swap after complete validation. Original and pre-migration backup remain. Migrations are ordered, deterministic, and idempotent. |
| Corrupt JSON still parses partially or one Board fails validation | Normalization silently omits Ideas/Boards. | Normal open is strict and fail-closed. Quarantine corrupt input and enter recovery. Salvage is a separate explicit import that reports every retained/rejected item. |
| Valid application bug deletes content | Checksums still match the bad snapshot. | Semantic invariants and before/after counts/hashes for migration; previous-good plus time-separated snapshots; visible restore preview. Checksums alone are not correctness. |
| App binary auto-rolls back after a data migration | Older binary may not understand or may overwrite the new schema. | No automatic data downgrade. Binary rollback is safe before migration; afterward restore the pre-migration generation explicitly or roll forward with a fixed build. |
| Active disk dies, is stolen, or encrypted by ransomware | Same-disk active file and recovery generations disappear together. | Honest limitation, one-click verified portable export, optional backup folder on another volume or user-managed sync/backup system, and a reminder until one successful external backup exists. |

## Smallest viable Friends Alpha architecture

### One deep module

Deepen the existing `IdeaStore` seam into one **Persistence Engine**. Its renderer-facing interface should express user intent—load, commit, flush, inspect health, export, list recovery points, restore—not paths or filesystem primitives. The Electron main-process adapter owns the profile path and all disk access; preload exposes a narrow typed bridge. Browser tests use an in-memory/fault-injecting adapter at the same seam.

This creates leverage: migration policy, durability, backups, diagnostics, and later SQLite adoption remain local to one module. The renderer should continue to receive the existing `SavedBoard` shape during the Alpha so storage work does not redesign graph or rendering semantics.

### Versioned envelope

The durable metadata needs, at minimum:

- a format identifier;
- `schemaVersion` plus minimum reader and writer versions;
- a monotonic commit revision;
- writing app version and UTC timestamp;
- a payload digest;
- the complete logical Board/Idea data or references to independently durable records/blobs.

Unknown newer schema versions are not normalized. They produce a distinct unsupported-version state. Unknown fields in a compatible version must be preserved unless a migration explicitly owns their removal.

### Single commit funnel

Every create, save, rename, delete, import, migration, restore, and active-Idea change goes through one queue. A commit is successful only after this sequence:

1. acquire the in-process writer lease and verify the expected active revision/hash;
2. validate the complete candidate in memory;
3. calculate required free space for candidate, new blobs, and required backup work;
4. write any new immutable blobs first, each to a same-directory temp, flush, verify its SHA-256, and promote it;
5. serialize metadata to a unique same-directory candidate and write with a durable flush;
6. re-read the candidate and run strict structural plus semantic validation;
7. create and verify the previous-good recovery generation without removing the active generation;
8. rename the verified candidate over the active metadata and use the strongest directory-sync operation each supported OS permits;
9. re-read the active metadata and confirm revision, digest, and referenced blobs;
10. only then report `saved` and release the dirty snapshot.

Unexpected temp files are inspected at next startup. A fully valid, higher revision can be offered as recovery; invalid or ambiguous files are quarantined. Cleanup never deletes the active, previous-good, pre-migration, or newest valid candidate.

### Two locks, because they solve different races

- Electron's single-instance lock prevents a second packaged Eido process from owning the same default profile.
- The Persistence Engine's queue prevents overlapping writes inside the primary process.

The profile also carries a diagnostic lock/owner marker so a crash or manual second build produces a clear lock-contention error instead of an empty app. A stale marker is not itself authority to overwrite; OS/process state and the active revision still decide.

## Assets must leave the whole JSON snapshot before Alpha

This is the largest correction to a “ship JSON first” plan. Eido's own reference profile is 84.67 MB, but only 11.89 MB after image payloads are stripped. The current save has already crossed the 25 MB trigger in `11-persistence-payload-baseline.md`.

Use content-addressed immutable blobs:

- identifier: SHA-256 of the authoritative bytes;
- write and verify a blob before a metadata commit references it;
- never mutate a blob in place;
- keep display renditions derived, consistent with [ADR 0024](../../docs/adr/0024-image-renditions-are-derived-and-visibility-aware.md);
- initially hydrate the existing `SavedBoard`/data-URL contract at the adapter boundary if that is necessary to avoid coupling storage delivery to active rendering work;
- keep full-board import/export lossless by packaging metadata plus every referenced blob;
- garbage-collect only after no active metadata, recovery generation, export-in-progress, or pre-migration backup references the blob.

The existing inline-to-blob migration must first make a verified full backup, extract and hash every asset, prove byte-for-byte round trips, compare Idea/Card/connection/output/run/intent counts, write a new candidate profile, and only then switch the active pointer. The pre-migration backup is never automatically deleted.

The payload-transparent blob split may proceed without waiting for [#410](https://github.com/limweili/eido/issues/410), provided it preserves `SavedBoard` and does not select runtime rendition or cold-loading architecture. [#409](https://github.com/limweili/eido/issues/409) defines the production sequence and gates; packaged load, IPC, hydration, and renderer calibration wait until #409 closes **and every release-blocking production slice it creates has landed**. If #408 explicitly selects no cold-data change, no cold-data implementation slice is required.

## Recovery policy

Three recovery classes solve different problems:

1. **Previous-good generation:** one verified predecessor to survive interrupted or immediately bad commits.
2. **Time-separated local snapshots:** recommended Alpha default is seven daily and four weekly metadata generations. Because immutable blobs are shared and deduplicated, these snapshots need not duplicate image bytes. This retention count is an Eido product default, not an industry guarantee.
3. **Pre-migration backups:** full, timestamped, verified, and never auto-deleted under the existing SOP.

Rules:

- snapshot only a verified committed revision, at most once per period;
- never prune the only previous-good generation or a pre-migration backup;
- prune metadata before unreferenced blobs, and calculate blob reachability across every retained generation;
- display timestamp, app/schema version, Idea/Card counts, byte size, and validation status before restore;
- restore by quarantining the current generation and committing the selected recovery point as a new highest revision—never by destructively overwriting both;
- produce a redacted health report containing versions, counts, sizes, error classes, and hashes, never Card text, prompts, API keys, private paths, or asset bytes.

Local snapshots do not protect against disk loss. The Friends Alpha should include a lossless one-click export and optional external backup-folder selection. The app can coach the founder/friend to make the first verified external export; it should not imply same-disk snapshots are disaster recovery.

## Migration and app-update contract

The Friends Alpha compatibility floor is the current pre-Alpha
`~/.eido/eido-v3-ideas.json` shape captured at cutover as scrubbed synthetic
data. Eido provides one verified, copy-first migration from that supported
source into Alpha v1. Removed v1/v2 and unidentified abandoned prototype
formats are outside the support promise and are never silently normalized.
Every format actually shipped from Alpha v1 onward retains a forward migration
path, including skipped-release upgrades.

1. Each schema version has exactly one ordered migration path; no ad hoc normalization on open.
2. A migration starts only after the writer queue is flushed and the active revision is verified.
3. It operates on a copy or a new generation and records source version, target version, source digest, and migration status.
4. It validates structural invariants, stable IDs, entity counts, asset hashes, and required product data before promotion.
5. Failure preserves the source, failed candidate, and diagnostic state; it never opens an empty store as if startup succeeded.
6. Re-running after interruption is deterministic and safe.
7. Destructive transformations use expand/contract across releases where feasible: a release first reads old and writes compatible new data; a later release removes old fields only after the supported rollback window.
8. There are no automatic down-migrations. An older app seeing a newer `minWriterVersion` is read-only or refuses with export/reinstall guidance.
9. The updater must not install/restart while dirty. It requests a verified flush and pre-migration recovery point first.

“Rollback” therefore means two different things:

- **Before a schema migration:** reinstalling the prior signed binary is safe.
- **After a schema migration:** prefer roll-forward with a fixed build. If that is impossible, quarantine the current profile and explicitly restore the pre-migration generation, warning that post-migration edits will not appear in the restored copy.

## Explicit thresholds

Use the thresholds already established by Eido rather than inventing a second set:

| Signal | Decision |
| --- | --- |
| Total single JSON snapshot exceeds about **25 MB** | Split the dominant payload before production. The current 84.67 MB image-heavy profile has already tripped this; blob extraction is required. |
| Serialization exceeds about **50 ms** | Begin the records/event-journal migration; the existing test may retain its 120 ms unflaky assertion, but 50 ms is the investigation threshold. |
| Intent log exceeds **5×** Board content | Move history to an event journal with checkpoints and references rather than cloning full records. |
| Save debounce visibly contends with AI streaming or drops frames | Treat as a migration trigger even if byte/time thresholds have not yet fired. |
| Non-blob metadata remains below 25 MB, serialization below 50 ms, and one writer is sufficient | Hardened JSON metadata plus immutable blobs remains acceptable for the Friends Alpha. |
| Any need for partial record loading/querying, sustained incremental writes, multiple legitimate writers, or threshold breach after blob extraction | Adopt SQLite/record storage behind the same Persistence Engine; do not expose it to renderer callers. |

Thresholds are migration triggers, not user-data caps. Eido must not reject or truncate a large Board merely to pass a budget.

## SQLite adoption contract, when triggered

If the later records/event-journal work selects SQLite:

- ship one exact SQLite implementation and record `sqlite_version()` in redacted diagnostics;
- require a version with the WAL-reset fix (at least 3.51.3, 3.50.7, or 3.44.6; prefer the current patched supported release at implementation time);
- keep one main-process owner and avoid direct file reads/copies while connections are open;
- enable foreign keys, a bounded busy timeout, and `synchronous=FULL`;
- use WAL only for a verified local filesystem profile and preserve `-wal`/`-shm` state correctly;
- use `quick_check` for routine health where proportionate and full `integrity_check` plus foreign-key checks before/after migration or during recovery; [SQLite integrity checks](https://www.sqlite.org/pragma.html#pragma_integrity_check)
- create online backups only through the backup API or `VACUUM INTO`;
- keep large immutable assets outside SQLite, as Joplin does, with transactional metadata references;
- package and smoke-test the native binding against each Electron ABI on macOS and Windows.

## Alpha release gates for storage

The release is no-go until all of these are automated or rehearsed with recorded evidence:

### Compatibility fixtures

- one small scrubbed synthetic fixture for the supported pre-Alpha eido-v3
  cutover format, Alpha v1, and every subsequently shipped Alpha storage version;
- no fixture or compatibility promise for removed or unidentified abandoned
  prototype formats;
- future-version, malformed JSON, structurally valid but semantically invalid, missing blob, duplicate ID, and permission-denied fixtures;
- a deterministic image-heavy fixture matching or exceeding the measured 84.67 MB profile shape without using private data;
- round-trip export/import equality for Ideas, Cards, connections, outputs, runs, intent logs, settings, and asset hashes.

### Fault injection

Inject failure or process termination after every meaningful filesystem phase: blob write, blob flush, metadata write, validation, backup, promotion, directory sync, and read-back. After every restart, the invariant is: **the newest complete verified revision or the previous complete verified revision loads; never an empty normalized store and never a mixed revision**.

Include disk-full, read-only directory, transient `EBUSY`/`EPERM`, corrupt temp, active corruption plus valid backup, and backup corruption plus valid active cases.

### Concurrency and lifecycle

- overlapping save/rename/delete/import operations preserve queue order and monotonic revisions;
- a newer snapshot cannot be overwritten by an older in-flight commit;
- save failure retains dirty state and exact retryable content;
- quit, renderer crash, forced main-process kill, and updater restart preserve the invariant;
- a second Electron instance cannot write the profile;
- external file modification causes a safe conflict state rather than overwrite.

### Migration and rollback rehearsal

- install N, create fixture data, update to N+1, migrate, validate, edit, and restart on packaged macOS and Windows builds;
- kill the process at each migration phase and prove idempotent recovery;
- open N against N+1 data and prove it cannot write;
- rehearse restore of a pre-migration generation and prove the abandoned current generation remains quarantined;
- restore a portable export into a fresh profile and compare counts and hashes.

### Performance and operational evidence

- report metadata bytes, blob bytes, serialization time, durable commit time, recovery time, and export/restore time for smoke, medium, large, and image-heavy fixtures;
- apply Eido's 25 MB / 50 ms / 5× triggers in CI reports;
- run packaged storage tests on both supported operating systems because Windows rename/locking behavior is a practical release risk;
- have one named Apple Silicon canary and one named Windows x64 canary complete update, forced interruption, recovery preview, export, and fresh-profile restore before the coupled Alpha launches.

## Practical sequencing and parallel boundaries

The work can be split for a fleet without creating competing storage seams:

1. **Compatibility characterization:** freeze scrubbed v1 and adversarial fixtures; specify invariants and redacted health report.
2. **Commit engine:** single writer, revision envelope, durable candidate/promotion protocol, dirty-state semantics, and fault-injecting filesystem adapter.
3. **Recovery surface:** previous-good/time snapshots, health inspection, restore-as-new-revision, and founder-facing recovery language.
4. **Asset adapter:** content-addressed blobs, inline compatibility hydration, migration, reachability, and lossless export packaging.
5. **Electron adapter:** main/preload ownership, single-instance lock, packaged profile path, quit/update flush contract.
6. **Update compatibility:** migration registry, future-version refusal, pre-migration generation, N-to-N+1 and rollback rehearsal.

Lanes 1 and the UI design portion of 3 can begin immediately. The commit engine owns the persistence seam and should land before asset and Electron adapters bind to it. Asset storage can preserve the runtime `SavedBoard` shape, so it need not block on #410. Packaged load and hydration calibration wait for #409 plus every release-blocking production slice it generates. Package manifests, lockfile, Node configuration, shared workflows, storage/graph contracts, Board Scene files, and performance harnesses are cross-epic merge hotspots. The Node 22.12+ transition cannot land until #408 closes. Persistence owns on-disk blobs; #410 owns runtime renditions and residency. Agents must declare file/seam ownership and serialize shared `SavedBoard`, asset, or hydration changes before editing them.

## Final recommendation to the release spec

Adopt **hardened versioned JSON metadata + content-addressed blobs for Friends Alpha**, behind the existing `IdeaStore` seam and owned by Electron main. Make strict no-silent-loss behavior, verified recovery generations, asset extraction, migration rehearsal, and fault testing release blockers. Defer SQLite until Eido's established metadata/serialization/history triggers fire after the blob split, but record the SQLite adoption contract now so the current interface does not obstruct it.

This is more feasible than a database rewrite and materially safer than temp-plus-rename. The fixed Friends Alpha matrix is Apple Silicon macOS plus Windows x64 on the same day. The founder supplies the two coached publisher identities, nominates one real-device canary per platform, approves the bounded native-release budget, and participates only in the final plain-language GO/NO-GO. Agents own storage implementation, fixtures, gates, diagnostics, release evidence, and routine recovery coaching.
