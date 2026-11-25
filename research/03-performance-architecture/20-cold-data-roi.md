# Cold-data loading ROI

Status: issue #408 decision evidence after the Reading-band architecture was
selected by [#406](19-reading-band-architecture-selection.md). This study does
not change runtime loading, persistence, storage, or renderer behavior.

## Decision

**Keep eager `SavedBoard` loading. Select no on-demand payload seam.**

The deterministic stress family added **423,400 serialized bytes** to the
315,204-byte control. Of that delta, **384,443 bytes** were historical version
bodies/threads and run provenance, while Board settings added 32,005 bytes.
Those are real initial-hydration, logical-residency, full-snapshot
serialization, and selected-Card retention costs. They add **zero record
visits to stable Reading camera navigation**, however. The selected renderer
continues to consume Card geometry/content, connections, and chosen output text;
pan and zoom do not traverse historical bodies, runs, provenance, or settings.

The current runtime also has no record resolver on which to put a bounded lazy
boundary. It hydrates one `SavedBoard`, selectors return full `Output` objects,
and save, duplicate, export, playback, provenance, and AI execution expect a
source-complete synchronous snapshot. The Profile Service contract names useful
logical records, but its runtime adapter is explicitly absent. Adding a partial
load lifecycle before that seam exists would move complexity into every
consumer without improving the selected Reading path.

This is one terminal choice for the #410 epic, not a choice between equivalent
eager and lazy designs. #409 should omit a cold-data split from the production
renderer train.

## What was measured

The checked-in
[`createColdDataRoiFixtureFamily`](../../src/performance/coldDataRoiFixtures.ts)
holds all Cards, connections, current chosen bodies, version metadata, selection
target, and selected-run summary constant. It varies only:

- `history-heavy`: the bodies and follow-up text of the three non-chosen Result
  versions; version count, IDs, order, timestamps, acceptance, and chosen
  version stay fixed;
- `provenance-heavy`: 18 completed, fictional run/provenance records inserted
  before the selected run;
- `settings-heavy`: one fictional Board system prompt and model list; and
- `combined`: all three independent changes.

All IDs, timestamps, prose, model names, and relationships are synthetic. The
fixture contains no imported save or local path and never reads production
data.

[`evaluateColdDataRoi`](../../src/performance/coldDataRoi.ts) reports structural
proxies at the public data/cache seams:

- UTF-8 `JSON.stringify` bytes via the existing `jsonPayloadBytes` helper;
- logical retained records using the source-confirmed Profile record
  vocabulary, explicitly not physical database rows;
- JSON values, strings, and normalization traversal visits;
- graph-index cache hits, partial builds, causes, and sub-index reuse;
- the chosen-text inputs used by Board Reading metrics;
- full selected-`Output`, chosen-body, version-metadata, and historical-body
  payloads; and
- exact `Array.find` visits in the current Version Context run lookup.

Wall-clock latency, CPU throughput, FPS, and physical heap are **not measured**.
They are non-authoritative on the available host. `logicalJsonShapeBytes` is a
serialized-shape residency proxy; it excludes JavaScript object overhead,
string interning, native allocations, decoded pixels, and GPU residency.

## Reproducible results

Focused command:

```bash
npx vitest run src/performance/coldDataRoi.test.ts --reporter=verbose
```

The two broad tests prove fixture orthogonality/privacy and the complete public
evidence/decision seam. They do not run Chromium or a benchmark harness.

### Load, residency, and persistence

| Case | Full `SavedBoard` bytes | Delta | Profile logical records | JSON value visits | Retained string UTF-8 bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Control | 315,204 | 0 | 289 | 2,193 | 286,116 |
| History-heavy | 556,007 | +240,803 | 289 | 2,193 | 529,185 |
| Provenance-heavy | 465,796 | +150,592 | 307 | 3,010 | 429,662 |
| Settings-heavy | 347,209 | +32,005 | 289 | 2,196 | 318,112 |
| Combined | 738,604 | +423,400 | 307 | 3,013 | 704,727 |

History changes byte volume but not record/value count because it enlarges
existing string fields. Provenance adds 18 logical run records and increases
normalization from 5 to 23 run copies. The current persistence path serializes
the full Board in every case; the table does not claim measured serialization
time.

### Selected Reading path

Every case produced the same deterministic Reading-input signature, the same
two output visits, five version comparisons to resolve chosen versions, and
43,750 chosen-text code units. Stable camera navigation performs zero cold
record visits.

| Change after control | Graph-index result | Rebuilt sub-index | Reused sub-indexes | Reading implication |
| --- | --- | --- | --- | --- |
| None / settings only | Cache hit | None | All by unchanged array identity | Settings do not enter the graph or Reading metric input. |
| Historical body only | Partial build | Outputs | Cards, connections, runs | Output identity invalidates output indexing, but camera-only navigation does not. |
| Runs/provenance only | Partial build | Runs | Cards, connections, outputs | Run data does not enter Reading Card metrics. |
| Combined | Partial build | Outputs and runs | Cards and connections | Still no steady camera traversal of cold data. |

This distinction matters: a historical body edit can trigger output derivation
work. In this fixture it causes one full Card-metric rebuild with 32 Card visits;
because the chosen text is unchanged, the public projection reuses its previous
result. Re-evaluating the same case for stable camera navigation then records
zero Card-metric visits. Keeping an already-hydrated Board resident therefore
does not make each pan or zoom traverse that body. The buffered rich-DOM
residency and canvas safety architecture selected by #406 is independent from
this lane.

### Card selection and Version Context

The selected Result's full `Output` is 174,311 bytes in the control and 415,114
bytes in the history-heavy case. Its version metadata remains 555 bytes and its
chosen body/thread remains 43,790 bytes; only historical bodies/threads grow
from 129,835 to 370,638 bytes. Current selectors already return the full
resident `Output`, so Card selection does not perform a second parse or fetch.

`VersionContext` currently finds the selected run with `runs.find(...)`. The
control scans four records. Inserting 18 completed historical runs raises both
first and subsequent opens to 22 record visits; there is no component-level
lookup cache, so subsequent opens do not improve structurally. Modal latency is
not measured. This exposes a small independent cleanup for #409: use the
existing graph run index for Version Context lookup if production sequencing
finds it worthwhile. It does **not** justify a storage/load lifecycle.

## Temperature of Board data

“Cold” is consumer-relative, not a durable storage class:

| Payload | Reading temperature | Other authority that keeps it eager today |
| --- | --- | --- |
| Cards, connections, chosen output body, chosen follow-ups/transcript | Hot | Visible rich Card, scene metrics, search/copy/interaction, semantic context |
| Version IDs/order/status/timestamps | Warm/hot | Version switcher and first-intent version changes |
| Non-chosen version bodies, follow-ups, transcripts | Cold to the current Reading body | Version switching, full search/export/offline closure |
| Chosen/active run summary | Hot | Status/model/context marker and provenance entry point |
| Completed run compiled instruction and detailed provenance | Cold to Reading | Version Context, provenance, playback/execution audit, export |
| Board AI settings | Cold to canvas paint, operationally hot | Compile fingerprints, model choice, settings UI, execution correctness |
| Compaction summaries | Cold to canvas paint, operationally hot | Compiler reuse and context correctness |
| Intent log | Cold to canvas paint, hot to playback | Timeline projection and offline history |

There is no payload in this table that is both materially on the stable Reading
camera path and safely disposable from all synchronous consumers.

## Why the byte win does not clear the lifecycle gate

A named on-demand boundary would have to preserve the `SavedBoard` as source of
truth while adding all of the following:

- a single cache/loading/error authority for version switching, context modals,
  playback, compilation, duplicate, save, and export;
- materialize-before-snapshot semantics or a new asynchronous snapshot/export
  contract;
- complete Board search, copy, accessibility, and offline export across
  unloaded payloads;
- migration and recovery rules that preserve stable logical IDs and references;
- serialization rules that cannot accidentally save a partial Board over the
  authoritative closure; and
- cache invalidation for edits, deletion, undo/redo, version choice, and
  provenance retention.

The stress case proves a possible byte ceiling, not prevalence in user Boards.
Without real-data access, device timing, or a production Profile adapter it
cannot establish a startup/heap benefit large enough to price those failure
modes. Structural evidence does establish that the selected Reading path gets
no steady-navigation benefit. Eager loading is therefore the simpler bounded
decision.

## Downstream and rollback

- **#409:** retain eager `SavedBoard` hydration; do not add a cold-data storage
  migration or lazy-cache lane to the production renderer sequence. It may
  carry the existing-index Version Context lookup as a small, separately
  reviewable cleanup, not as an architectural dependency.
- **#510:** certify eager Board loading as the frozen #410 cold-data result.
  Versions, provenance, playback, execution, search, export, and offline
  behavior remain source-complete.
- **Future re-evaluation trigger:** a production runtime record resolver plus
  privacy-safe aggregate evidence that named historical bodies/provenance
  dominate representative Board startup/residency. That would be a new
  architecture decision, not unfinished #408 work.
- **Rollback:** no runtime or storage behavior changes. Revert only this
  evidence module, its synthetic fixture/tests, and this report.
