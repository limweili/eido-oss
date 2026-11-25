# CLI epic scope — founder direction, v2

Date: 2026-07-22. Supersedes the "Proposed scope" section of
`01-cli-implementation-scope.md` where they differ; the investigation and
gap analysis in that doc remain the factual baseline.

## Founder direction (recorded 2026-07-22)

1. **Live GUI coexistence is required for v1.** CLI writes must work while
   Eido is open, with changes appearing live on the canvas. Headless-only is
   not the product.
2. **Surface: full control of core interactions.** All card kinds (not just
   note/askAi), connection work, editing, chaining cards to mimic reasoning,
   running them, and reading results. **Mods are excluded for now** — the mod
   system is about to change substantially.
   “All card kinds” means domain-appropriate create/edit/delete authority, not
   identical connection behavior: Title Cards remain spatial labels and cannot
   be connection endpoints, preserving ADR 0017's context contract.
3. **Spatial awareness is a requirement, not a nicety.** A card created for a
   related thought must land spatially near its context (e.g., two new
   storyboard drafts created next to the story-outline section the agent was
   reading). Whether the CLI or the app computes placement is open; the
   outcome is not.
4. **AI work must be discoverable.** Anything AI-created is labelled in
   metadata and/or gets a distinct default visual treatment, exposed as a
   search filter, with jump-to-card navigation. The failure mode to design
   against: "the AI used the board and the user has no idea what it did."
5. **Distribution: the packaged app installs an `eido` command on PATH.**
   Self-discoverable from the terminal, friendly to both humans and coding
   agents out of the box.

## What this changes vs doc 01

Doc 01 scoped an ergonomics layer over the existing certified surface. The
founder direction adds four genuinely new build areas — live routing, surface
expansion, spatial placement, and attribution visibility — which make this an
epic with GUI, renderer, gateway, and schema work, not a CLI-only feature.
The CLI remains the thin front; the gateway remains the only authority.

## Requirement analysis

### R1 — Live routing (the spine)

Today the installed gateway has no active-GUI command route: GUI open →
`busy`. ADR 0026 already *anticipates* routing to the active owner ("a
gateway either routes a request to the active owner or acquires … exclusive
ownership") — it was accepted but never implemented, so this is an
implementation of the ADR plus an amendment naming the mechanism, not a
reversal.

Design decisions to make in the epic:

- **Transport from CLI process to running app.** Candidates: a local domain
  socket / named pipe owned by the running app with peer-credential checks
  (not a TCP/HTTP listener — but still an ADR 0026 amendment since it adds a
  local endpoint), or Electron single-instance forwarding (already exists for
  `second-instance`, but is one-way; a response channel must be added).
  Whichever is chosen must preserve trusted transport binding (actor/transport
  stamped by the app, never by request JSON).
- **Renderer live-apply.** Agent commits arriving while the GUI owns the
  Profile must appear on the canvas without reload. The renderer
  hydration/projection seam (`profileGuiProjection`, bridge hydration/ACK)
  exists for startup; applying external commits to a live Zustand store is
  new work and must respect ADR 0016 (state-first, event-aware commit).
- **Undo interplay.** Recommended default: agent commits are ordinary
  revisions with agent attribution, *not* entries in the user's local undo
  stack; the user reverts agent work by normal editing or (later) a review
  action. Needs an explicit decision recorded against ADR 0016 semantics.
- **Reads while GUI is open.** SQLite WAL may permit safe snapshot reads
  without the exclusive lease; if so, read verbs work everywhere immediately
  and only writes need routing. Verify early — it de-risks Phase 0.

### R2 — Surface expansion (grilled 2026-07-22)

Governing rule (founder-agreed): **the agent may create and arrange
thought-structure; it may never author or edit what Eido presents as
AI-execution output** — result content, conversation transcripts, follow-up
answers. Those are Run-authored, preserving the glossary's Chain/Stale/
Follow-up semantics.

Per-kind surface:

| Kind | Create | Edit content | Delete |
| --- | --- | --- | --- |
| note | ✓ | ✓ | ✓ |
| askAi | ✓ | ✓ | ✓ |
| title | ✓ | ✓ | ✓ |
| group | ✓ | ✓ | ✓ |
| conversation | ✓ | ✓ (topic/Style/turns only; transcript stays run-authored) | ✓ |
| result | ✗ direct (an Ask-chain Connection may create the empty structural shell) | ✗ | ✓ (cleanup; cascade recorded) |
| mod | ✗ | ✗ | ✗ (ergonomic Agent surface excluded) |
- Connections: already admitted for all kinds; complete meaning/polarity
  ergonomics in CLI verbs.
- Mod commands (`mod-template.*`, `mod-instance.stamp`) stay gateway-admitted
  as raw compatibility but get **no CLI verbs** and are absent from
  Agent-facing discovery after the single-class Mods cutover.
- Chaining "to mimic reasoning" = creating connected askAi chains — covered
  by card/connection commands plus R5 execution; consider one journey verb
  (`eido chain …`) composing existing primitives atomically, as #598
  validated for connected-thought. When the upstream Ask is unrun, the shared
  graph rule creates an empty Result shell and routes Ask → Result → Ask; this
  creates no Output, output version, Run, or generated content.

### R3 — Spatial placement

`card.create` takes an absolute `{x, y}` today; the caller would have to
guess coordinates. Precedent exists: `findResultCardPosition` places Result
cards near their source, and ADR 0026 names shared transport-neutral
placement kernels with bounded geometry.

Scope: a deterministic **placement kernel** in the shared graph layer —
"place near anchor card/set, avoid overlap, stay within section cluster" —
exposed to the CLI as `--near <anchor>` (position optional, computed when
omitted). The same kernel benefits GUI features later. Spatial reads stay
minimal: neighbors-of and bounding-box-of-set queries so an agent can orient
spatially without streaming the whole board.

**Card Deep Links are the anchor idiom.** The expected human→agent handoff is
copying a card link (`eido://app/?…&idea=…&card=…&x=…&y=…&zoom=…`) and telling
the agent "review this / work here." The CLI accepts a deep link anywhere a
card or idea address is expected, reusing `src/shared/deepLinks.ts` verbatim.
The card id is the authoritative spatial anchor, resolved to its live
position at apply time; the link's viewport numbers are only a hint and may
be stale. Placement runs inside the commit at the batch's expected revision,
so a dry-run's predicted position and the applied position cannot silently
diverge, headless and live identically.

This is also half the answer to R4: if agent output always lands beside its
context, spatial surprise is bounded by construction.

### R4 — AI attribution and discoverability

Current state: attribution is durable in the Intent Log and Agent history
receipts, but **cards carry no creator field** and the canvas renders no
authorship distinction. Search (`BoardSearchPanel`) has no creator filter.

Scope:

- **Card-level provenance.** Add authorship metadata to the card record
  (e.g., `createdBy: {kind: user|agent, actorId}` and last-modified-by),
  stamped at the commit seam from the trusted actor — never caller-supplied.
  Schema addition → migration + Portable Export coverage.
- **Visual treatment.** Agent-authored cards get a distinct default accent —
  defined as a design-system role/token per `docs/design/design-system/`
  (SYSTEM.md governs; no raw colour in components). Keep v1 to one persistent,
  subtle treatment; an "unreviewed since last seen" stronger state is a later
  candidate, not v1.
- **Search + jump.** `BoardSearchPanel` gains a creator filter (AI/user);
  results jump-focus cards as search already does. CLI mirror: the same
  filter on `graph.query`.
- **Change trail.** `eido changes [--since <revision>]` projects the durable
  Agent history into a bounded list of affected records with idea, kind, and
  position — "what did the AI do, where" in one command. The GUI can later
  surface the same projection as a review list; not v1.

### R5 — Execution and reading results

Execution currently lives in the renderer (`src/brain/openRouter.ts`, run
orchestration in the graph store) with the user's provider credentials. Live
routing (R1) makes CLI-triggered execution feasible **by delegation**: the
CLI submits "run this card/chain," the running app executes with its own
credentials and engine, results commit normally. This avoids relocating the
execution engine or exposing credentials — the #598 boundary is respected.

- Verbs: `eido run <cardId> [--wait|--poll]`; runs are async, so job status
  polling (`run.get`) and bounded output reads are part of the surface.
- Headless execution (app closed) is explicitly **out of scope** — `eido run`
  with the app closed fails with a clear "open Eido to execute" error.
- Reading results/outputs/runs/provenance: already reachable via
  `record.get`/`graph.query`; add ergonomic verbs (`eido output get`, etc.).

### R6 — Distribution and discovery

- Packaged app installs/offers an `eido` PATH shim on first run (VS Code
  `code`-style). The shim locates the installed binary and absorbs platform
  quirks (Windows CRLF/SEA) once.
- Self-discovery from zero context: `eido` with no args prints an
  agent-legible orientation (what this is, how to discover operations);
  `eido describe [op]` projects the gateway registry (schemas, bounds,
  failure codes, mutating annotations, enabled/human-only/prohibited per
  #598 finding 4); `--help` everywhere written for LLM consumption; machine
  output stays the normalized envelope; `--pretty` for humans.

## Phasing (each phase shippable and useful)

| Phase | Ships | New risk |
| --- | --- | --- |
| 0. Foundation | PATH shim; discovery (`describe`, agent-legible help); read verbs; raw `batch` passthrough; verify WAL snapshot reads with GUI open | Low — ergonomics over certified surface |
| 1. Live spine | CLI↔app routing; renderer live-apply; card provenance field + agent accent + search filter; `eido changes` | **Highest** — IPC mechanism, live store apply, schema migration; ADR 0026 amendment + ADR 0016 undo decision |
| 2. Full canvas surface | All card kinds; placement kernel + `--near`; spatial reads; connection ergonomics; chain journey verb | Medium — placement determinism, per-kind validation |
| 3. Execution | `eido run` delegated to the live app; run polling; output/run/provenance verbs | Medium — async job surface; credential boundary stays in-app |

Attribution visibility (R4) deliberately rides in Phase 1, not later: the
first moment agents mutate a live canvas is the moment "what did the AI do"
must already be answerable.

## Confidence statement

Confident shipping this **as phased above**. Phase 0 is low-risk and
immediately useful. Phase 1 is the honest risk center (new IPC seam, live
renderer apply, schema migration) and is exactly where certification effort
should concentrate; everything after it reuses the spine. The un-phased
version — "full control, live, all kinds, execution, in one drop" — is not a
confident ship and is not proposed.

## Decisions resolved by grilling (2026-07-22)

1. **Live routing**: app-owned local domain socket / named pipe with a
   two-transport `eido` shim (socket when app is live, headless lease when
   not). Recorded as ADR 0031.
2. **Undo**: agent commits never enter the user's undo stack; v1 reversal of
   agent work is visibility-assisted manual editing (creator filter + accent
   + `eido changes`), no revert engine. Batch revert is a Phase 2+ candidate
   on felt need. Glossary's Undo entry updated in `CONTEXT.md`.
3. **Kind surface**: per-kind matrix in R2 above; direct Result
   creation/editing and transcript authorship stay Run-only. Ask-chain
   Connection creation may produce the existing empty structural Result shell
   without any Output or Run. Mods remain fully excluded pending rework.
4. **Attribution data model**: structured actor `{kind: 'agent', client
   <self-declared label>, sessionId}` stamped at the commit seam (trust
   boundary remains `kind`, enforced by transport); cards carry both
   `createdBy` and `lastModifiedBy`; the agent accent renders "agent-authored
   and not yet reshaped by you" (`createdBy` agent ∧ `lastModifiedBy` ≠ user)
   — the user's first edit adopts the card visually while durable `createdBy`
   remains for search and history.
5. **Execution posture**: `eido run` executes immediately with the app's
   settings — no consent gate — with full visibility (live run indicator,
   agent-attributed Run record, `eido changes`). Spend is controlled by a
   per-session run/budget cap that fails closed with a clear error. A
   session-grant mechanism is designed but dormant, intended as the default
   for non-owner (Friends) setups later.
6. **Spatial intelligence lives in a shared deterministic placement kernel**
   in the domain layer — never the renderer, never the agent — and must work
   headless. Card Deep Links are the first-class anchor idiom (see R3); the
   card id anchors, viewport hints.

## Open design decisions (remaining)

1. Placement kernel internals: the "near" algorithm (cluster detection,
   overlap avoidance, drift bounds) — implementation-time, behind the fixed
   `--near`/deep-link contract.
2. Agent accent visual treatment: token role naming and rendering go through
   the design system (`docs/design/design-system/`); semantics are fixed by
   decision 4.
