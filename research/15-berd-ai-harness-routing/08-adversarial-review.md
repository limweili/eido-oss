# Adversarial review: BERD routing lessons for Eido

## Verdict

The seven research lanes support a useful conclusion, but not the strongest
version of the proposed migration:

> **Adopt BERD’s contract discipline around Eido’s existing one-shot direct
> adapters first. Do not replace them with persistent ACP sessions or a
> long-lived AI broker until a separate Eido decision proves that session
> continuity is worth changing provenance, cancellation, authority, and
> credential boundaries.**

BERD clearly demonstrates app-owned installation, typed target selection,
backend-owned readiness/auth orchestration, per-session race fencing, and
transport-aware event handling. It does **not** prove that Goose’s internal
child-process topology is known from the BERD checkout, that ACP is a complete
semantic replacement for Eido’s current local CLI contract, or that BERD’s
persistent conversation model is compatible with Eido’s graph/run model.

The smallest safe lesson is a provider-adapter hardening slice. A BERD-like
broker/ACP adapter should be an optional experiment behind that seam, not the
first production replacement.

## 1. Evidence corrections

### 1.1 BERD’s final dispatch hop is an inference, not a checked-in BERD fact

The opening diagram in the adapter lane says “Goose resolves the provider ID
to the corresponding bridge and owns the child-process lifecycle,” while the
same lane later correctly says that the provider resolver, pooling, and bridge
process lifetime are not in BERD’s tree ([01-provider-adapters.md#L7-L28](01-provider-adapters.md#L7-L28), [01-provider-adapters.md#L150-L166](01-provider-adapters.md#L150-L166)). The runtime lane makes the same boundary explicit: the long-lived `goosed` and renderer ACP client are facts, but one-child-per-session versus pooling is unknown ([02-chat-routing-and-runtime.md#L1-L17](02-chat-routing-and-runtime.md#L17-L23), [02-chat-routing-and-runtime.md#L259-L279](02-chat-routing-and-runtime.md#L259-L279)).

Correct wording:

```text
Known: BERD installs shims, exposes PATH/GOOSE_SEARCH_PATHS, starts goosed,
       and sends ACP provider/session operations.
Inferred: Goose uses that provider/search-path contract to reach a bridge.
Unknown: child lifetime, pooling/multiplexing, exact bridge launch flags,
         and all provider-native supervision behavior.
```

The source boundary is the pinned Goose dependency, not a BERD implementation
file: BERD’s own lock pins Goose separately at `063694cf`, and the upstream
repository had moved by the inspection date ([07-upstream-harness-contracts.md#L5-L15](07-upstream-harness-contracts.md#L5-L15)). The direct BERD citations remain strong for the app-to-Goose contract, but diagrams and recommendations must not promote the final hop to “fact.”

### 1.2 The installed-app evidence has a contradictory scope statement

The install/auth lane reports inspection of app-data bridge shims, managed Node,
and `packages/state.json`, including bridge versions `0.70.0` and `1.6.2`
([03-install-discovery-auth.md#L172-L182](03-install-discovery-auth.md#L172-L182)). The forensic lane says its scope included “no app-data inspection” ([04-installed-app-forensics.md#L1-L5](04-installed-app-forensics.md#L1-L5)) and later repeats that no app-data directory was inspected ([04-installed-app-forensics.md#L358-L364](04-installed-app-forensics.md#L358-L364)).

This does not invalidate either lane, but it does invalidate treating their
observations as one evidence set. The review should separate:

- **Pinned-source intent:** BERD source at `874e078c`, with managed bridge
  pins `0.66.0` and `1.2.0`.
- **Installed-release corroboration:** app version `0.6.2`, observed bridge
  pins `0.70.0` and `1.6.2`, and an unknown build commit.
- **Bundle-only forensics:** signed binaries/resources and symbol/string
  evidence, which cannot establish app-data state, auth, or a successful chat.

The forensic lane correctly warns not to attribute exact binary behavior to
`874e078c` without release provenance ([04-installed-app-forensics.md#L294-L334](04-installed-app-forensics.md#L294-L334)). That warning should govern the whole research set. Any runtime claim must name its release/version evidence; any source claim must use the pinned ref.

### 1.3 “Vendors the full CLI” is source-comment evidence, not proof of semantic equivalence

The managed installer comments and lock graph support that the bridge package
contains a native harness executable; the upstream bridge package itself is a
separate artifact. The lanes mostly handle this correctly by calling the
relationship medium-confidence or unknown ([02-chat-routing-and-runtime.md#L523-L539](02-chat-routing-and-runtime.md#L523-L539), [03-install-discovery-auth.md#L203-L209](03-install-discovery-auth.md#L203-L209)).

Do not infer from that evidence that:

- the bundled executable behaves like the user-facing global CLI;
- auth/config state is shared with a global installation;
- the bridge’s native event set equals raw CLI `stream-json`; or
- every release preserves the same flags, model selection, permission, and
  session semantics.

The upstream contract lane itself says raw Claude CLI, Codex app-server, ACP,
and Goose are different products ([07-upstream-harness-contracts.md#L47-L58](07-upstream-harness-contracts.md#L47-L58), [07-upstream-harness-contracts.md#L101-L109](07-upstream-harness-contracts.md#L101-L109)). That distinction must survive the final report.

### 1.4 ACP is a useful control-plane shape, not a universal behavior contract

ACP lifecycle/content/update/permission methods are a reasonable candidate
for an adapter interface, but the same source study records provider-specific
transport, session identity, auth, permission, cancellation, and extension
semantics ([07-upstream-harness-contracts.md#L60-L99](07-upstream-harness-contracts.md#L60-L99)). BERD’s system-prompt handoff is not equivalent to a native system/developer channel; it is an in-band assistant-audience workaround ([01-provider-adapters.md#L333-L354](01-provider-adapters.md#L333-L354)).

Therefore “ACP-compatible” must mean “supports the subset and capability
snapshot this adapter negotiated,” not “all providers have equivalent
sessions, tools, permissions, model selection, or system prompts.”

### 1.5 BERD’s permission fallback is a warning, not an adoption target

The failure lane records that BERD’s ACP connection auto-approves the first
permission option when no application handler is installed ([06-failure-modes-and-tests.md#L99-L103](06-failure-modes-and-tests.md#L99-L103)). Eido’s current headless local harnesses intentionally use restrictive modes: Claude `dontAsk`, Codex ephemeral/read-only, and Antigravity sandbox; approval-requiring actions fail closed ([05-eido-current-architecture.md#L193-L239](05-eido-current-architecture.md#L193-L239)).

Eido must not import a generic ACP `approve: boolean` or an implicit “first
option” fallback. Any future interactive adapter must preserve request kind,
scope, policy, and decision lifetime; a headless path should deny or use an
explicit, named policy.

## 2. Recommendations that need qualification or rejection

### 2.1 Keep Eido’s one-shot direct CLI path as the default

The current Eido adapter has an explicit trust boundary: Electron main owns
the child, passes the prompt on stdin, parses provider-documented JSONL (with
no explicit subprocess output cap today),
uses provider-specific safety flags, and terminates the process tree on cancel
([05-eido-current-architecture.md#L169-L263](05-eido-current-architecture.md#L169-L263), [05-eido-current-architecture.md#L361-L372](05-eido-current-architecture.md#L361-L372)). Claude is launched with `--no-session-persistence`; Codex uses `--ephemeral`; and the execution foundation treats local harnesses as installed, already-authenticated CLIs whose credentials/output stay outside Profile data ([05-eido-current-architecture.md#L264-L309](05-eido-current-architecture.md#L264-L309), [docs/foundations/execution-layer.md#L20-L22](../../docs/foundations/execution-layer.md#L20-L22)).

That is not a missing feature that BERD has disproved. It is a deliberate
reproducibility and authority choice. Persistent ACP sessions would introduce
new questions that BERD does not answer for Eido:

- Is the provider-native history authoritative, or is Eido’s Run/output graph
  authoritative?
- How does a resumed native session preserve Eido’s frozen compiled prompt,
  provider/model provenance, cwd, auth, and source fingerprints?
- What happens when the user switches provider/model after a prior turn?
- Can an uncertain prompt submission be retried without duplicating a turn?
- How are native session files kept outside Profile while still being
  recoverable and attributable?

Until those are answered in an Eido ADR, persistent ACP is an optional adapter
spike, not a replacement for `createInstalledAiHarnessMainSession`.

### 2.2 Do not route `eido run` directly to a harness

BERD’s `berdctl` can send into an existing persistent session and return once
the prompt crosses its transport boundary ([02-chat-routing-and-runtime.md#L381-L403](02-chat-routing-and-runtime.md#L381-L403)). It is tempting to copy that shape for Eido’s installed CLI. That would violate current Eido authority boundaries.

Eido’s CLI is a Profile Gateway client, not a model-output stream. Delegated
AI is live-only, admitted, bounded, and returns queued identities plus bounded
artifact references; the request cannot carry provider, model, credential, or
prompt ([05-eido-current-architecture.md#L311-L349](05-eido-current-architecture.md#L311-L349)). The execution foundation says “headless execution is prohibited” for delegated execution and requires revalidation before every model egress ([docs/foundations/execution-layer.md#L32-L40](../../docs/foundations/execution-layer.md#L32-L40)). ADR 0031 likewise allows only live OpenRouter-backed Conversations/non-Agentic Ask chains through the Agent Gateway ([docs/adr/0031-live-agent-routing-over-local-socket.md#L42-L60](../../docs/adr/0031-live-agent-routing-over-local-socket.md#L42-L60)).

Recommendation: keep two concepts separate:

```text
eido CLI -> authenticated Profile Gateway -> app-owned Run engine
in-app run -> Electron main -> direct one-shot local harness adapter
```

An ACP/Goose experiment may be an in-app execution adapter, but it must not
become a new CLI-to-provider bypass or a way for the caller to choose a
provider/prompt/credential outside the admitted app state.

### 2.3 Do not make persistent `wireSessionId` mandatory

The upstream lane proposes persisting `wireSessionId`, cwd, effective target,
and capabilities ([07-upstream-harness-contracts.md#L125-L146](07-upstream-harness-contracts.md#L125-L146)). That is valid for a product whose conversation is the harness session. It is not automatically valid for Eido, where every step creates a provenanced Run and output version, follow-ups reuse frozen compiled instructions, and provider changes create a new version ([docs/foundations/execution-layer.md#L30-L38](../../docs/foundations/execution-layer.md#L30-L38)).

Adopt the *shape* of an opaque adapter/run identity first, without committing
to native session persistence:

```text
run route snapshot:
  harnessId / provider / model / adapter version / executable source
  cwd + redacted environment fingerprint
  protocol + capability snapshot
  local requestId + child identity

wireSessionId: optional, adapter-owned, only for a proven persistent adapter
```

The local one-shot adapter can use `wireSessionId = absent` and still gain
route provenance, target acknowledgement, generation fencing, and diagnostics.

### 2.4 Do not copy BERD’s managed install as the first change

BERD’s staged `npm ci`, integrity graph verification, absolute shims, and
last-known-good promotion are excellent if Eido chooses to own a bridge supply
chain ([01-provider-adapters.md#L95-L126](01-provider-adapters.md#L95-L126)). But Eido currently delegates installation and auth to a user-installed,
already-authenticated CLI ([05-eido-current-architecture.md#L264-L293](05-eido-current-architecture.md#L264-L293)). App-owned bridge downloads add a new supply-chain owner, lock-refresh cadence, artifact signing/provenance, license/runtime distribution, update UX, disk cleanup, and credential migration surface.

First adopt the *state model* without adopting the installer:

```text
configured command -> preflight/health probe -> installed/runnable/authenticated
                   -> one-shot invocation -> bounded diagnostics
```

Only if Eido’s product decision is “we own the bridge” should it implement
staging, full-graph verification, atomic promotion, and last-known-good
retention. Otherwise, use BERD’s discipline as an acceptance checklist for a
future managed-install ADR, not as permission to silently change user-owned
CLI behavior.

### 2.5 Do not import BERD’s model inventory as Eido graph state

BERD’s cache and provider inventory are useful for UI readiness, but Eido’s
provider/model catalogs are Idea state while commands are device state
([05-eido-current-architecture.md#L64-L119](05-eido-current-architecture.md#L64-L119), [docs/foundations/execution-layer.md#L20-L22](../../docs/foundations/execution-layer.md#L20-L22)). Dynamic capabilities should be ephemeral or a bounded route snapshot, not a new source of graph context or a large persistent session journal. Plans must stay lean and must not copy content into durable execution records ([docs/foundations/execution-layer.md#L32-L36](../../docs/foundations/execution-layer.md#L32-L36)).

If a model probe returns empty or stale, preserve the selected Eido model and
report readiness uncertainty; do not rewrite Idea state merely because BERD
does so for its own inventory/cache semantics.

### 2.6 Preserve Eido’s provider-owned tool loops

The BERD event algebra recommendation includes tool/permission events. Eido
should only record events its adapter can substantiate and must not create a
second tool loop beside local harnesses. ADR 0033 states that local CLIs own
their tools and loops; ADR 0036 preserves that rule even after adding an Eido
loop for Linkup-backed OpenRouter ([docs/adr/0033-agentic-runs-delegate-tool-use-to-the-provider.md#L25-L58](../../docs/adr/0033-agentic-runs-delegate-tool-use-to-the-provider.md#L25-L58), [docs/adr/0036-eido-runs-the-tool-loop.md#L37-L68](../../docs/adr/0036-eido-runs-the-tool-loop.md#L37-L68)).

The safe adoption is “retain raw/unknown provider events at the adapter edge
when available; normalize only answer events and explicitly supported
telemetry.” Do not advertise a universal tool trail for harness-owned or
server-side activity. If Eido records an opaque tool event, preserve its
unknown kind as data; keep the set of tools Eido itself declares closed, as
ADR 0035 distinguishes declared capability from recorded vocabulary
([docs/adr/0035-the-tool-vocabulary-is-open-the-declared-set-is-closed.md#L21-L39](../../docs/adr/0035-the-tool-vocabulary-is-open-the-declared-set-is-closed.md#L21-L39)).

## 3. Missing counterarguments and risks

The lanes emphasize BERD’s operational maturity. The following costs need to
remain visible before treating BERD as the target architecture:

1. **Persistent session lock-in.** Once an Eido conversation depends on a
   Claude ACP history file, Codex thread, or Goose session, switching adapter
   versions/providers may require migration or transcript replay. One-shot
   prompts avoid that lock-in at the cost of less native continuity.
2. **Authority duplication.** A long-lived broker can become a second writer
   or second durable truth next to Eido’s Run engine. ADR 0031 allows one
   app-owned live authority and preserves headless fallback constraints; a
   harness broker must remain subordinate to that authority.
3. **Ambiguous submission is harder, not easier.** A WebSocket/ACP prompt may
   be accepted remotely while the client times out. Retrying can duplicate a
   turn; reconnecting can leave provider work running. BERD’s own cancellation
   evidence says a resolved cancel means only that the request did not throw,
   not that remote work stopped ([02-chat-routing-and-runtime.md#L407-L424](02-chat-routing-and-runtime.md#L407-L424)). Eido’s current child ownership and run cancellation are simpler to reason about.
4. **Credential boundary expansion.** BERD’s app-managed bridge still
   delegates provider auth to harness/Doctor state; Eido currently keeps local
   CLI credentials ambient and outside Profile. A managed bridge can change
   which home/config/keychain is consulted even if the executable has the same
   name.
5. **Operational surface area.** A broker needs authenticated transport,
   orphan cleanup, backpressure, reconnect rules, per-session leases, process
   identity, and shutdown draining. BERD’s own focused tests identify these as
   non-obvious failure surfaces, not free benefits ([06-failure-modes-and-tests.md#L41-L109](06-failure-modes-and-tests.md#L41-L109)).
6. **Supply-chain freshness.** Full lock replay improves reproducibility but
   can delay transitive security updates; the BERD lock artifact explicitly
   records this trade-off ([01-provider-adapters.md#L117-L126](01-provider-adapters.md#L117-L126)). Eido would need an owner and release cadence.
7. **Semantic mismatch in context injection.** BERD’s first-turn assistant
   handoff is useful but is not a native system prompt. Eido’s system guidance
   is an execution envelope and must not enter compiled instruction, plans, or
   source fingerprints ([docs/foundations/execution-layer.md#L34-L38](../../docs/foundations/execution-layer.md#L34-L38)).
8. **Permissions and safety defaults differ.** Claude, Codex, Goose, and Eido
   do not share approval semantics. A single normalized boolean loses scope
   and lifetime; a permissive fallback can turn a headless read-only run into
   an action-capable one.

## 4. Smallest accurate adoption sequence

This sequence extracts the high-value lessons without changing Eido’s current
authority or session semantics.

### Slice 1 — route identity and diagnostics (lowest risk)

Add an internal adapter metadata record around the existing `streamCompletion`
and main-process session. Record, per Run, the canonical harness, requested and
effective model, adapter/protocol version, executable source/path (redacted as
needed), cwd, and a capability/readiness snapshot. Keep the current provider
union and command settings; do not add persistent native session IDs. This
builds on Eido’s existing provider/model provenance ([05-eido-current-architecture.md#L120-L169](05-eido-current-architecture.md#L120-L169)).

Acceptance: a run can answer “which route actually ran?” without reading
provider strings out of output or changing Profile authority.

### Slice 2 — typed adapter registry, still one-shot

Move the current command/argument/parser switch behind a registry with typed
invocation, environment allowlisting, protocol kind (`claude-jsonl`,
`codex-jsonl`, etc.), safety policy, and bounded health probe. Preserve
`shell:false`, stdin prompts, temporary assets, process-group cancellation,
terminal-prefix reconciliation, and the existing four bounded error classes
([05-eido-current-architecture.md#L169-L263](05-eido-current-architecture.md#L169-L263)).

Acceptance: adding or changing one harness touches its adapter record/parser,
not the run engine or graph provenance; tests prove unknown harnesses and
unrecognized output still fail closed.

### Slice 3 — readiness/preflight state machine

Add `not_configured`, `installed`, `runnable`, `authenticated` (or
`auth_unknown`), and `failed/retryable` as adapter readiness states. For
user-owned CLIs, probe without taking credential ownership; sanitize diagnostics
and retain the selected route on transient failures. BERD’s separation of
installed/runnable/authenticated is the useful lesson ([03-install-discovery-auth.md#L103-L115](03-install-discovery-auth.md#L103-L115)).

Acceptance: a missing command, bad executable, auth failure, and protocol drift
produce distinct actionable classes before a model call.

### Slice 4 — race and stream hardening

Add a run generation/owner token, explicit output queue bounds/backpressure,
malformed-event policy, and child identity evidence. Quarantine late events
after cancel or timeout and retain raw bounded diagnostics. Do not infer remote
completion from transport close. BERD’s ordering/ownership lessons and Eido’s
existing process cleanup are the right seams ([06-failure-modes-and-tests.md#L91-L103](06-failure-modes-and-tests.md#L91-L103), [05-eido-current-architecture.md#L238-L263](05-eido-current-architecture.md#L238-L263)).

Acceptance: cancellation, child exit, noisy/unknown JSONL, slow consumers, and
late terminal events cannot write to a newer Run or consume unbounded memory.

### Slice 5 — optional ACP/app-server spike, no default switch

Implement one disposable adapter (prefer Codex app-server or a pinned ACP
bridge) behind the same typed registry. Measure: startup cost, auth/config
behavior, capability negotiation, session/load semantics, permission requests,
cancellation acknowledgement, replay, and provider/model drift. Keep
`wireSessionId` optional and keep Eido’s Run/output graph authoritative.

Acceptance: the spike can be abandoned without changing current providers or
serialized Profile data; every unsupported capability is explicit; no CLI
caller can bypass the Profile Gateway.

### Slice 6 — only then decide on persistent sessions

If the spike demonstrates a material user benefit, write an Eido ADR before
making native sessions durable. The ADR must define Eido Run identity versus
native wire identity, transcript authority, provider switching, cwd/auth
changes, retry/idempotency, migration/version pinning, cancellation, shutdown,
and Profile privacy. If those costs do not pay for themselves, retain the
one-shot adapter and stop; the research has still delivered the operational
hardening benefits.

## 5. Final correction to the research thesis

BERD is a strong reference for **provider boundary engineering**:

```text
canonical target
  -> backend-owned readiness/install/auth policy
  -> adapter-specific transport and safety semantics
  -> explicit process/environment ownership
  -> normalized, generation-safe events
  -> durable app-owned result/provenance
```

It is not evidence that Eido should copy BERD’s complete runtime topology.
Eido’s current product truth is different:

```text
plan/compile -> one Eido Run -> Electron main one-shot harness child
             -> bounded answer stream -> provenanced OutputVersion

eido CLI     -> authenticated Profile Gateway -> live/app-owned Run engine
```

The recommended direction is therefore **adapter discipline around one-shot
execution, followed by a reversible ACP spike**. Persistent sessions or a
long-lived AI broker become a deliberate Eido architecture decision only if
the spike proves that continuity, steering, or richer event fidelity outweighs
the new authority and provenance costs.

## Source anchors

The local memo links above are the review trail. The primary implementation
anchors behind the corrections are:

- BERD managed bridge registry/install transaction: [`managed_acp_tools.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L252-L321), [`managed_acp_tools.rs` verification](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1102-L1201), and [`acp-tools.lock.json`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/acp-tools.lock.json#L1-L20).
- BERD Goose process/environment boundary: [`goose_serve.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L147-L246) and [`acpApi.ts`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts#L405-L486).
- Pinned upstream versions: [Goose `063694cf`](https://github.com/aaif-goose/goose/tree/063694cf769269c1f151416605687991fdcbc496), [Claude ACP `0.66.0`](https://github.com/agentclientprotocol/claude-agent-acp/tree/6b405138fc82be947964612fac04e56654827b66), and [Codex ACP `1.2.0`](https://github.com/agentclientprotocol/codex-acp/tree/b51bedf60050c60fef78fc669e6ccf2ff61e3f47).
- Eido authority and execution invariants: [`execution-layer.md`](../../docs/foundations/execution-layer.md), [ADR 0031](../../docs/adr/0031-live-agent-routing-over-local-socket.md), [ADR 0033](../../docs/adr/0033-agentic-runs-delegate-tool-use-to-the-provider.md), and [ADR 0036](../../docs/adr/0036-eido-runs-the-tool-loop.md).
