# BERD chat routing and runtime

## Scope and conclusion

This lane traces one chat turn from composer submission through provider
selection, ACP transport, streaming/replay, persistence, cancellation, and
failure handling in BERD at commit [`874e078c931c14386a7d2e16cfe3b32cdbe295e0`](https://github.com/block/berd/tree/874e078c931c14386a7d2e16cfe3b32cdbe295e0),
the pinned source under `research/repos/berd`.

**[Fact]** BERD has one renderer-owned ACP client and one long-lived local
`goose serve` process. The renderer sends standard ACP requests over a
WebSocket; `goosed` is the broker that owns ACP sessions and resolves the
selected provider/harness. A chat turn does not directly spawn `claude`,
`codex`, or another harness from React. The process boundary is visible in
the singleton `GooseServeProcess`, whose comment says each `/acp` WebSocket
connection creates an independent ACP agent, and in the renderer's
`getClient()`/`client.prompt()` calls. See [`goose_serve.rs#L51-L70`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L51-L70),
[`acpConnection.ts#L162-L199`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpConnection.ts#L162-L199),
and [`acpApi.ts#L468-L486`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts#L468-L486).

**[Inference]** For Eido, the important seam is not “provider-specific CLI
command construction in the UI.” It is a durable session actor plus an ACP
transport/broker adapter. Provider-specific work should be isolated behind
the broker/bridge boundary; the UI should carry a canonical harness/provider
target, standard prompt content, and normalized stream events.

**[Unknown]** This BERD tree does not contain the implementation of Goose's
provider resolver or the Claude/Codex bridge executables. It pins the Goose
backend to an upstream commit in [`goose-backend.lock.json#L1-L6`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/goose-backend.lock.json#L1-L6)
and installs bridge packages, but the exact child-process flags, provider
authentication handshakes, and provider-native event parsing live in those
external artifacts. BERD's routing contract can be learned here; the bridge
internals require a second source study of the pinned Goose/ACP packages.

## The runtime in one picture

```text
Composer / berdctl
        |
        v
submitComposerMessage -> useChat.sendMessage -> dispatchPrompt
        |                       |                  |
        |                       |                  +--> optimistic local user msg
        |                       |                  +--> thinking -> streaming
        |                       v
        |                target preparation / lease
        |                       |
        v                       v
  ChatSendOptions ------> acpSendMessage(sessionId, content)
                                  |
                                  +--> session registry: prepared provider+model
                                  +--> Goose prompt/system-prompt policy
                                  +--> ACP `client.prompt`
                                             |
                                             v
                                  localhost `goosed serve`
                                  WebSocket `/acp`
                                             |
                      +----------------------+----------------------+
                      |                                             |
             provider = goose/model                         provider = claude-acp
             Goose-native model provider                    or codex-acp/etc.
             + Goose system-prompt ext                      ACP bridge process
                      |                                      (managed shim)
                      +----------------------+----------------------+
                                             |
                                             v
                        ACP SessionNotification stream
                                             |
                         acpConnection.sessionUpdate callback
                                             |
                     replay buffer or live notification handler
                                             |
                       chat store / transcript / token state
```

**[Fact]** The connection is lazy and shared: `getClient()` memoizes an
in-flight initialization and then the resolved client; when the client closes
or errors, BERD clears the memoized connection so the next `getClient()` can
reconnect. A timed-out mutation explicitly aborts the transport because the
remote state is otherwise unknowable. See [`acpConnection.ts#L95-L135`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpConnection.ts#L95-L135)
and [`acpConnection.ts#L202-L223`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpConnection.ts#L202-L223).

## 1. Installation: bridges are app-managed runtime dependencies

### What is installed

**[Fact]** The curated catalog treats Claude Code and Codex as agent
providers, not ordinary model-provider API keys. Their stable BERD IDs,
binary names, install/auth capabilities, and `bundledBridge` status are
declared here:

| BERD provider ID | Display name | Bridge binary | Installed package | Pinned version at this commit |
| --- | --- | --- | --- | --- |
| `claude-acp` | Claude Code | `claude-agent-acp` | `@agentclientprotocol/claude-agent-acp` | `0.66.0` |
| `codex-acp` | Codex | `codex-acp` | `@agentclientprotocol/codex-acp` | `1.2.0` |

The UI catalog is [`curatedProviders.ts#L4-L82`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/providers/curatedProviders.ts#L4-L82).
The backend's managed-tool table is the stronger install source of truth:
[`managed_acp_tools.rs#L252-L321`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L252-L321).

**[Fact]** BERD-managed bridges are installed under app data, not a user's
global npm prefix. The backend installs a checked-in `package.json` and
`package-lock.json` into a staging tree, runs `npm ci --prefix` using the
managed Node runtime, verifies the replayed lock and executable, then writes
an absolute-path shim and updates `state.json`. The transaction keeps the
previous working bridge if install or verification fails. See
[`managed_acp_tools.rs#L459-L510`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L459-L510)
and [`managed_acp_tools.rs#L556-L607`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L556-L607).

**[Fact]** On launch, Tauri starts a background reconciler that runs the
managed install for every bridge and emits one completion event even when one
provider fails. A partial failure does not prevent the other bridge from
installing, and failed installs retry at the next launch. See
[`acp_tools_reconciler.rs#L1-L29`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp_tools_reconciler.rs#L1-L29),
[`acp_tools_reconciler.rs#L47-L83`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp_tools_reconciler.rs#L47-L83),
and the startup call in [`lib.rs#L369-L374`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/lib.rs#L369-L374).

**[Fact]** The process environment makes those bridges discoverable to
`goosed`: BERD prepends the distro bin, managed bridge shims, private npm
prefix, and managed Node bin to `PATH`, and also publishes the ordered list in
`GOOSE_SEARCH_PATHS`. It applies this environment before starting `goosed
serve`. See [`goose_serve.rs#L170-L209`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L170-L209)
and [`goose_serve.rs#L1022-L1095`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L1022-L1095).

### User-triggered setup has the same authority boundary

**[Fact]** Provider settings do not own a long-running install task in a
React card. `start_agent_setup` seeds a backend registry, emits a full state
snapshot, and spawns a task that survives navigation/reload. The install path
re-probes after each fix and caps the install loop at one pass per recipe; a
from-scratch two-binary agent can therefore install its main CLI and then its
bridge in one operation. See [`agent_setup.rs#L1-L16`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L1-L16),
[`agent_setup.rs#L731-L758`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L731-L758),
and [`agent_setup.rs#L812-L876`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L812-L876).

**[Fact]** For managed Claude/Codex bridge fixes, the setup backend bypasses
the generic doctor shell fix and calls the managed installer; other npm-backed
fixes first ensure the private Node runtime. See
[`agent_setup.rs#L907-L975`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L907-L975)
and [`agent_setup.rs#L978-L1067`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L978-L1067).

**[Inference for Eido]** Treat a harness bridge like a runtime component,
not a one-time user prerequisite. A private, pinned, transactional install
root plus a startup readiness/reconciliation signal avoids three common
failure modes: host-global npm drift, a bridge disappearing after an update,
and a UI card claiming “installed” before the executable is actually runnable.

## 2. Foreground chat: exact end-to-end path

### A. Composer to dispatch core

**[Fact]** The UI path is:

```text
useChatInputSubmit
  -> submitComposerMessage
  -> onSend (useChat.sendMessage)
  -> dispatchPrompt
  -> acpSendMessage
```

The composer validates attachment size, expands selected skills/slash
commands, merges chips, and calls the chat send handler. See
[`useChatInputSubmit.ts#L31-L55`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/hooks/useChatInputSubmit.ts#L31-L55)
and [`submitComposerMessage.ts#L26-L89`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/submitComposerMessage.ts#L26-L89).

**[Fact]** `useChat.sendMessage` rejects sends when the session is already
thinking/streaming/compacting or cancellation is pending. It resolves the
effective persona, provider, and system prompt at call time, then delegates
to `dispatchPrompt`. The provider comes from an explicit override, then the
active agent, then the `goose` sentinel. See
[`useChat.ts#L160-L243`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/hooks/useChat.ts#L160-L243).

**[Fact]** `dispatchPrompt` claims per-session prompt ownership before any
commit, rejects oversized attachments before touching the transcript, runs
preparation, then commits the user message and transitions the local runtime
through `thinking` and `streaming`. The optimistic user message is committed
only after preparation succeeds. See [`sendCore.ts#L179-L225`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sendCore.ts#L179-L225)
and [`sendCore.ts#L227-L301`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sendCore.ts#L227-L301).

### B. Target preparation and session registry

**[Fact]** The session target is explicit and typed: a session has a
`harnessId`, optionally a `modelProviderId`, and optionally a concrete
`modelId`/`modelName`. A concrete model is invalid without a provider, and a
Goose model cannot use the `goose` sentinel as its concrete provider. See
[`sessionExecutionTarget.ts#L3-L82`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sessionExecutionTarget.ts#L3-L82).

**[Fact]** The conversion at the Goose boundary makes the distinction
explicit: for a Goose session, `providerId` is the concrete model provider;
for an external harness, `providerId` is the harness ID. The reverse mapping
canonicalizes persisted/ACP IDs and discards a model that has no provider
identity rather than inventing one. See
[`gooseServeExecutionTarget.ts#L72-L139`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/gooseServeExecutionTarget.ts#L72-L139).

**[Fact]** Before prompting, the session registry serializes session
mutations, loads an unprepared session, sets its provider, and caches the
acknowledged provider/model selection. Reuse updates working directory and
provider only when necessary. Every bounded mutation has a 60-second timeout;
on timeout BERD drops the prepared selection and invalidates the shared ACP
connection. See [`acpSessionRegistry.ts#L31-L129`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpSessionRegistry.ts#L31-L129)
and [`acpSessionRegistry.ts#L132-L228`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpSessionRegistry.ts#L132-L228).

**[Fact]** A prompt cannot cross the transport boundary unless the current
window has a prepared provider *and model*. `runPreparedSessionPrompt` keeps
prompt setup/transport in the same per-session mutation lane and supplies the
provider ID to `acpSendMessageNow`. See
[`acpSessionRegistry.ts#L349-L381`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpSessionRegistry.ts#L349-L381).

### C. Provider resolution, prompt assembly, and ACP wire call

**[Fact]** BERD canonicalizes only the `goose` sentinel at the wire boundary:
`toWireProviderId("goose")` resolves the default concrete model provider when
readiness is known; real provider IDs such as `claude-acp` and `codex-acp` pass
through unchanged. See [`acpPersonaHandoff.ts#L22-L39`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpPersonaHandoff.ts#L22-L39).

**[Fact]** Session creation sends the provider in ACP request metadata, while
provider changes use the standard config option `provider`. Model changes use
the standard config option `model`. BERD deliberately sends concrete
providers even when no model is selected, so Goose does not fall back to a
missing global `GOOSE_PROVIDER`. Creation failure rolls back the local
registration and archives the backend session. See
[`acpApi.ts#L286-L321`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts#L286-L321),
[`acpApi.ts#L405-L438`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts#L405-L438),
and [`acp.ts#L412-L489`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L412-L489).

**[Fact]** `acpSendMessageNow` first verifies that the prepared provider is
still the requested provider. It then splits protocol behavior:

* Goose-managed sessions append Berd's style, interaction, app-context, and
  user system prompts through Goose's `_goose/unstable/session/system-prompt/set`
  extension.
* External agent harnesses (Claude Code, Codex, Copilot, Amp, Cursor) are
  treated as not implementing that Goose extension. BERD creates a one-time
  assistant-audience handoff block containing app context and persona/system
  instructions.
* The final ACP content is ordinary text/image `ContentBlock[]`; optional
  assistant-audience content precedes the user text, and images follow it.

See [`acp.ts#L142-L242`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L142-L242)
and [`acp.ts#L243-L289`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L243-L289).

**[Fact]** The external handoff is keyed by `(session, provider,
fingerprint(system prompt))`, so switching harnesses or editing the persona
causes a new handoff. The handoff is marked delivered only in the
`onPromptDispatching` callback, after ACP setup and immediately before the
transport call. See [`acpPersonaHandoff.ts#L41-L65`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpPersonaHandoff.ts#L41-L65)
and [`acp.ts#L264-L287`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L264-L287).

**[Fact]** The actual wire call is one standard ACP request:
`client.prompt({ sessionId, prompt: content, _meta: meta })`. The wrapper
fires an internal “dispatching” callback immediately before the call and an
“dispatched” callback immediately after invocation. This is the exact point at
which BERD distinguishes pre-transport rejection from a committed run. See
[`acpApi.ts#L468-L486`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts#L468-L486)
and [`sendCore.ts#L303-L327`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sendCore.ts#L303-L327).

### D. The broker and bridge boundary

**[Fact]** `goosed` is started once with `serve`, a loopback host/ephemeral
port, and a per-process secret. Individual ACP sessions supply their working
directory through protocol operations rather than requiring a new server
process. See [`goose_serve.rs#L147-L168`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L147-L168)
and [`goose_serve.rs#L232-L245`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L232-L245).

**[Fact]** BERD configures provider/model selections through ACP and leaves
the actual child-harness spawn to Goose. The renderer's code knows bridge
IDs, install paths, standard ACP operations, and Goose extension names; it
does not know a Claude/Codex command line. This is the cleanest evidence for
a brokered adapter architecture.

**[Unknown]** The source does not prove whether Goose starts one bridge child
per session, pools bridge processes, or multiplexes multiple sessions inside a
bridge. The only local guarantee is the long-lived `goosed` process and the
independent ACP-agent-per-WebSocket contract. Do not carry a stronger process
lifetime claim into Eido without inspecting the pinned Goose backend/bridge
sources.

## 3. Streaming and protocol normalization

### Notification ingress

**[Fact]** `GooseClient` installs a `sessionUpdate` callback. Every ACP
`SessionNotification` first passes through optional interceptors (used for
private/background prompts), then reaches the registered chat notification
handler. See [`acpConnection.ts#L65-L93`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpConnection.ts#L65-L93).

**[Fact]** The app wires that handler at startup before acquiring the client;
the same startup also restores persisted message queues. See
[`chatRuntimeStartup.ts#L118-L133`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/app/lib/chatRuntimeStartup.ts#L118-L133)
and [`chatRuntimeStartup.ts#L143-L161`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/app/lib/chatRuntimeStartup.ts#L143-L161).

### Live event normalization

**[Fact]** BERD preserves ACP event families at the edge and maps them into
its own message store:

| ACP update | BERD handling |
| --- | --- |
| `agent_message_chunk` | Ensure an assistant message, enqueue text chunks, or append images. |
| `agent_thought_chunk` | Enqueue thinking text. |
| `tool_call` | Flush text, create a `toolRequest`, preserve tool identity/arguments/locations. |
| `tool_call_update` | Patch by exact tool-call ID, mark completed/failed, append `toolResponse` and images. |
| `session_info_update` | Update title/timestamps and Goose active-run state. |
| `config_option_update` | Apply provider/model/reasoning snapshots. |
| `usage_update` | Update cumulative token/context/cost state. |

The live switch is [`acpNotificationHandler.ts#L575-L633`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/acp/acpNotificationHandler.ts#L575-L633),
[`acpNotificationHandler.ts#L635-L793`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/acp/acpNotificationHandler.ts#L635-L793),
and [`acpNotificationHandler.ts#L795-L844`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/acp/acpNotificationHandler.ts#L795-L844).

**[Fact]** Streaming text/thinking updates are buffered and coalesced, then
flushed on `requestAnimationFrame` (or a 16ms timeout fallback). Subtitle
updates are throttled to 1 second. The buffer carries a prompt-owner symbol,
so a superseded prompt cannot write into the current run. See
[`liveStreamingUpdates.ts#L235-L341`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/acp/liveStreamingUpdates.ts#L235-L341)
and [`liveStreamingUpdates.ts#L343-L439`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/acp/liveStreamingUpdates.ts#L343-L439).

### What stays provider-specific

**[Fact]** The normalized ACP core is intentionally small: prompt content,
standard session updates, tool-call status, usage, and config snapshots. BERD
keeps Goose-specific behavior at the ACP edge instead of pretending it is a
universal provider capability:

1. Goose system prompts use `_goose/unstable/session/system-prompt/set`;
   external agents receive an in-band handoff because ACP has no standard
   system-prompt channel in BERD's `session/new`/`session/prompt` path. See
   [`acpApi.ts#L340-L364`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts#L340-L364)
   and [`acpPersonaHandoff.ts#L1-L16`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpPersonaHandoff.ts#L1-L16).
2. Mid-run steering uses the Goose-only
   `_goose/unstable/session/steer` extension. BERD retries once when Goose
   reports a changed active run ID, but there is no alternate Claude/Codex
   protocol in this code path. See [`acpApi.ts#L576-L607`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts#L576-L607).
3. The notification handler recognizes `_meta.goose.steer` as an intervention
   boundary and `_meta.goose.activeRunId` as run identity. These are kept out
   of the generic message types. See [`acpNotificationHandler.ts#L274-L320`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/acp/acpNotificationHandler.ts#L274-L320)
   and [`acpSessionInfoUpdate.ts#L19-L44`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/acp/acpSessionInfoUpdate.ts#L19-L44).

**[Inference for Eido]** The useful normalization rule is “normalize the
portable event algebra; isolate extension capabilities.” In particular, do
not flatten steering, system-prompt injection, run IDs, or permission
semantics into a fake universal provider contract. Model them as optional
capabilities attached to the harness adapter, with explicit “unsupported”
behavior.

## 4. Persistence, resume, and headless sends

### Backend session history is authoritative on reload

**[Fact]** Loading a session calls ACP `loadSession`; replay notifications go
through the same notification handler but are classified by the session's
`loadingSessionIds`. `acpLoadSession` then consumes the replay buffer,
sanitizes the messages, and replaces the visible transcript only when the
replay meets the expected empty/non-empty history contract. See
[`sessionActivation.ts#L321-L410`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sessionActivation.ts#L321-L410)
and [`sessionReplayReplacement.ts#L17-L57`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sessionReplayReplacement.ts#L17-L57).

**[Fact]** A successful replay clears the loading state, errors, and settled
streaming pointer; an invalid/missing replay produces a visible error and
does not silently replace a non-empty transcript. A failed load leaves the
session retryable on re-open rather than parking it in a state that would
block the next send. See [`sessionActivation.ts#L405-L497`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sessionActivation.ts#L405-L497).

**[Fact]** Session metadata is carried in standard fields plus `_meta`,
including provider/model IDs, message counts, timestamps, and Goose's
`activeRunId`. `session_info_update` sets or settles the active run and patches
session metadata in the local session store. See [`acpApi.ts#L97-L122`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts#L97-L122)
and [`acpSessionInfoUpdate.ts#L19-L71`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/acp/acpSessionInfoUpdate.ts#L19-L71).

### Local queue persistence is a separate concern

**[Fact]** Queued messages are persisted independently of the backend
conversation. Native Tauri persistence is authoritative when available, with
localStorage as a cache/fallback; malformed records are discarded or
normalized on load, and interrupted workspace-first sends are returned to a
retryable held state. See [`queuePersistence.ts#L10-L77`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/stores/queuePersistence.ts#L10-L77)
and [`queuePersistence.ts#L141-L231`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/stores/queuePersistence.ts#L141-L231).

### Headless/CLI path reuses the same transport

**[Fact]** `berdctl` does not have a second provider router. Its
`sendPromptToExistingSessionInBackground` acquires an existing-session target
lease, prepares the target through the same session coordinator, calls
`sendPromptInBackground`, and releases the lease. It can return as soon as
the prompt crosses the transport boundary (`returnOnDispatch`) while the
global notification handler continues streaming into the store. See
[`sessionSend.ts#L37-L107`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/berdctl/commands/runtime/sessionSend.ts#L37-L107)
and [`backgroundSend.ts#L11-L73`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/backgroundSend.ts#L11-L73).

**[Fact]** The target lease fails closed for contention, unresolved target,
missing session, and incomplete session creation. The coordinator also holds
the lease across hydration so a live prompt cannot be misclassified as replay
and then dropped when the transcript is replaced. See
[`sessionTargetCoordinator.ts#L581-L709`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sessionTargetCoordinator.ts#L581-L709)
and [`queuedSessionSend.ts#L130-L169`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/queuedSessionSend.ts#L130-L169).

**[Inference for Eido]** This is a strong headless contract: “accepted” means
the invocation crossed the transport boundary, not that the model completed.
That distinction lets a CLI return promptly without losing ownership, while
the same event stream and persisted session remain responsible for completion
and resume.

## 5. Cancellation and failure semantics

### Cancellation is a transport operation plus a local race protocol

**[Fact]** Stopping a run aborts the local `AbortController`, marks
cancellation pending, flushes buffered text, moves the UI to idle, and sends
ACP `cancel({ sessionId })` even if the UI is still in `thinking` (before an
assistant message exists). On successful transport cancellation it marks
in-progress tool calls/message completion as stopped; if cancellation loses a
race with prompt completion, the prompt outcome decides whether the message
is completed or errored. See [`useChat.ts#L282-L367`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/hooks/useChat.ts#L282-L367),
[`acpApi.ts#L400-L403`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts#L400-L403),
and [`sendCore.ts#L102-L177`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sendCore.ts#L102-L177).

**[Fact]** The current `acpCancelSession` wrapper returns `true` after
`client.cancel` resolves; the underlying standard ACP client call itself is
void-shaped in this layer. Therefore BERD's `wasCancelled` is best read as
“the cancel request completed without throwing,” not proof that the remote
agent had already ceased all work. The race/ownership logic is what prevents
late chunks from corrupting the next prompt.

### Failure before and after transport are intentionally different

**[Fact]** Before the user message is committed, a preparation/readiness
failure is a pre-commit rejection: the newer session owner remains intact and
the draft can be retried. After commitment, an ordinary error marks the
streaming assistant message `completionStatus: "error"`, appends a system
notification, sets the session error, and returns to idle. `AbortError` returns
to idle without an error notification. See [`sendCore.ts#L354-L421`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sendCore.ts#L354-L421)
and [`preCommitSendRejection.ts#L1-L12`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/preCommitSendRejection.ts#L1-L12).

### Non-obvious failure modes BERD explicitly guards

1. **Oversized image attachments can kill the shared WebSocket.** BERD
   rejects them in the composer and again in `dispatchPrompt`/steering before
   committing or sending. The reason is explicit: an oversized ACP message
   silently kills the shared connection and every open chat. See
   [`submitComposerMessage.ts#L26-L43`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/submitComposerMessage.ts#L26-L43)
   and [`sendCore.ts#L214-L225`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sendCore.ts#L214-L225).
2. **A “Provider not set” session can be unrecoverable in place.** BERD
   recognizes the error, and when no backend turn has committed and no
   assistant content exists, recreates the session with the target provider at
   birth rather than trying to switch a dead provider in place. See
   [`acpErrors.ts#L50-L68`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpErrors.ts#L50-L68)
   and [`strandedProviderRecovery.ts#L19-L49`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/model-selection/strandedProviderRecovery.ts#L19-L49),
   [`strandedProviderRecovery.ts#L99-L149`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/model-selection/strandedProviderRecovery.ts#L99-L149).
3. **Persisted Anthropic thinking blocks can poison a session.** BERD documents
   that changing, merging, reordering, or trimming prior `thinking` or
   `redacted_thinking` blocks can make every later Claude turn fail with a
   400. The UI detects and explains this, but deliberately does not rewrite the
   provider history at this edge. See [`providerErrorNotice.ts#L1-L25`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/providerErrorNotice.ts#L1-L25).
4. **A replay can race a live send.** BERD holds a target lease across
   `session/load`; otherwise a live turn's notifications would be classified
   as replay and then discarded when replay replaces the transcript. See
   [`queuedSessionSend.ts#L130-L169`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/queuedSessionSend.ts#L130-L169).
5. **A provider/model acknowledgement can be stale or divergent.** The target
   coordinator tracks operation IDs, target ownership, and deferred ACP
   observations; a newer selection supersedes an older operation instead of
   letting a late config snapshot silently switch the session. See
   [`sessionTargetCoordinator.ts#L267-L445`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sessionTargetCoordinator.ts#L267-L445)
   and [`sessionTargetCoordinator.ts#L877-L1023`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sessionTargetCoordinator.ts#L877-L1023).

## 6. What Eido should borrow

These are recommendations derived from the facts above, not claims about
Eido's current implementation.

### Recommended architecture

```text
Provider catalog
   -> canonical HarnessTarget { harnessId, providerId?, modelId? }
   -> SessionActor (serialized prepare / send / cancel / resume)
   -> HarnessAdapter boundary
        - ACP adapter (standard prompt + updates)
        - provider extensions (system prompt, steer, permission, auth)
   -> one transport/broker connection per app runtime
   -> normalized event reducer + durable session journal
```

1. **Make the target explicit and durable.** Persist a canonical harness ID,
   model-provider ID, model ID, working directory, and capability snapshot.
   Do not infer “Codex” from a model string after the fact.
2. **Separate install readiness from route selection.** Install/auth state
   should be backend-owned, idempotent, resumable, and independently
   observable. A provider can be catalogued but not ready; a session should
   fail before transport if its target is unresolved.
3. **Use one session actor per conversation.** Serialize target preparation,
   model changes, prompt dispatch, load/replay, and cancellation. Issue a
   lease/token to headless callers so a CLI cannot race a visible chat.
4. **Define accepted vs completed.** Return from headless invocation when the
   transport boundary is crossed; use the durable event stream/journal for
   completion, resume, and post-dispatch errors.
5. **Normalize only portable events.** Keep text/thought/tool/usage/config
   events provider-neutral. Put system-prompt injection, steering, permission
   requests, run IDs, and provider-specific error repair behind capability
   adapters.
6. **Guard the shared transport.** Reject payloads before sending, invalidate
   a connection after an ambiguous timeout, and make reconnect behavior
   explicit. One broken stream must not silently poison every open chat.
7. **Make replay authoritative but race-safe.** Treat backend history as the
   source of truth on resume, but hold ownership across replay and replace the
   transcript only after validating the replay shape.
8. **Preserve user intent on recoverable failures.** If provider construction
   failed before a real turn, recreate at the target provider and carry the
   typed text forward; never silently discard it.

### BERD-inspired capability matrix

| Capability | Goose-managed session | External ACP harness session | Eido design implication |
| --- | --- | --- | --- |
| Provider route | Concrete model provider behind `goose` | Harness ID such as `claude-acp`/`codex-acp` | Store harness and provider separately. |
| System prompt | Goose extension | In-band assistant-audience handoff | Capability-gate the operation; do not pretend ACP standardizes it. |
| Mid-run steer | Goose extension with run ID | No alternate route in BERD | Expose unsupported explicitly or implement a true adapter. |
| Stream events | Standard ACP plus Goose metadata | Standard ACP bridge output | Normalize ACP; preserve extension metadata at the edge. |
| Install | Runtime-configured model provider | Managed bridge package and shim | Treat bridge install as a first-class runtime dependency. |
| Resume | ACP replay + metadata | Same ACP replay contract | Persist session ID/target and validate replay before replacement. |

## Evidence limits

* **Source confidence: high** for the renderer/Tauri orchestration, install
  paths, target model, ACP request shapes, notification handling, replay,
  queue, cancellation, and failure policy. Each consequential statement above
  links to the pinned primary source.
* **Source confidence: medium** for the exact relationship between bridge
  package names and vendor CLIs: BERD's managed-tool comments explicitly say
  the packages vendor the full CLI, but this repository does not include those
  package sources.
* **Unknown until a Goose follow-up study:** bridge process lifetime and
  pooling, provider-native auth/session semantics, exact Claude/Codex command
  lines, and whether every bridge emits identical ACP event fidelity.
* **No runtime invocation was performed against the installed `/Applications/Berd.app`.**
  This report is source-grounded at the pinned commit. A runtime session would
  be useful only to verify packaging/path behavior or capture real bridge
  diagnostics, not to replace the source trace.
