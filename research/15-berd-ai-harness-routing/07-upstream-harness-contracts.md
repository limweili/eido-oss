# Upstream AI-harness contracts behind BERD

This note cross-checks BERD's managed Claude Code, Codex, and Goose adapters against their first-party source contracts. The purpose is to separate the parts Eido can make a stable, provider-neutral CLI boundary from the parts that must remain adapter-specific.

## Scope and version ledger

The BERD evidence is the checked-in source at [`block/berd@874e078c`](https://github.com/block/berd/tree/874e078c931c14386a7d2e16cfe3b32cdbe295e0), committed 2026-08-21. The upstream source/docs were inspected 2026-08-22.

| Runtime | What BERD pins at this commit | First-party source used |
| --- | --- | --- |
| Claude Code | `@agentclientprotocol/claude-agent-acp` **0.66.0**; its lock graph includes `@anthropic-ai/claude-agent-sdk` **0.3.220** and platform-native `claude` executables | [Claude ACP v0.66.0, commit `6b405138`](https://github.com/agentclientprotocol/claude-agent-acp/tree/6b405138fc82be947964612fac04e56654827b66); [Claude headless docs](https://code.claude.com/docs/en/headless) |
| Codex | `@agentclientprotocol/codex-acp` **1.2.0**; its lock graph includes `@openai/codex` **0.147.0** and platform-native `codex` executables | [Codex ACP v1.2.0, commit `b51bedf6`](https://github.com/agentclientprotocol/codex-acp/tree/b51bedf60050c60fef78fc669e6ccf2ff61e3f47); [Codex app-server at `4f39251a`](https://github.com/openai/codex/tree/4f39251a010a8bd7d692d25fb33832ff06f1635a) |
| Goose | Rust `goose-cli` binary from `aaif-goose/goose`, ref `main` but pinned to commit `063694cf` | [Goose source at BERD's pinned commit](https://github.com/aaif-goose/goose/tree/063694cf769269c1f151416605687991fdcbc496); [current Goose repository](https://github.com/aaif-goose/goose) |

The BERD pins are explicit in [`acp-tools.lock.json#L4-L20`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/acp-tools.lock.json#L4-L20), [`acp-tools.lock.json#L35-L49`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/acp-tools.lock.json#L35-L49), and [`acp-tools.lock.json#L1320-L1365`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/acp-tools.lock.json#L1320-L1365). Goose's separate pin is [`goose-backend.lock.json#L1-L7`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/goose-backend.lock.json#L1-L7). This matters: BERD is a reproducible snapshot, not a guarantee that current upstream behavior is identical. For example, the current Goose [`main` resolved to `8d844eec`](https://github.com/aaif-goose/goose/commit/8d844eecbdfd65626a881c9e8784ae8dc6093f1d) on 2026-08-22, while BERD runs `063694cf`.

## The architecture BERD is actually routing

BERD does not have the renderer spawn `claude` or `codex` directly. It installs bridge packages into an app-private, lockfile-controlled Node tree, writes absolute-path shims, places those shims in the environment visible to Goose, and starts one long-lived Goose ACP server. The renderer then speaks ACP over a local WebSocket:

```text
BERD startup
   |
   +--> managed Node + npm ci (exact lock + integrity)
   |       |
   |       +--> claude-agent-acp shim --> bundled Claude native executable
   |       +--> codex-acp shim        --> bundled Codex native executable
   |
   +--> goose serve --host 127.0.0.1 --port <free-port>
           |
           +--> WebSocket /acp?token=<secret>
                    |
                    +--> ACP session/new | prompt | cancel | session updates
                              |
                              +--> provider ID resolves to an ACP bridge
```

The private install, lock replay, native-executable verification, and last-known-good promotion are implemented in [`managed_acp_tools.rs#L1-L65`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1-L65) and [`managed_acp_tools.rs#L390-L500`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L390-L500). The Goose process command, secret, search path, and WebSocket endpoint are in [`goose_serve.rs#L147-L246`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L147-L246) and [`goose_serve.rs#L363-L365`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L363-L365). The renderer's ACP initialization and permission/session-update callbacks are in [`acpConnection.ts#L46-L92`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpConnection.ts#L46-L92) and [`acpConnection.ts#L162-L192`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpConnection.ts#L162-L192).

This creates two different contracts:

1. **Portable control plane:** ACP JSON-RPC lifecycle, content blocks, streamed session updates, permissions requests, and cancellation.
2. **Provider runtime plane:** how an executable is installed/launched, which native protocol is underneath ACP, how auth is supplied, what a session identifier means, and how safety policy is enforced.

Eido should normalize only the first plane. Flattening the second plane into a generic `run(command, flags)` abstraction is where the hidden incompatibilities appear.

## Contract comparison

| Concern | Claude Code | OpenAI Codex | Goose | What is portable for Eido |
| --- | --- | --- | --- | --- |
| Install and launch | Claude ACP is a stdio ACP server. It uses `CLAUDE_CODE_EXECUTABLE` when supplied, otherwise resolves a platform-native Claude executable bundled in the SDK package. [`acp-agent.ts#L1023-L1061`](https://github.com/agentclientprotocol/claude-agent-acp/blob/6b405138fc82be947964612fac04e56654827b66/src/acp-agent.ts#L1023-L1061) | Codex ACP starts `<codexPath> app-server`; without an override it starts the bundled `@openai/codex` binary. [`CodexJsonRpcConnection.ts#L15-L42`](https://github.com/agentclientprotocol/codex-acp/blob/b51bedf60050c60fef78fc669e6ccf2ff61e3f47/src/CodexJsonRpcConnection.ts#L15-L42) | `goose acp` is ACP over stdio; `goose serve` is ACP over HTTP/WebSocket at `/acp`, with a required secret by default. [`cli.rs#L826-L890`](https://github.com/aaif-goose/goose/blob/063694cf769269c1f151416605687991fdcbc496/crates/goose-cli/src/cli.rs#L826-L890), [`cli.rs#L1391-L1482`](https://github.com/aaif-goose/goose/blob/063694cf769269c1f151416605687991fdcbc496/crates/goose-cli/src/cli.rs#L1391-L1482) | Adapter registry + launch recipe + transport kind + readiness/health probe. Do not assume every harness is a raw CLI or every ACP server is stdio. |
| Native headless mode | Raw Claude CLI uses `claude -p`/`--print`; `--bare` removes automatic hooks, skills, plugins, MCP, memory, and OAuth/keychain discovery. `--output-format` supports text, JSON, and NDJSON `stream-json`. [`headless`](https://code.claude.com/docs/en/headless) (accessed 2026-08-22) | The official app-server contract is JSON-RPC, not output scraping: initialize, `thread/start`/`thread/resume`, `turn/start`, notifications, and `turn/interrupt`. [`app-server/README.md#L76-L83`](https://github.com/openai/codex/blob/4f39251a010a8bd7d692d25fb33832ff06f1635a/codex-rs/app-server/README.md#L76-L83) | `goose acp` is the headless entrypoint; `goose serve` is the long-lived remote transport. Goose docs describe ACP methods and `session/notification` updates. [`goose CLI commands`](https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/goose-cli-commands.md), [`ACP clients`](https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/acp-clients.md) (accessed 2026-08-22) | Expose a `headless` capability, but store the adapter's command and transport separately. Prefer ACP/app-server bridges over parsing human CLI output. |
| Wire/event schema | Native CLI `stream-json` emits NDJSON including `system/init`, `stream_event` deltas, retry events, and a final `result`; SDK streaming is a separate API. [`headless`](https://code.claude.com/docs/en/headless) | App-server emits JSON-RPC notifications such as `thread/started`, `turn/started`, `item/started`, item deltas/completions, and `turn/completed`. [`README.md#L76-L83`](https://github.com/openai/codex/blob/4f39251a010a8bd7d692d25fb33832ff06f1635a/codex-rs/app-server/README.md#L76-L83) | Goose emits ACP `SessionNotification` updates such as user/agent message chunks, tool calls and updates, thinking, and permission requests. Its source keeps run IDs and cancellation tokens per session. [`server.rs#L1790-L1863`](https://github.com/aaif-goose/goose/blob/063694cf769269c1f151416605687991fdcbc496/crates/goose/src/acp/server.rs#L1790-L1863) | Normalize a small event algebra (`text_delta`, `thinking_delta`, `tool`, `permission`, `completed`, `error`) while retaining the raw event and unknown fields. Never key state off a provider's event name alone. |
| Session identity and resume | Claude has SDK/CLI session IDs; raw CLI supports `--continue` and `--resume <session_id>`. The ACP bridge advertises load/resume/fork/list and replays history for load. [`acp-agent.ts#L1467-L1705`](https://github.com/agentclientprotocol/claude-agent-acp/blob/6b405138fc82be947964612fac04e56654827b66/src/acp-agent.ts#L1467-L1705), [`headless`](https://code.claude.com/docs/en/headless) | Codex uses durable `threadId`; app-server provides `thread/start`, `thread/resume`, `thread/fork`, and `thread/read`, then sends turns to the selected thread. [`README.md#L164-L177`](https://github.com/openai/codex/blob/4f39251a010a8bd7d692d25fb33832ff06f1635a/codex-rs/app-server/README.md#L164-L177) | Goose ACP session IDs identify persisted Goose sessions. `load_session` retrieves and replays the conversation; its server explicitly treats the ACP session ID as the thread ID for a prompt. [`load_session.rs#L270-L315`](https://github.com/aaif-goose/goose/blob/063694cf769269c1f151416605687991fdcbc496/crates/goose/src/acp/server/load_session.rs#L270-L315), [`server.rs#L1790-L1799`](https://github.com/aaif-goose/goose/blob/063694cf769269c1f151416605687991fdcbc496/crates/goose/src/acp/server.rs#L1790-L1799) | Persist an opaque `wireSessionId` plus `harnessId`, adapter version, cwd, and provider/model snapshot. Resume is an adapter operation; never assume a Claude session ID can be passed to Codex or that changing cwd is harmless. |
| Model/provider selection | Claude ACP exposes a process-scoped provider list with a single `main` provider in this bridge; provider config is translated to Claude-specific environment variables and applies to newly created/loaded sessions. [`acp-agent.ts#L1750-L1850`](https://github.com/agentclientprotocol/claude-agent-acp/blob/6b405138fc82be947964612fac04e56654827b66/src/acp-agent.ts#L1750-L1850), [`acp-agent.ts#L6252-L6307`](https://github.com/agentclientprotocol/claude-agent-acp/blob/6b405138fc82be947964612fac04e56654827b66/src/acp-agent.ts#L6252-L6307) | Codex ACP maps model/reasoning/approval/sandbox options to app-server `turn/start`; custom gateways are constrained to the OpenAI Responses protocol. [`CodexAcpClient.ts#L293-L383`](https://github.com/agentclientprotocol/codex-acp/blob/b51bedf60050c60fef78fc669e6ccf2ff61e3f47/src/CodexAcpClient.ts#L293-L383), [`CodexAcpClient.ts#L756-L782`](https://github.com/agentclientprotocol/codex-acp/blob/b51bedf60050c60fef78fc669e6ccf2ff61e3f47/src/CodexAcpClient.ts#L756-L782) | Goose has its own provider inventory/config and can host external ACP agents. Its `session/new`/`session/load` accepts provider/model config options, but these are Goose semantics. | Keep three IDs: harness/agent, model-provider/account, and concrete model. Make selection a capability-negotiated operation whose acknowledged value is persisted. BERD follows this split in [`sessionExecutionTarget.ts#L3-L30`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sessionExecutionTarget.ts#L3-L30). |
| Permissions and tool approvals | The Agent SDK uses `canUseTool`, permission modes, and `--allowedTools`; ACP converts permission events into `requestPermission`. The native CLI's `-p` default is Manual. [`permissions`](https://code.claude.com/docs/en/agent-sdk/permissions), [`headless`](https://code.claude.com/docs/en/headless) | App-server sends server-initiated approval requests for command execution, file changes, permissions, MCP elicitation, and user input. The client returns typed decisions; stale turns are denied/cancelled in the ACP bridge. [`CodexAppServerClient.ts#L197-L250`](https://github.com/agentclientprotocol/codex-acp/blob/b51bedf60050c60fef78fc669e6ccf2ff61e3f47/src/CodexAppServerClient.ts#L197-L250) | Goose advertises four ACP permission choices (`AllowAlways`, `AllowOnce`, `RejectOnce`, `RejectAlways`) and sends `RequestPermissionRequest`; a rejected/failed request maps to a cancellation permission. [`server.rs#L1265-L1327`](https://github.com/aaif-goose/goose/blob/063694cf769269c1f151416605687991fdcbc496/crates/goose/src/acp/server.rs#L1265-L1327) | Preserve request kind, tool/command/file context, option lifetime, reason, and decision. A single `approve: boolean` loses important safety semantics. |
| Auth and environment | `--bare` avoids OAuth/keychain and requires `ANTHROPIC_API_KEY`; ACP can invoke `claude auth logout`. Custom Anthropic/Bedrock/Vertex use distinct env maps. [`headless`](https://code.claude.com/docs/en/headless), [`acp-agent.ts#L1852-L1881`](https://github.com/agentclientprotocol/claude-agent-acp/blob/6b405138fc82be947964612fac04e56654827b66/src/acp-agent.ts#L1852-L1881) | ACP accepts API-key or ChatGPT/device-code auth; environment names include `CODEX_API_KEY`, `OPENAI_API_KEY`, `CODEX_PATH`, `CODEX_CONFIG`, `MODEL_PROVIDER`, and `NO_BROWSER`. [`README.md`](https://github.com/agentclientprotocol/codex-acp/blob/b51bedf60050c60fef78fc669e6ccf2ff61e3f47/README.md), [`CodexAcpClient.ts#L132-L230`](https://github.com/agentclientprotocol/codex-acp/blob/b51bedf60050c60fef78fc669e6ccf2ff61e3f47/src/CodexAcpClient.ts#L132-L230) | `goose serve` protects the transport with `GOOSE_SERVER__SECRET_KEY`; Goose's model-provider credentials/config are separate. `--dangerously-unauthenticated` is an explicit unsafe escape hatch. [`cli.rs#L1446-L1459`](https://github.com/aaif-goose/goose/blob/063694cf769269c1f151416605687991fdcbc496/crates/goose-cli/src/cli.rs#L1446-L1459) | Make auth a provider-specific adapter service. Keep secrets out of persisted session metadata and pass only an allowlisted environment/config projection to the child. |
| Cancellation and shutdown | ACP cancel interrupts the SDK query; the Claude adapter has queue settlement and an orphan/backstop path because a query may already have ended. [`acp-agent.ts#L4266-L4345`](https://github.com/agentclientprotocol/claude-agent-acp/blob/6b405138fc82be947964612fac04e56654827b66/src/acp-agent.ts#L4266-L4345) | `turn/interrupt` takes `(thread_id, turn_id)` and completes the turn with status `interrupted`; app-server is also explicit about stream notifications after turn start. [`README.md#L211-L214`](https://github.com/openai/codex/blob/4f39251a010a8bd7d692d25fb33832ff06f1635a/codex-rs/app-server/README.md#L211-L214), [`CodexAcpClient.ts#L910-L923`](https://github.com/agentclientprotocol/codex-acp/blob/b51bedf60050c60fef78fc669e6ccf2ff61e3f47/src/CodexAcpClient.ts#L910-L923) | Goose stores a cancellation token per active run, turns it into `StopReason::Cancelled`, and rejects concurrent prompts for the same session. [`server.rs#L1594-L1623`](https://github.com/aaif-goose/goose/blob/063694cf769269c1f151416605687991fdcbc496/crates/goose/src/acp/server.rs#L1594-L1623), [`server.rs#L2041-L2063`](https://github.com/aaif-goose/goose/blob/063694cf769269c1f151416605687991fdcbc496/crates/goose/src/acp/server.rs#L2041-L2063) | Model cancellation as `(session, run, provider turn)` with a terminal state. Drain or ignore late events after cancellation; do not assume transport close means the provider stopped. |

## Portable versus provider-specific

### Portable control-plane capabilities

These are good candidates for an Eido `HarnessAdapter` interface, provided they are discovered at initialization rather than assumed:

```text
initialize(clientCapabilities)
  -> capabilities, auth methods, config options
newSession(cwd, mcpServers, context)
load/resumeSession(opaqueSessionId, cwd)
prompt(sessionId, ContentBlock[])
  -> SessionUpdate* -> PromptCompleted | Error
requestPermission(request) -> decision
cancel(sessionId, runId)
close/delete/fork/listSession (only when advertised)
```

ACP's common shape is visible in BERD's `GooseClient` wrapper, which exposes initialize, new/load session, prompt, cancel, authentication, model/config selection, fork, list, and resume methods without making the renderer know the child command. [`goose-client.ts#L1-L120`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/sdk/src/goose-client.ts#L1-L120)

The portable unit is not “text in, text out.” It is a bidirectional session protocol with content blocks and requests from the agent back to the client. Eido should preserve at least:

- text and thinking deltas;
- tool-call start/update/completion, including opaque provider IDs;
- permission and elicitation requests;
- usage and stop reason when present;
- raw event type/payload and unknown fields for forward compatibility.

### Provider-specific seams that must remain behind adapters

- **Supply chain:** package manager, runtime version, native executable layout, platform/architecture selection, integrity verification, and upgrade transaction.
- **Transport:** stdio NDJSON, HTTP/WebSocket ACP, or an internal app-server over stdio.
- **Native protocol:** Claude CLI/Agent SDK events, Codex app-server JSON-RPC, or Goose's Rust ACP server.
- **Session semantics:** Claude session IDs versus Codex thread IDs versus Goose session IDs; history replay and cwd constraints differ.
- **Safety:** Claude permission modes and `canUseTool`, Codex approval policy/sandbox/profile and reviewer, Goose allow-once/always versus reject-once/always.
- **Authentication:** OAuth/keychain, API key, device-code/browser, custom gateway, transport secret, and provider-specific environment names.
- **Cancellation:** an ACP notification may interrupt an SDK query, an app-server turn, or a Goose cancellation token; terminal events and restart requirements differ.
- **Extensions:** Goose `_goose/*`, Codex experimental methods, and Claude SDK/CLI flags must not be presented as universal ACP behavior.

The system-prompt seam is a concrete example of why this boundary matters. BERD can set a real Goose system prompt through a Goose extension, but Claude/Codex ACP do not expose the same channel, so BERD hands persona text in-band on the first prompt. [`acp.ts#L179-L221`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L179-L221)

## Drift hazards to design for

1. **A pin is not a permanent contract.** BERD's bridge package versions and Goose commit are release inputs. Updating one bridge can change native flags, event fields, auth, or safety defaults even when the ACP method names remain stable.
2. **Raw CLI and ACP are different products.** Claude's documented `claude -p --output-format stream-json` is not the same stream as Claude ACP. Codex's recommended app-server is not the same as parsing `codex exec` stdout. Eido should record which adapter/protocol produced a transcript.
3. **Capabilities are optional and versioned.** `fork`, `list`, `resume`, MCP transports, auth, model selection, steering, and structured output are advertised or extension-specific. Probe and persist a capability snapshot; fail with a precise unsupported operation rather than sending an optimistic request.
4. **Provider/model IDs can be acknowledged or rewritten.** A request for a model may resolve to a default, alias, or unavailable model. Persist the acknowledged result and expose the requested-versus-effective pair.
5. **Permission defaults are not equivalent.** Claude print mode defaults to Manual; Codex has approval and sandbox policies; Goose has four explicit option lifetimes. A normalized UI decision must still carry the adapter's policy and scope.
6. **Cancellation is a state transition, not just process termination.** Track run IDs, associate every update with the current run, and quarantine late events. After an uncertain timeout, BERD aborts/reconnects the transport rather than assuming remote state; Eido should use the same conservative rule.
7. **Auth must not leak into session identity.** Keep credential source and environment projection separate from persisted target/session records. A session can resume while its auth method or token has changed.

## Recommendations for Eido's CLI-provider layer

### 1. Split the modules at the same seam BERD does

```text
ProviderCatalog
  -> InstallationManager (version, artifact, integrity, platform, health)
  -> HarnessAdapter (ACP/app-server/raw CLI protocol)
  -> SessionActor (serialized target + run lifecycle)
  -> Eido event store / UI
```

The installation manager must not know how to parse a provider response, and the session actor must not know where a binary was downloaded. This lets Eido upgrade a bridge without rewriting chat routing.

### 2. Use an explicit target and session record

```text
target: {
  harnessId,             // claude-acp | codex-acp | goose | ...
  modelProviderId?,      // account/endpoint inside that harness
  requestedModelId?
}

session: {
  wireSessionId,         // opaque ACP session or Codex thread ID
  harnessId,
  adapterVersion,
  cwd,
  effectiveProviderId?,
  effectiveModelId?,
  capabilities,
  lastRunId?
}
```

Do not put executable name, model, account, and harness into one `provider` string. BERD's separation of harness and model provider is the right shape to copy.

### 3. Copy BERD's install discipline

- app-private runtime and install root;
- exact package/binary versions plus transitive lock and integrity;
- staged install, executable/health verification, atomic promotion;
- last-known-good bridge retained on failed upgrade;
- one absolute-path shim per canonical provider ID;
- startup reconciliation with visible per-provider readiness.

### 4. Add a small conformance probe for every adapter version

Run this against a disposable workspace after install and on upgrade:

| Probe | Evidence to retain |
| --- | --- |
| initialize + capability negotiation | protocol version, advertised methods/transports |
| new session + one text prompt | session identity and event sequence |
| image/resource prompt (if advertised) | content support or precise rejection |
| tool permission denial and allow-once | request context, decision lifetime, terminal event |
| cancellation during generation | run/turn identity, stop reason, late-event behavior |
| resume/load after process restart | history replay and cwd behavior |
| malformed/unknown event | raw capture and parser tolerance |
| clean shutdown and transport loss | exit code, reconnect/recovery behavior |

This turns upstream drift into a release-time failure with a useful diagnostic instead of a production chat-routing mystery.

## Source ledger

All links below are first-party source repositories or official documentation; no secondary descriptions were used.

- BERD: [managed bridge lock](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/acp-tools.lock.json), [managed installer](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs), [Goose sidecar](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs), [ACP API](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts).
- Anthropic: [headless Claude Code](https://code.claude.com/docs/en/headless), [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [permissions](https://code.claude.com/docs/en/agent-sdk/permissions).
- Claude ACP: [v0.66.0 source](https://github.com/agentclientprotocol/claude-agent-acp/tree/6b405138fc82be947964612fac04e56654827b66), [native executable resolution](https://github.com/agentclientprotocol/claude-agent-acp/blob/6b405138fc82be947964612fac04e56654827b66/src/acp-agent.ts#L1023-L1061), [session lifecycle](https://github.com/agentclientprotocol/claude-agent-acp/blob/6b405138fc82be947964612fac04e56654827b66/src/acp-agent.ts#L1467-L1705).
- OpenAI: [Codex app-server README at `4f39251a`](https://github.com/openai/codex/blob/4f39251a010a8bd7d692d25fb33832ff06f1635a/codex-rs/app-server/README.md), [thread protocol](https://github.com/openai/codex/blob/4f39251a010a8bd7d692d25fb33832ff06f1635a/codex-rs/app-server-protocol/src/protocol/v2/thread.rs), [turn protocol](https://github.com/openai/codex/blob/4f39251a010a8bd7d692d25fb33832ff06f1635a/codex-rs/app-server-protocol/src/protocol/v2/turn.rs).
- Codex ACP: [v1.2.0 source](https://github.com/agentclientprotocol/codex-acp/tree/b51bedf60050c60fef78fc669e6ccf2ff61e3f47), [Codex process bridge](https://github.com/agentclientprotocol/codex-acp/blob/b51bedf60050c60fef78fc669e6ccf2ff61e3f47/src/CodexJsonRpcConnection.ts), [auth/config](https://github.com/agentclientprotocol/codex-acp/blob/b51bedf60050c60fef78fc669e6ccf2ff61e3f47/src/CodexAcpClient.ts#L132-L383), [approval mapping](https://github.com/agentclientprotocol/codex-acp/blob/b51bedf60050c60fef78fc669e6ccf2ff61e3f47/src/CodexAppServerClient.ts#L197-L250).
- Goose: [CLI commands at the pinned source](https://github.com/aaif-goose/goose/blob/063694cf769269c1f151416605687991fdcbc496/crates/goose-cli/src/cli.rs), [ACP transport/auth](https://github.com/aaif-goose/goose/blob/063694cf769269c1f151416605687991fdcbc496/crates/goose/src/acp/transport/mod.rs), [ACP session implementation](https://github.com/aaif-goose/goose/blob/063694cf769269c1f151416605687991fdcbc496/crates/goose/src/acp/server.rs), [ACP client guide](https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/acp-clients.md).
