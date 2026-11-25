# Eido current AI-provider and harness-routing architecture

## Scope and evidence boundary

This lane maps the current Eido implementation that a BERD comparison should
target: provider selection, local CLI harness invocation, streaming and
cancellation, credentials, and the installed `eido` CLI's headless/live
routing. It does **not** infer BERD behavior; BERD findings belong in the
companion lanes.

Repository state checked 2026-08-22:

- `HEAD`: `02a4b11fd02682e48020bf221155a57d2c534527`
  (`Align browser canary with optimized Card rendering (#1197)`).
- Working tree was clean (`git status --short --branch` reported detached
  `HEAD` with no changed files) before this note was created.
- The codebase-memory graph was queried first for the architecture, provider,
  harness, CLI, run-engine, and subprocess seams. It identified the primary
  entry points (`runCard`, `streamCompletion`, `runEidoCli`, the standalone CLI
  router, and `createInstalledAiHarnessMainSession`). Exact current-worktree
  source inspection is the authority for the claims below.
- The targeted test command was attempted:
  `npm test -- --run src/brain/aiProvider.test.ts electron/aiHarnessBridgeContract.test.ts electron/aiHarnessMainSession.test.ts src/graph/storeAiSettings.test.ts`.
  The toolchain policy passed, but execution stopped because this checkout has
  no installed `vitest` binary (`sh: vitest: command not found`). Test claims
  below therefore identify repository tests, not a fresh passing run.

## One-page mental model

Eido has one provider-neutral completion seam, but two different kinds of
headless work. A normal Ask/Conversation run enters the run engine and may end
at OpenRouter or an installed local CLI. An external `eido run` request enters
the Profile Agent Gateway, is admitted and queued by the live app, then uses
the same ordinary runners; it is not a second CLI-to-harness protocol.

```text
                    ordinary in-app run
  Idea settings + Card ──> plan/compile ──> run engine
                                      │
                       ┌─────────────┴─────────────┐
                       │                           │
               OpenRouter HTTP/SSE          local harness bridge
               Bearer key + JSON            preload -> Electron main
                       │                           │
                       │                    spawn(command, vendor args)
                       │                    prompt on stdin, JSONL stdout
                       └─────────────┬─────────────┘
                                     ▼
                    normalized chunks -> OutputVersion/RunRecord

  installed `eido run` (external agent)
  CLI argv -> Profile Gateway -> live socket -> renderer service
       └─ live app required for run.submit; no headless fallback
                         ▼
              admitted schedule -> ordinary run engine -> bounded refs
                         ▼
              eido run status/read (not streamed model output)
```

The governing execution-layer contract says the packaged Agent CLI delegates
to the same live engine and does not introduce a second runner
([`docs/foundations/execution-layer.md:1-5`](../../docs/foundations/execution-layer.md#L1-L5)).

## 1. Provider catalog and selection

### Facts

The provider vocabulary is static and explicit: `openrouter`, `claude-code`,
`codex`, and `antigravity`; the last three are `LocalHarnessId`s. Defaults are
`claude`, `codex`, and `agy`, with provider-specific model lists
([`src/brain/aiProviderTypes.ts:1-45`](../../src/brain/aiProviderTypes.ts#L1-L45)).
The prior Gemini provider is remapped to Antigravity when an old Idea is loaded
([`src/brain/aiProviderTypes.ts:25-31`](../../src/brain/aiProviderTypes.ts#L25-L31)).

Idea settings hold the selected provider, per-provider model catalogs, active
model, reasoning effort, and optional system prompt. Local harness command
settings are separate from the Idea's AI settings type and are normalized to
device defaults (`claude`, `codex`, `agy`)
([`src/graph/store.ts:221-243`](../../src/graph/store.ts#L221-L243),
[`src/graph/store.ts:486-495`](../../src/graph/store.ts#L486-L495)). The store
normalizes missing/retired providers, keeps the active provider's model list at
the top level, and steps reasoning effort to a rung that the selected provider
and model actually support
([`src/graph/store.ts:408-465`](../../src/graph/store.ts#L408-L465);
provider/model effort mapping is in
[`src/graph/types.ts:300-352`](../../src/graph/types.ts#L300-L352)).

Switching providers is a state transition, not just a UI toggle. The store
chooses the provider's saved catalog, commits a compatible reasoning rung,
updates the default model and models list, and rewrites existing Ask/Group card
models to the new active model. Harness command edits are persisted separately
as local device settings
([`src/graph/store.ts:4533-4593`](../../src/graph/store.ts#L4533-L4593)).

`activeAiProvider` defaults missing provider state to OpenRouter, except in the
development-profile review mode, which is forced to OpenRouter. Access checks
are provider-specific: OpenRouter requires a key; a local provider only needs
the installed preload bridge
([`src/brain/aiProvider.ts:25-33`](../../src/brain/aiProvider.ts#L25-L33)).

### Inference

The intended routing unit is **provider + model + reasoning effort + command**,
not a generic model slug. Eido deliberately preserves per-provider catalogs so
switching from a remote slug to a CLI model cannot accidentally send an
OpenRouter identifier to a harness. The command is device-local, while model
catalog selection is Idea-local; this split is an important BERD comparison
seam.

### Unknowns / limits

- Provider discovery is not dynamic in the current source. The catalog and
  command defaults are code-defined; the user may edit command/model values,
  but there is no visible capability handshake or installed-command discovery
  in the provider adapter.
- Local CLI authentication is owned by the installed CLI process. Eido does
  not carry a local provider credential in its harness request and does not
  expose a harness login/status operation through this seam.

## 2. Shared run engine and provider-neutral completion seam

### Facts

`runCard` checks access, resolves the per-card model over the Idea default,
creates an `AbortController`, derives an execution plan, compiles connected
thought under the context budget, and begins a versioned Run before invoking
the provider stream
([`src/brain/runEngine.ts:189-225`](../../src/brain/runEngine.ts#L189-L225),
[`src/brain/runEngine.ts:258-369`](../../src/brain/runEngine.ts#L258-L369)).
The compiled instruction is sent unchanged after compilation; streaming chunks
append to the OutputVersion, and the Run is finished, canceled, or failed at
one common seam
([`src/brain/runEngine.ts:348-448`](../../src/brain/runEngine.ts#L348-L448)).

The provider adapter is `streamCompletion`. OpenRouter delegates to
`streamOpenRouter`; local providers build a typed harness request, register an
abort listener that calls `bridge.cancel`, await the typed bridge result, and
map bridge errors to `AiError` values
([`src/brain/aiProvider.ts:35-87`](../../src/brain/aiProvider.ts#L35-L87)).
The same adapter is used by conversations and follow-ups: Conversation's
default stream reads current Idea settings and calls `streamCompletion`
([`src/brain/conversationRunner.ts:116-132`](../../src/brain/conversationRunner.ts#L116-L132));
follow-ups pass the same provider-neutral stream while preserving the frozen
Run context ([`src/brain/followUpRunner.ts:69-79`](../../src/brain/followUpRunner.ts#L69-L79)).

Every Run stores the model and provider alongside compiled instruction,
provenance, status, and optional Agentic metadata
([`src/graph/types.ts:427-464`](../../src/graph/types.ts#L427-L464)). The
internal `startRun` captures the current provider when the Run begins
([`src/graph/store.ts:2555-2623`](../../src/graph/store.ts#L2555-L2623)).

### Cancellation and result semantics

The run engine keeps active AbortControllers keyed by source card. Cancel aborts
the provider stream and marks the graph Run canceled; already streamed text
remains on a provisional OutputVersion
([`src/brain/runEngine.ts:120-144`](../../src/brain/runEngine.ts#L120-L144),
[`src/graph/store.ts:4700-4706`](../../src/graph/store.ts#L4700-L4706)). This
means the provider adapter only has to honor an `AbortSignal`; graph durability
and provisional-result semantics remain provider-neutral.

### Inference

This is a strong deep-module seam: compilation, result persistence, provenance,
and cancellation are shared; only transport, argument construction, output
event parsing, and credential boundary vary by provider. BERD's routing design
should be compared against this seam rather than against each Run kind.

## 3. Local harness bridge and subprocess lifecycle

### Request contract and trust boundary

The renderer/main contract is versioned (`eido:ai-harness:v1`) and carries only
`harness`, `command`, `model`, `reasoningEffort`, `prompt`, and bounded staged
assets. It has separate `run` and `cancel` operations, typed chunk/error events,
and typed terminal results
([`electron/aiHarnessBridgeContract.ts:4-62`](../../electron/aiHarnessBridgeContract.ts#L4-L62)).
Requests require exact keys, a known local harness, bounded command/model/prompt,
and at most 32 assets with per-asset and aggregate byte limits
([`electron/aiHarnessBridgeContract.ts:118-191`](../../electron/aiHarnessBridgeContract.ts#L118-L191)).
The contract explicitly has no credential field. The repository test asserts
that an injected `apiKey` is denied at the renderer seam
([`electron/aiHarnessBridgeContract.test.ts:36-42`](../../electron/aiHarnessBridgeContract.test.ts#L36-L42)).

Preload exposes only the typed bridge to the renderer; the main process owns the
IPC handler and an installed harness session
([`electron/preload.ts:44-60`](../../electron/preload.ts#L44-L60),
[`electron/main.ts:404-432`](../../electron/main.ts#L404-L432)). The bridge keeps
a requestId-to-chunk-listener map, removes listeners in `finally`, and sends
cancel as a separate typed request
([`electron/aiHarnessBridgeContract.ts:64-93`](../../electron/aiHarnessBridgeContract.ts#L64-L93)).

### Spawn and stdin/stdout protocol

`createInstalledAiHarnessMainSession` registers a run before its first await so
cancel cannot be lost during asset preparation. It stages assets, spawns with
`shell: false`, pipes all standard streams, uses a temporary working directory,
and on POSIX starts a detached process group
([`electron/aiHarnessMainSession.ts:54-136`](../../electron/aiHarnessMainSession.ts#L54-L136)).
The prompt is written to stdin. Staged asset paths are appended to the prompt
only inside a disposable `## ATTACHMENTS` section
([`electron/aiHarnessMainSession.ts:279-314`](../../electron/aiHarnessMainSession.ts#L279-L314)).
The environment is inherited from `process.env` with `/opt/homebrew/bin` and
`/usr/local/bin` added to PATH
([`electron/aiHarnessMainSession.ts:462-467`](../../electron/aiHarnessMainSession.ts#L462-L467)).

Argument construction is an explicit switch, not a generic provider plugin:

| Harness | Spawned argv shape | Prompt/input shape |
| --- | --- | --- |
| Claude Code | `-p --verbose --output-format stream-json --include-partial-messages --no-session-persistence --permission-mode dontAsk`, optional `--model`, mapped `--effort` | plain prompt on stdin |
| Codex | `exec --json --ephemeral --skip-git-repo-check -s read-only`, optional `-m`, mapped `--config model_reasoning_effort=...`, image `-i` paths, final `-` | plain prompt on stdin |
| Antigravity | `--print= --input-format stream-json --output-format stream-json --sandbox`, mapped `--model` and `--effort` | one JSONL `user` event on stdin |

These mappings are in
[`electron/aiHarnessMainSession.ts:199-277`](../../electron/aiHarnessMainSession.ts#L199-L277).
The tests pin the documented non-interactive arguments and stdin behavior for
all three harnesses
([`electron/aiHarnessMainSession.test.ts:56-101`](../../electron/aiHarnessMainSession.test.ts#L56-L101)).

### Output normalization

Stdout is consumed line-by-line as JSONL. Claude Code contributes
`content_block_delta` text deltas and a terminal `result`; Codex contributes
`item.type === agent_message`; Antigravity contributes only `agent_response`
step updates and a successful terminal result. Unrecognized lines are ignored
([`electron/aiHarnessMainSession.ts:316-383`](../../electron/aiHarnessMainSession.ts#L316-L383)).
The adapter de-duplicates a terminal result that repeats already-streamed text,
but fails closed if the terminal result diverges from the streamed prefix or if
an exit-zero process yields no recognized answer
([`electron/aiHarnessMainSession.ts:138-185`](../../electron/aiHarnessMainSession.ts#L138-L185)).

The test suite covers partial-stream reconciliation, divergence as
`incompatible-output`, filtering user/tool events from Antigravity answer text,
nonzero exits as `failed`, and unknown output as incompatibility
([`electron/aiHarnessMainSession.test.ts:236-361`](../../electron/aiHarnessMainSession.test.ts#L236-L361)).

### Cancellation, shutdown, and cleanup

Cancel marks the run canceled and terminates the process tree. POSIX kills the
detached process group; Windows uses `taskkill /T /F`; a SIGKILL fallback fires
after 1.5 seconds. Closing the main session cancels all active runs and waits up
to four seconds for their settled promises
([`electron/aiHarnessMainSession.ts:75-85`](../../electron/aiHarnessMainSession.ts#L75-L85),
[`electron/aiHarnessMainSession.ts:105-115`](../../electron/aiHarnessMainSession.ts#L105-L115),
[`electron/aiHarnessMainSession.ts:385-409`](../../electron/aiHarnessMainSession.ts#L385-L409)).
Temporary asset directories are removed in `finally`, including after failures
([`electron/aiHarnessMainSession.ts:186-197`](../../electron/aiHarnessMainSession.ts#L186-L197)).
The tests exercise cancellation during asset preparation and forced shutdown of
a resistant child
([`electron/aiHarnessMainSession.test.ts:182-204`](../../electron/aiHarnessMainSession.test.ts#L182-L204),
[`electron/aiHarnessMainSession.test.ts:364-393`](../../electron/aiHarnessMainSession.test.ts#L364-L393)).

### Failure taxonomy

The local bridge exposes only `unavailable`, `failed`, `canceled`, and
`incompatible-output`; raw CLI diagnostics are not returned to the renderer
([`electron/aiHarnessBridgeContract.ts:10-10`](../../electron/aiHarnessBridgeContract.ts#L10-L10)).
`ENOENT` maps to unavailable, unexpected spawn/exit errors map to failed, and
protocol drift maps to incompatible-output. This makes a provider/harness fault
actionable without allowing unbounded subprocess output or raw command errors
into the graph.

## 4. Authentication, secrets, and installation assumptions

### Facts

The OpenRouter credential is loaded through the installed keychain bridge into
renderer settings at startup; packaged writes go through the main-owned local
credential store, while the Board/Idea serialization excludes the API key
([`src/graph/store.ts:1703-1721`](../../src/graph/store.ts#L1703-L1721),
[`src/graph/store.ts:4500-4511`](../../src/graph/store.ts#L4500-L4511)). The
credential store uses separate slots for OpenRouter and Linkup and private
file permissions/atomic replacement
([`electron/localCredentialStore.ts:17-70`](../../electron/localCredentialStore.ts#L17-L70),
[`electron/localCredentialStore.ts:139-183`](../../electron/localCredentialStore.ts#L139-L183)).

Local harness requests contain no provider credential. The subprocess receives
the inherited environment and its own CLI home/auth state; Eido simply resolves
the configured executable command and does not attempt to reproduce login.
The execution-layer contract describes these as installed, already-authenticated
CLIs whose credentials/output stay outside Profile data
([`docs/foundations/execution-layer.md:20-26`](../../docs/foundations/execution-layer.md#L20-L26)).

### Inference

Eido treats local harness authentication as an **ambient device capability**,
not an Eido provider account. This is low-friction for users who already use
Claude Code/Codex/Antigravity, but it makes readiness less explicit than a
provider registry that can report installed version, login state, supported
flags, and model catalog.

## 5. Agentic/tool behavior at the provider boundary

The Agentic flag does not alter the compiled instruction. For local harnesses,
Eido deliberately sends the same request shape and leaves tools/loops to the
harness; the provider test compares plain and Agentic bridge requests after
removing request identity and asserts they are equal
([`src/brain/aiProvider.test.ts:47-74`](../../src/brain/aiProvider.test.ts#L47-L74)).
For OpenRouter, a Linkup key causes Eido's completion boundary to run a typed
tool loop; without it, OpenRouter server tools run inside the provider request.
The current execution-layer invariant states this split and keeps tool activity
out of compiled instruction/provenance fingerprints
([`docs/foundations/execution-layer.md:23-26`](../../docs/foundations/execution-layer.md#L23-L26),
[`docs/foundations/execution-layer.md:38-40`](../../docs/foundations/execution-layer.md#L38-L40)).

This is a key interoperability choice: Eido does not impose a fake common tool
protocol on Claude Code, Codex, and Antigravity. It normalizes only answer
events, while each harness retains its native tool loop and permissions.

## 6. Installed `eido` CLI and headless/live routing

### Facts

The installed CLI is a Profile Gateway client. `runEidoCli` parses commands,
supports a raw `batch` wire mode, describes the Gateway, and invokes either a
live callback or a raw/headless callback; ergonomic responses are annotated with
`cli.servedBy` and live-routing status
([`electron/eidoCli.ts:940-1023`](../../electron/eidoCli.ts#L940-L1023)).
The CLI identity is bounded and comes from flags, environment, or a generated
session id (`EIDO_AGENT_CLIENT`, `EIDO_AGENT_SESSION_ID`)
([`electron/eidoCli.ts:227-272`](../../electron/eidoCli.ts#L227-L272)).

The standalone CLI first resolves the installation, creates a live socket
client, and supplies a headless Electron fallback for ordinary Profile
operations
([`electron/eidoCliStandalone.ts:65-141`](../../electron/eidoCliStandalone.ts#L65-L141)).
`routeStandaloneRequest` refuses headless fallback for Agent Run operations:
if the live app is absent/unavailable, `run.submit` returns live-required or
outcome-unknown rather than launching a headless run
([`electron/eidoCliStandalone.ts:143-221`](../../electron/eidoCliStandalone.ts#L143-L221)).
Ordinary headless Profile calls spawn the packaged Electron executable with
`--eido-profile-json`, bounded stdin/stdout/stderr, timeout, termination grace,
and correlation by request id
([`electron/eidoCliStandalone.ts:311-357`](../../electron/eidoCliStandalone.ts#L311-L357)).

The Agent Run submit payload contains only Idea/card identity (or a bounded
variation shape); it deliberately carries no provider, model, credential, or
prompt. It returns a queued identity and later exposes status and bounded
artifact references
([`src/brain/agentRunContract.ts:40-178`](../../src/brain/agentRunContract.ts#L40-L178)).
Admission rejects non-OpenRouter boards because local command configuration is
device-local and Agentic loops have no finite reservation model
([`src/brain/agentRunSession.ts:805-825`](../../src/brain/agentRunSession.ts#L805-L825)).
The executor then rechecks live authority, the admitted fingerprint, and exact
owned artifacts around every ordinary Ask/Conversation step
([`src/brain/agentRunExecutor.ts:69-160`](../../src/brain/agentRunExecutor.ts#L69-L160)).

### Consequence for the BERD comparison

Eido's CLI does **not** stream Claude/Codex output directly to the caller. It
routes a bounded job request into the live app, and the caller polls `status`
and `read`; model output remains an app-owned OutputVersion. This is an
intentional authority boundary, not an omission in the harness bridge.

## 7. Likely comparison seams and improvement opportunities for Eido

These are hypotheses/recommendations derived from the source map, not claims
about BERD's implementation.

| Seam | Current Eido shape | What to compare / learn from BERD |
| --- | --- | --- |
| Provider registry | Static union plus switch statements for args/parsers | Whether a declarative adapter registry can preserve hard safety rules while making new harnesses less invasive |
| Installation/readiness | User-entered command, ambient CLI auth, no visible preflight capability probe | How BERD detects install path, version, login state, supported flags, model catalog, and actionable unavailable reasons |
| Command schema | One executable command string plus Eido-owned vendor args; `shell:false` | Whether provider command specs should model executable, fixed args, user args, environment, cwd, and feature capabilities separately |
| Session semantics | Claude no session persistence; Codex ephemeral; follow-up uses frozen Eido prompt, not CLI session continuation | Whether BERD's session/chat identity can improve continuation without weakening reproducibility and Run provenance |
| Stream normalization | Hardcoded provider-specific JSONL answer events, terminal-prefix reconciliation | How to make parsers version-tolerant, discover event schema, and retain tool/reasoning/usage telemetry without mixing it into answer text |
| Tool ownership | Local harness owns tools and loops; Eido records only normalized answer text | Whether BERD exposes a stable harness event envelope that lets Eido show tool activity while preserving provider ownership |
| Output bounds | Request/assets are bounded; subprocess stdout/text has no explicit output cap in `runHarness` | Whether BERD caps output, applies backpressure, or uses a framed protocol to prevent a noisy CLI from consuming unbounded memory |
| Cancellation | Process-group SIGTERM then SIGKILL, joined on app close | Whether BERD adds graceful stdin/interrupt semantics, tree cleanup across platforms, and explicit cancellation acknowledgement |
| Failure taxonomy | Four bounded errors; no raw CLI stderr surfaced | Whether BERD's diagnostics can be translated into stable user-actionable classes without leaking provider internals |
| External CLI routing | `eido run` is live-only, OpenRouter-only, queued/status/read | Whether Eido should ever support a separate CLI-to-harness path; current ADRs favor app authority and prohibit headless Agent Runs |

## 8. Facts, inferences, and unresolved questions

### High-confidence facts

- One ordinary run engine feeds both remote and local provider boundaries.
- Local harnesses are launched only from Electron main via a typed preload IPC
  bridge, with prompt stdin, JSONL stdout, explicit vendor flags, process-tree
  cancellation, and temporary asset staging.
- The bridge carries no credential; local CLI authentication remains ambient to
  the installed process.
- Eido normalizes provider-specific answer events and fails closed on output
  incompatibility.
- The installed `eido` CLI is a bounded Profile Gateway interface. `run.submit`
  requires a live app and currently admits OpenRouter-only, non-Agentic plans.

### Inferences

- The strongest reusable seam for Eido is a provider adapter contract around
  `start/run/cancel`, typed event normalization, and capability metadata; the
  graph/run engine should stay above it.
- BERD's likely advantage to investigate is operational maturity at installation
  and harness readiness, not a fundamentally different Eido Run model.
- Session continuity is the largest user-facing trade-off in Eido's current
  local path: deterministic one-shot prompts are easy to provenance, while
  harness-native chat/session reuse is not represented.

### Unresolved questions for the combined BERD study

- Does BERD discover, install, upgrade, or merely invoke provider binaries?
- Is its provider contract event-based and versioned, or does each provider
  parser know a bespoke stdout protocol like Eido's current switch?
- How does BERD represent a conversation/session id across Claude Code and
  Codex, and how does it reconcile provider-native history with app-owned
  history?
- Does BERD impose output, token, timeout, and cancellation bounds at the
  router, provider, or child-process layer?
- Which BERD behaviors are safe to import without violating Eido's invariants:
  plan-before-run, exact Run provenance, local Profile authority, no credential
  transit, provider-owned tool loops, and live-only delegated execution?

## Primary source index

- [`src/brain/aiProvider.ts`](../../src/brain/aiProvider.ts)
- [`src/brain/aiProviderTypes.ts`](../../src/brain/aiProviderTypes.ts)
- [`electron/aiHarnessBridgeContract.ts`](../../electron/aiHarnessBridgeContract.ts)
- [`electron/aiHarnessMainSession.ts`](../../electron/aiHarnessMainSession.ts)
- [`src/brain/runEngine.ts`](../../src/brain/runEngine.ts)
- [`src/brain/openRouter.ts`](../../src/brain/openRouter.ts)
- [`src/graph/store.ts`](../../src/graph/store.ts)
- [`src/graph/types.ts`](../../src/graph/types.ts)
- [`electron/eidoCli.ts`](../../electron/eidoCli.ts)
- [`electron/eidoCliStandalone.ts`](../../electron/eidoCliStandalone.ts)
- [`src/brain/agentRunSession.ts`](../../src/brain/agentRunSession.ts)
- [`src/brain/agentRunExecutor.ts`](../../src/brain/agentRunExecutor.ts)
- [`docs/foundations/execution-layer.md`](../../docs/foundations/execution-layer.md)
- [`docs/adr/0031-live-agent-routing-over-local-socket.md`](../../docs/adr/0031-live-agent-routing-over-local-socket.md)
- [`docs/adr/0033-agentic-runs-delegate-tool-use-to-the-provider.md`](../../docs/adr/0033-agentic-runs-delegate-tool-use-to-the-provider.md)
- [`docs/adr/0036-eido-runs-the-tool-loop.md`](../../docs/adr/0036-eido-runs-the-tool-loop.md)
