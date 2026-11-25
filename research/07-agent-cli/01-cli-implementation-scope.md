# CLI implementation scope

Date: 2026-07-22. Investigated at main `84c8146` (worktree
`claude/cli-implementation-scope-f5752c`).

## Why CLI first

Founder direction, supported by two external arguments and by #598's own
fresh-agent evidence:

- CLIs are token-cheap for agents: no per-session tool-schema load, and agents
  already have deep training familiarity with shell composition (pipes, exit
  codes, scripts). Cited: CircleCI "MCP vs CLI" (33% better token efficiency in
  a multi-step debugging benchmark) and Niels Rogge's "MCP vs CLI" (MCP schema
  preloads reported at 70–90k tokens before user input).
- CLIs are debuggable and composable by both humans and agents; a transcript
  of shell commands is inspectable in a way MCP tool calls are not.
- The #598 counterpoint stands and is preserved: MCP had the best zero-context
  discovery. That is why the thin production MCP adapter stays; it is why
  discovery becomes a first-class CLI requirement below.

## 1. What actually merged (build on this)

Discovery epic #598 shipped no production code itself — its adapters were
explicitly throwaway and its worktree (including the
`research/07-agent-access-prototypes/` docs) is gone. But its findings were
posted as amendments to #520/#526/#527 and were absorbed almost immediately:
the entire production Agent Gateway train landed on main 2026-07-19/20, the
two days after the founder lab.

Landed and certified on main:

| Asset | What it is | Evidence |
| --- | --- | --- |
| SQLite Profile authority | One Electron-main-owned utility process owns `profile.sqlite` (Node `node:sqlite`), blobs, recovery, Portable Export; one-writer, atomic revisions, Intent attribution | ADR 0025/0029; `electron/profileUtilityHost.ts`, `electron/sqliteRuntime.ts`; PRs #627/#647 |
| Transport-neutral Gateway session | `describe()` / `invoke()` / `close()` over one installed exact-seven descriptor registry; static discovery opens no Profile authority; first valid call single-flights one existing-only headless lease | ADR 0026/0029; `src/persistence/profileAgentGateway.ts`; PR #661 (#526) |
| Seven installed operations | Queries `profile.status`, `profile.capabilities`, `idea.list`, `graph.query`, `record.get`, `mod-template.list` + `command.batch` | `PROFILE_INSPECTION_QUERY_NAMES`, `PROFILE_GATEWAY_OPERATION_NAMES` |
| Ten-command batch surface (v2) | Board: `card.create`, `card.update-content`, `card.delete`, `connection.create`, `connection.update-meaning`, `connection.delete` (note/askAi card kinds). Mod: `mod-template.create/update/delete`, `mod-instance.stamp`. All with dry-run, expected-revision, idempotency key, trusted actor/transport attribution, durable Agent history | `src/persistence/profileAgentCommandManifest.ts`; PRs #656 (#524), #525, #659 |
| Packaged JSON CLI | `Eido --eido-profile-json`: one bounded JSON envelope on stdin → one JSON line on stdout, 8 stable exit codes, 512 KiB in/out bounds, stderr diagnostics only | `electron/profileJsonCli.ts`, `electron/main.ts`; PRs #654, #656 |
| Packaged stdio MCP | `Eido --eido-profile-mcp`: the same seven descriptors as tools only (no resources/prompts), bounded, trusted `mcp` attribution, Windows SEA relay for clean stdout | `electron/profileMcpServer.ts`, `electron/profileMcpStdio.ts`; PRs #664, #665 (#527) |
| Installed-boundary certification | Ownership/contention, attribution-in-transaction, replay, stale rejection, packaged-runtime proof | #527 closed; exact-main runs recorded in #520 amendment |

Key #598 findings that production already absorbed: trusted actor/transport
injection at the commit seam (not wrapper-side audit logs), preview/apply
identity stability, registry-declared vs actual conditional effects,
CLI accepts canonical JSON via stdin only (no caller-selected file authority).

## 2. What was throwaway or never built (rebuild or re-derive)

- **The ergonomic CLI itself.** #598's founder-usable CLI (capability
  discovery, named subcommands/journeys, optional human-readable view,
  walkthrough scenario) was deleted with the prototype worktree. The
  production CLI is a raw transport, not a usable tool — see gap analysis.
- **The #598 research docs** (`02-mcp-cli-precedents.md`,
  `04-eido-interaction-inventory.md`, `05-prototype-decisions.md`, the
  comparison and live retro) exist only as issue-comment summaries on
  #598/#520/#526/#527. Re-derive from those comments if needed; do not assume
  the files exist anywhere.
- **The rich MCP surface** (12 specific tools, `eido://` resources, founder
  prompt) was prototype-only. Production deliberately shipped seven generic
  descriptor-tools. Expansion is deferred, not lost — the design is recorded
  in the #526 findings comment.
- **File-native projection.** Rejected as an authority; an optional read-only
  projection was recommended but never built. Out of scope here.

## 3. Decision reconciliation: "Ship a JSON CLI" vs SQLite

No conflict, and nothing to overwrite. "JSON CLI" in the #598 decision names
the **wire format** — machine-readable JSON envelopes on stdin/stdout and
stable exit codes — not the storage backend. The storage decision is ADR 0025:
SQLite is the one physical Profile authority, and the landed CLI already runs
over it (CLI → Gateway session → headless SQLite lease). The decision stands;
to avoid the ambiguity recurring, this track names the surface the
**JSON-first CLI over the SQLite Profile authority**.

## 4. Gap analysis — landed CLI vs a CLI agents can actually use

The landed `--eido-profile-json` mode is correct, certified transport. As a
product surface it has real gaps:

1. **No discovery from the CLI.** `describe()` (operation schemas, bounds,
   failure taxonomy) is reachable by MCP `tools/list` but not by any CLI call;
   the CLI caller gets only `profile.capabilities` (names + limits, no
   schemas). An agent cannot learn how to write a `command.batch` from the
   CLI alone. This inverts the CLI-first strategy.
2. **No ergonomic command surface.** One raw envelope per invocation. An agent
   must hand-assemble `{version, requestId, operation, params}` plus, for
   mutations, the full batch envelope (schemaVersion, expectedRevision, actor,
   clientTxnId, idempotencyKey, dryRun, commands[]). #598 measured this as the
   CLI's worst friction vs MCP.
3. **Invocation is buried in the app bundle.** Callers must know the packaged
   binary path (`Eido.app/Contents/MacOS/Eido` / `Eido.exe`) and the magic
   flag, plus platform quirks (Windows CRLF preamble on JSON mode). Nothing
   installs an `eido` command on PATH.
4. **One operation per process launch, at Electron startup cost.** Every call
   pays full Electron boot. Fine for occasional checks; likely painful in an
   agent loop (orient → read → dry-run → apply → verify ≈ 5+ launches).
   Needs measurement before deciding on a session/batch answer.
5. **No human view.** JSON only. The #598 decision called for an optional
   human-readable view that is explicitly not the machine contract.
6. **Partial orientation disclosure.** #598 finding: orientation should
   disclose enabled, disabled/human-only, system-only, and prohibited
   capabilities with versions and limits — capabilities today lists enabled
   names only.
7. **Bounded-read ergonomics.** `board.snapshot` and `export.plan` exist at
   the public service seam (renderer bridge) but are not admitted through the
   installed gateway; agents orient via `idea.list` + `graph.query` +
   `record.get`. Whether to admit `board.snapshot` for one-call orientation is
   a scope decision below.

## 5. Proposed scope

Principle (unchanged from ADR 0026): the CLI grows **ergonomics, not
authority**. Every new verb resolves to the same seven installed gateway
operations; the CLI adds no second mutation path, no path selector, no socket,
no schema bypass. The raw envelope mode stays as the stable machine contract
and script/debug/recovery baseline.

### In scope

**A. `eido` command distribution.** A thin launcher on PATH (installed by the
app or a documented one-line install) that locates the packaged binary and
invokes the JSON mode. Platform quirks (Windows CRLF/SEA behavior) are
absorbed here once, not by every caller.

**B. Subcommand surface over the envelope.** Named verbs mapping 1:1 onto
gateway operations, e.g.:

- `eido status`, `eido capabilities`, `eido idea list`, `eido graph query …`,
  `eido record get <kind> <id>`, `eido mod list`
- `eido card create|update|delete`, `eido connection create|update|delete`,
  `eido mod create|update|delete|stamp` — each assembling a single-command
  batch with generated `requestId`/`clientTxnId`/idempotency key, explicit
  `--expected-revision`, and `--dry-run` / `--apply` as first-class flags
- `eido batch` — submit a full multi-command batch from stdin (the current raw
  mode, kept verbatim)

Machine output remains the normalized gateway envelope on stdout; `--pretty`
adds the human view; exit-code taxonomy is unchanged.

**C. Discovery as a first-class verb.** `eido describe [operation]` projects
the gateway `describe()` registry — schemas, bounds, failure codes,
mutating/read annotations — without opening Profile authority (the session
already supports this statically). Plus `--help` text written for LLM
consumption, and orientation output extended to disclose
enabled/human-only/system-only/prohibited per #598 finding 4.

**D. Journey ergonomics where #598 proved value.** The one bundled journey the
prototype validated (connected-thought: create card + connection atomically)
expressed as one verb over one atomic batch — declared as a composition of
existing primitives, no new outcome.

**E. Invocation-cost measurement, then a decision.** Measure packaged
JSON-mode round-trip latency on both targets. If an agent loop is materially
throttled by Electron boot, decide between: accept it (CLI-first statelessness
is a feature), a multi-request stdin mode (N envelopes per launch), or
pointing loops at the persistent MCP adapter which already exists. Any
multi-request CLI mode amends ADR 0026's "exactly one caller request" wording
— an explicit ADR amendment, not silent drift.

**F. Docs + agent onboarding.** A CLI runbook in `docs/`, plus AGENTS.md /
skill snippets so local agents (Claude Code, Codex) discover the CLI without
being told.

### Scope decisions to confirm with the founder

1. Admit `board.snapshot` (bounded) through the installed gateway for one-call
   orientation, or keep the 6-query inspection set and orient via
   `graph.query`?
2. Where does the launcher live — installed by the packaged app, an npm-less
   shell shim, or a tiny published package?
3. Is the human `--pretty` view worth doing in slice one, or after first
   agent-driven use?

### Out of scope

- Any new gateway operation semantics, card kinds, or mutation authority
  (production surface v2 stays exact-ten; expansion is #520-frontier work).
- MCP surface expansion (12-tool design, resources, prompts) — deferred;
  the certified thin adapter stays untouched.
- File-native projection, watched inboxes, TCP/HTTP, remote access.
- Editing the raw envelope wire contract or exit codes.

### Sequencing sketch

1. Launcher + subcommand read path (`status`/`capabilities`/`describe`/
   `idea list`/`graph query`/`record get`) — pure ergonomics, no ADR motion.
2. Mutation verbs with dry-run/apply + the validated journey verb.
3. Latency measurement → session-mode decision (+ ADR amendment if taken).
4. Orientation disclosure extension + docs/onboarding.

Evidence per ADR 0028: the gateway semantics are already certified; new proof
concentrates at the new seam only (argv → envelope assembly, launcher path
resolution, platform quirks), reusing the existing contract corpus.
