# Agent CLI delivery retro

Short, live notes from implementing epic #711. Keep only lessons that should
change the next slice.

## Working well

- Land narrow domain seams first. Authorship, history, live apply, and spatial
  kernels each became stable inputs for later transport and CLI work.
- Split parallel work by owned files and authoritative seams. Pure graph and
  execution-policy modules progressed safely while the live Gateway serialized
  the shared Electron integration path.
- Reuse proof at its owning seam. Broad Profile and Gateway suites catch more
  useful risk than duplicating transport-specific semantic tests.
- Keep delegated-run admission app-scoped as well as session-scoped. A caller
  can rotate session IDs, so the durable safety boundary cannot trust one
  process-local label as the whole quota.

## Friction

- ADR filenames and research numbering can drift or collide even when their
  decisions are sound. Resolve by decision identity, then repair navigation.
- Shared-file ownership is the real parallelism limit. Hunk-level coordination
  costs more than giving one lane the whole integration seam.
- Native peer identity is not exposed by Node's public socket API, so the live
  endpoint needed a small platform helper rather than a TypeScript-only design.
- A genuinely fast packaged CLI needs its own Node SEA entrypoint. Routing a
  nominal shim through Electron still pays the startup cost the shim exists to
  remove.
- Main-process scheduler flushes do not quiesce renderer-owned persistence.
  Live Agent admission needs an explicit renderer authority barrier, with a
  regression proving queued user work and the Agent commit both survive.
- Attribution identifies provenance, not a transaction. Delegated Run artifact
  projection must correlate to the admitted plan and concrete engine outcomes;
  serialization closes the remaining failed-step ambiguity.
- Surface v3 exposed a durable SQLite `CHECK` constraint. The owner explicitly
  approved widening it after the downgrade risk was flagged: the migration
  atomically rebuilds and exact-compares parent/child evidence, but once a v3
  event is written an older `{1,2}` reader cannot open that Profile.
- Adapter availability was implicit in certification counts. Registry-owned
  metadata now keeps MCP at its historical seven tools while ergonomic Agent
  discovery can grow without creating another semantic allowlist.
- Package assembly and deep bundle verification did not execute arbitrary
  `Resources/bin` code. The unsigned ARM64 SEA therefore passed until the real
  packaged command exited `137`; the owning proof now verifies and executes
  both nested code objects directly.
- The zero-context pass caught two contract drifts that source tests did not:
  generated idempotency keys were described as mandatory, and the surface-v3
  downgrade edge lived only in repository docs rather than installed help.
- Barrier tests covered queued durable commits but missed `persist:false`
  delegated-stream progress; one store+persistence integration test exposed
  the stale-held-state race and now preserves chunks across live Agent apply.
- Authorship crossed more public seams than the shared Card shell: Title,
  painted Map/Overview representations, structural edits, membership, and
  duplicate/paste each needed direct acceptance evidence.
- Renderer adoption and native attribution were independent derivations. A
  parity matrix for no-ops, Group membership, layer normalization, and
  delete/undo caught every case where the accent would otherwise rebound on
  reload; newly appended historical snapshots also needed native stamp
  normalization before they could become trusted revival evidence.
- The current attribution rule initially leaked into historical Agent replay.
  Full SQLite audits forced an explicit semantic-generation seam: v3 owns the
  corrected Group/order meaning while persisted v1/v2 retain their original
  ordinal-sensitive evidence.
- Endpoint-only lifecycle validation looked safer but rejected the renderer's
  intentional queued create→delete coalescing. Trust checks must account for
  the admitted event suffix, not assume every UI transition reached native
  state as its own revision.
- Build-plan inspection was not package compatibility proof. Executing and
  inspecting every nested Mach-O found both the helper's host-default target
  and a product-contract mismatch: Node 24 makes the packaged CLI require
  macOS 13.5. Founder direction raised the Friends Alpha floor to 13.5, so the
  production bundle metadata, certification, runbook, and public download copy
  now tell one truth while the helper keeps its valid lower deployment target.
- The final branch had to compose fourteen newer `main` commits across eleven
  semantic conflicts. Splitting the already interwoven epic into ticket PRs at
  that point would have multiplied the same keychain/update/Agent resolutions;
  one reviewed integration merge kept the conflict proof reusable.
- A local packaged smoke on an ordinary macOS account stopped at the system
  Keychain prompt because a newly ad-hoc-signed proof build shares the
  host-global `Eido Safe Storage` item. The disposable Profile root cannot
  isolate that credential boundary, so the run did not access or rewrite the
  Keychain; the hosted ephemeral-OS-user job remains authoritative.
- Run bundle checks from a fresh production build, not the desktop-proof
  package output. The fixed epic base had already consumed 448.1 of the old
  450 KiB total cap; removing redundant renderer response decoding helped,
  but deleting the entire delegated-run renderer path would still fail. A
  measured 465 KiB recalibration preserved the ADR-owned trust seam on that
  base. After current `main` independently grew to 460.0 KiB, the integrated
  bundle measured 471.8 KiB; a sourcemap comparison found the 11.8 KiB delta
  entirely in the required Agent/live-authority modules. Recalibrating to
  478 KiB preserves the same ~1.3% guard instead of distorting the architecture
  for stale margin.
- A generic three-way array merge was not enough for append-only Intent: the
  native prefix must stay first, while held timestamps and sequence numbers
  need rebasing after the Agent tail. Likewise, undo conflict detection needs
  the raw authority transition because the held-visible merge can hide it.
- Apple `otool` treats parenthesized Electron helper names as archive-member
  syntax. Running the new all-Mach-O gate against a real bundle caught that;
  `vtool -show-build` is the reliable deployment-target reader here.
- Re-reading checkbox-level issue acceptance before close found two proof gaps:
  PATH resolution had not run from an unrelated cwd on both native hosts, and
  Windows socket security had only source assertions. Closeout auditing should
  happen before the first PR push, not after merge.
- A source-order NSIS test said “owned cleanup” without proving ownership: an
  already-present user PATH entry was marked as Eido-owned and would be removed
  on uninstall. The native lifecycle proof now seeds that case and requires it
  to survive, while command resolution must identify the packaged executable.
- Immer represents some user add/delete actions as whole-collection replaces.
  Those patches cannot safely rebase across Agent authority—even a change in a
  related collection can leave dangling closure—so they retire conservatively.
- The macOS offer test mocked `osascript`, so JavaScript consumed the embedded
  shell quote escapes without anyone parsing the resulting AppleScript. A real
  `osacompile` regression now owns that platform syntax boundary.
- A black-box app-exit test passed alone but could wait forever on a native
  frame under parallel suite load. Every protocol read and cleanup now has its
  own deadline; the job timeout is only the outer containment boundary.
- A mocked GUI commit receipt accepted held content whose Board and Idea clocks
  rewound behind live Agent authority. Reusing the production projection guard
  in the race test made the hidden rejection visible; merged timestamps now use
  native authority as a lower bound while the held content still wins.
- A native shutdown assertion subscribed to the child `close` event after doing
  slower socket checks, so parallel load could let the event pass first and
  strand the test. Capture terminal event promises before triggering shutdown.
- A mocked Windows toolchain call asserted the command text but missed Node's
  incompatible C-runtime quoting around `cmd /c`. The hosted VS 2026 runner
  also rejected the non-native `x64` VsDevCmd spelling; command-interpreter
  seams must pin both argument serialization and vendor vocabulary.
- VS 2026 `/W4 /WX` caught dead cleanup after an intentional infinite server
  loop that Apple Clang's default warnings missed. Share the unreachable-code
  warning at the portable native build seam so either host catches this class.
- Forced cleanup reported itself through the unexpected-loss callback before
  the initiating shutdown error surfaced. Intentional termination must settle
  pending work without recursively escalating its own lifecycle sentinel.
- A real retained schema-v1 certification packet exposed what the synthetic
  compatibility fixture hid: immutable evidence must bind its historical
  proof-ledger entry, while newly minted schema-v2 sets need a versioned
  identity so relabeling cannot silently discard stronger posture fields.
- Hosted spend continued while this merge was paused and crossed both the
  warning and hard ceilings. The guard correctly blocks another push, but its
  serial full-month estimator no longer scales; bounded incremental reads were
  needed to produce the same conservative total.
- “Result creation is Run-only” conflated generated output with the empty
  Result shell that makes an unrun Ask chain valid. Name structural side
  effects separately from content authority when one command owns both.

## Next adjustment

- Keep reversible policy defaults in code and tests; stop only for compatibility
  boundaries that make persisted data unreadable to an older installed surface.
- Execute every shipped entrypoint and run static discovery with a fresh caller
  before freezing operator docs.
- Treat rendering modes, user-edit entry points, and shipped executables as
  explicit matrices; prove the whole set once at each owning boundary.
- For derived UI state backed by native authority, test the in-memory result
  and the reload result together; either one alone can hide seam drift.
