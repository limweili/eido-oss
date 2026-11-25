# What Eido should learn from BERD's AI harness routing

Date: 2026-08-22

Research snapshot: BERD [`874e078c931c14386a7d2e16cfe3b32cdbe295e0`](https://github.com/block/berd/tree/874e078c931c14386a7d2e16cfe3b32cdbe295e0), installed BERD 0.6.2, and Eido `02a4b11fd02682e48020bf221155a57d2c534527`.

## Executive conclusion

BERD routes Claude Code and Codex through **managed ACP bridges behind one long-lived Goose broker**. Its React UI never constructs vendor command lines. BERD pins each bridge and its transitive npm graph, installs it into private app data with a managed Node runtime, verifies the platform-native harness executable, promotes it transactionally, and puts an absolute shim on Goose's search path. The UI then routes a canonical harness/provider/model target through ACP sessions and consumes a normalized bidirectional event stream. BERD source proves the install, search-path, and app-to-broker session contract; the [Goose commit pinned by BERD](https://github.com/aaif-goose/goose/tree/063694cf769269c1f151416605687991fdcbc496) and the pinned bridge sources establish the final provider-to-child dispatch. The primary BERD sources are explicit about the managed packages, versions, and private lifecycle in [`managed_acp_tools.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1-L35) and the long-lived broker in [`goose_serve.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L47-L70).

Eido is not a primitive version of that architecture. Eido already has a strong provider-neutral run seam, typed renderer-to-main harness contract, command execution with `shell:false`, disposable asset staging, provider-specific JSONL parsers, fail-closed output reconciliation, process-group cancellation, and graph-owned provenance. These guarantees are visible in [`src/brain/aiProvider.ts`](../../src/brain/aiProvider.ts), [`electron/aiHarnessBridgeContract.ts`](../../electron/aiHarnessBridgeContract.ts), and [`electron/aiHarnessMainSession.ts`](../../electron/aiHarnessMainSession.ts). Its local harness calls are intentionally ephemeral. The graph and `RunRecord` remain the authority, not a provider-native chat transcript.

The best move is therefore **to deepen Eido's existing adapter boundary before replacing it**. Copy BERD's operational contracts first: target identity, capability/readiness state, install provenance, version probes, upgrade conformance, and race fencing. Adopt an ACP broker only if Eido chooses provider-native session continuity, tool/permission events, or richer bidirectional control as a product capability.

## The architecture BERD actually uses

```text
BERD UI or berdctl
  -> canonical target { harnessId, modelProviderId?, modelId? }
  -> per-session target coordinator and mutation queue
  -> one authenticated local ACP WebSocket
  -> long-lived bundled `goosed serve`
       -> `goose` route: Goose model-provider policy
       -> `claude-acp`: app-private shim -> Claude ACP bridge -> vendored Claude Code
       -> `codex-acp`: app-private shim -> Codex ACP bridge -> vendored Codex
  -> ACP session notifications
  -> BERD text/thought/tool/usage/config reducers and persisted session metadata
```

Four identities remain separate:

1. **Harness:** which agent runtime owns the conversation, such as `goose`, `claude-acp`, or `codex-acp`.
2. **Model provider:** which account or endpoint the harness uses, when that is a separate choice.
3. **Model:** the concrete model acknowledged for the session.
4. **Executable/adapter:** the physical bridge and version used to reach the harness.

BERD's target type makes the first three distinctions explicit in [`sessionExecutionTarget.ts`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sessionExecutionTarget.ts#L3-L82). Managed shims and state make the fourth explicit in [`managed_acp_tools.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L69-L100).

## What BERD solved that is easy to underestimate

### Reproducible installation, not a lucky PATH hit

Claude and Codex bridge packages vendor their full harness CLI. BERD replays a checked-in npm lock with `npm ci`, verifies exact versions and integrity, requires the target-native executable, writes an absolute shim, and atomically promotes tree, shim, and state. A failed upgrade leaves the previous bridge usable. [`managed_acp_tools.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L459-L607) and [PR #48](https://github.com/block/berd/pull/48) show that root-only or `@latest` pinning had already caused supply-chain and availability failures.

### Readiness is a state machine

BERD distinguishes catalogued, missing, installed, bridge-broken, authentication-needed, and ready. Its Doctor readout tracks main and bridge paths, versions, install sources, freshness, and auth state. Backend-owned setup re-probes current state and accepts a typed fix identity, never an arbitrary renderer shell command. See [`agent_setup.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L118-L185) and [`useAgentProviderStatus.ts`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/providers/hooks/useAgentProviderStatus.ts#L20-L105).

### A selected target is not ready until acknowledged

BERD serializes provider/model/load/prompt mutations per session. It tracks desired, acknowledged, and observed targets separately; operation IDs and leases prevent a stale picker or replay result from retargeting a newer prompt. An ambiguous mutation timeout invalidates the ACP connection because remote state is unknowable. See [`acpSessionRegistry.ts`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpSessionRegistry.ts#L31-L129) and [`sessionTargetCoordinator.ts`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sessionTargetCoordinator.ts#L236-L445).

### Events carry ownership and order

ACP lets BERD receive text, thinking, tool calls, permissions, usage, and config updates without parsing each vendor's human CLI output. BERD still fences live updates by prompt owner, attaches tool updates by exact ID, flushes text before tool/image transitions, and coalesces UI writes. [`acpNotificationHandler.ts`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/acp/acpNotificationHandler.ts#L575-L844) and [`liveStreamingUpdates.ts`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/acp/liveStreamingUpdates.ts#L235-L439) show the work above the wire protocol.

### Recovery preserves user work

BERD holds a session lease across replay so live events cannot be mistaken for history and discarded. It recreates an empty stranded session at the selected provider only before a backend turn exists, preserving the user's typed prompt. It retains a populated model inventory when a refresh returns an empty, potentially transient result. These repairs are narrow because broad automatic recovery would corrupt committed conversation state. See [`strandedProviderRecovery.ts`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/model-selection/strandedProviderRecovery.ts#L19-L149) and [PR #163](https://github.com/block/berd/pull/163).

## BERD and Eido optimize for different authorities

| Question | BERD | Eido | Consequence |
| --- | --- | --- | --- |
| What owns a conversation? | Persistent backend/ACP session and replay | Graph-derived plan, `RunRecord`, and `OutputVersion` | Eido should not make provider history authoritative merely to gain a common transport. |
| How is a harness reached? | Goose broker selects an ACP bridge | Electron main directly launches a configured CLI | Eido has less infrastructure but owns vendor argv/event drift. |
| How long does a harness session live? | Persistent and resumable | One-shot; Claude no persistence, Codex ephemeral | BERD's session actor is valuable only if persistence becomes a product need. |
| What is normalized? | Bidirectional ACP events | Answer text chunks plus bounded terminal result/errors | ACP could unlock tool/thought/permission telemetry, but it also expands the product contract. |
| Who owns installation? | BERD-managed private runtime/bridges for Claude and Codex | User-installed, already-authenticated CLI plus device-local command | Managed install improves reproducibility but adds supply-chain, update, disk, signing, and support ownership. |
| How does external CLI automation run? | `berdctl` reuses the running app's session transport | `eido run` enters the live app's admitted ordinary runner and is OpenRouter-only | Both correctly avoid inventing a second execution engine. Eido's Profile authority must remain intact. |

Eido's existing boundary already preserves several lessons BERD validates: provider and model provenance, backend-owned command execution, no local-harness credential in the renderer contract, provider-owned tool loops, and joined process cleanup. The detailed Eido trace is in [doc 05](05-eido-current-architecture.md).

## Copy, adapt, and do not copy

### Copy now

1. **A declarative harness-adapter registry.** Move canonical ID, aliases, command source, install provenance, readiness/auth probe, model inventory, system-context strategy, event protocol, cancellation, and capabilities out of scattered switches. Keep Eido's hard safety rules in adapter code, not editable data.
2. **Requested versus effective target identity.** Record harness, requested/effective model, adapter version, and command source with each run. A stale or rewritten model selection must be visible rather than inferred.
3. **A readiness/Doctor surface.** Report `missing`, `installed`, `authentication-needed`, `ready`, and `incompatible`, with redacted executable/version/source evidence. Do not treat a PATH hit as proof that the harness can complete a run.
4. **Version-aware conformance probes.** Against a disposable workspace, exercise one prompt, streamed plus terminal reconciliation, cancellation, malformed/unknown output, permission denial, and clean shutdown for every supported harness version. This is the cheapest way to catch upstream CLI drift before release.
5. **Inventory truth states and generation fencing.** Preserve a last-known-good model list through transient empty results. Bind every async provider/model/readiness result to the generation that requested it.
6. **Explicit stream ownership and bounds.** Add run/message/tool IDs and a bounded slow-consumer policy before richer harness events are introduced. BERD's own WebSocket queue has no explicit maximum, so copy the ownership model, not the unbounded buffer.

### Adapt deliberately

1. **Managed bridges as an optional install mode.** Keep `external` as a product-supported source if Eido values the user's existing harness configuration. Add `managed` only with exact locks, integrity/native verification, atomic promotion, rollback, a cleanup policy, and release ownership.
2. **ACP as one adapter protocol.** ACP can sit behind Eido's current provider seam without becoming Eido's execution authority. Use it when it buys a real capability, such as tool events, permission requests, or provider-native resume.
3. **Per-session actor only for persistent sessions.** Eido's one-shot runs already use an `AbortSignal` and graph run identity. Add BERD-style session serialization when Eido stores an opaque provider session/thread ID or supports simultaneous target mutations.
4. **System-context capability negotiation.** Preserve Eido's deterministic compiled prompt. If an ACP bridge lacks a native system channel, choose and test an explicit in-band handoff instead of silently changing prompt semantics.

### Do not copy

1. **Do not add Goose only to obtain architectural symmetry.** The installed broker is a 265 MB native binary and a separate execution product. It is justified in BERD because Goose is BERD's backend; it is not automatically justified in Eido.
2. **Do not let harness replay replace Eido's graph authority.** A provider session may be useful continuation state, but `RunRecord`, compiled instruction, selected output version, and graph provenance remain the durable product truth.
3. **Do not auto-approve when no permission handler exists.** BERD's ACP fallback approves the first option when no handler is registered. A headless Eido path should fail closed or require an explicitly named non-interactive policy. See [`acpConnection.ts`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpConnection.ts#L46-L92).
4. **Do not discover arbitrary PATH binaries as supported providers.** Keep a curated allowlist and explicit aliases. Discovery reports readiness; it does not grant compatibility.
5. **Do not expose managed install or auth as raw shell commands.** The renderer, external CLI, and automation surfaces should request a typed adapter action; the backend re-probes and owns the command.

## Recommended adoption sequence

### Stage 1: make route identity observable

Preserve the current one-shot subprocess implementation. Record harness, adapter version, resolved executable source, requested/effective model, readiness state, and a redacted environment fingerprint in diagnostics and with each run.

**Why first:** it lets Eido explain exactly what would run without reading credentials or starting a chat, while leaving graph execution semantics unchanged.

### Stage 2: type the adapter and readiness contract

Create a declarative registry around the existing direct CLI adapters. Report explicit capability, auth, and compatibility states. Add provider conformance probes against disposable workspaces.

**Why second:** if a CLI update changes flags or output events, Eido discovers it during release proof instead of after a user run fails.

### Stage 3: harden races and stream ownership

Fence async discovery by generation, distinguish requested from effective targets, bound output queues, reconcile terminal and streamed answers, and quarantine late events after cancellation.

**Proof:** stale discovery, duplicate terminal output, and late events cannot retarget or complete the wrong run.

### Stage 4: spike ACP behind the provider seam

Add one ACP adapter in a disposable integration harness. It must prove capability negotiation, prompt/system-context fidelity, text/tool/permission event mapping, cancellation with late-event quarantine, and process restart/resume. Do not change `runEngine`, graph provenance, or the external Agent Gateway during the spike.

**Learning checkpoint:** does ACP produce product-relevant evidence that the direct JSONL adapter cannot, or merely move the same complexity into a bridge?

### Stage 5: earn persistent sessions

Only if the product chooses harness-native continuation, record the decision in an Eido ADR, then store an opaque wire session ID with harness ID, adapter version, working directory, effective target, capabilities, and last run identity. Introduce a per-session actor and replay rules. Keep graph history authoritative and treat the provider session as rebuildable/replaceable execution state.

Managed installation is a separate later decision, not a prerequisite for ACP. If Eido trials it, model `external | managed | bundled` explicitly and require an exact lock, integrity and native checks, atomic promotion, rollback, cleanup, and a named release owner.

## Acceptance questions for any future Eido adapter

1. Can the app name the exact harness, adapter version, executable source, requested model, effective model, and auth/readiness state without reading secrets?
2. Can a failed or interrupted upgrade leave the previous adapter runnable?
3. Can a late selection, discovery result, replay, or output event mutate only the run/session generation that owns it?
4. Can cancellation identify the provider turn, reach the child, quarantine late events, and finish the graph run exactly once?
5. Can unknown output or missing capability fail precisely without treating human-readable stdout as truth?
6. Can a permission request preserve action, scope, lifetime, reason, and decision instead of collapsing to one boolean?
7. Can the installed `eido` CLI continue to route through the live app's admitted runner without gaining raw provider, credential, prompt, or Profile authority?

## Confidence and limits

- **High confidence:** BERD's Tauri/renderer orchestration, managed bridge install, target coordination, ACP request/event handling, replay, and the Eido direct-adapter comparison. These claims have pinned source links.
- **Medium confidence:** exact Claude/Codex bridge internals. First-party bridge sources were inspected in doc 07, but BERD's pinned versions remain separate release inputs and can drift independently.
- **Installed-app limit:** `/Applications/Berd.app` 0.6.2 confirms the signed bundle and sidecar split, but it is not byte-identical to the inspected BERD commit. Source describes intended behavior; the app bundle describes what was installed on this Mac.
- **Runtime limit:** no live provider chat was sent. This was deliberate: source evidence answers the architecture question, and a real chat would introduce provider credentials, user state, and cost without resolving the remaining design decision.

## Bottom line

BERD's modernity is not “it supports more CLIs.” It is that the harness boundary owns the whole lifecycle: identity, installation, environment, readiness, session mutation, events, permission, cancellation, and recovery. Eido should adopt that depth while keeping its own center of gravity: one graph, plans before runs, durable provenance, and a live app as the only authority for delegated execution.
