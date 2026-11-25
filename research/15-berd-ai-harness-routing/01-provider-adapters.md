# BERD provider and AI-harness adapters

Research target: [`block/berd`](https://github.com/block/berd), commit [`874e078c931c14386a7d2e16cfe3b32cdbe295e0`](https://github.com/block/berd/tree/874e078c931c14386a7d2e16cfe3b32cdbe295e0) (2026-08-21). This dossier is source archaeology for Eido's headless CLI-provider work. It uses BERD's checked-in source and generated lock artifacts only; no secondary write-ups are used.

## Executive finding

BERD does not make the React renderer spawn Claude Code or Codex directly. It uses a two-level adapter boundary:

1. **A single ACP broker boundary:** the Tauri backend starts one long-lived, local `goose serve` process. The renderer connects to that process over ACP WebSocket and sends provider/model/session operations through the ACP client.
2. **Provider-specific ACP bridges:** Claude Code and Codex are represented by canonical provider IDs (`claude-acp`, `codex-acp`). BERD installs their ACP bridge packages into app-private directories, pins their complete npm dependency graphs, writes absolute-path shims, and puts those shims on Goose's search path. Goose resolves the provider ID to the corresponding bridge and owns the child-process lifecycle.

The important design is therefore not “one command builder with a Claude branch and a Codex branch.” It is:

```text
UI / berdctl
    │  canonical target: harnessId + modelProviderId? + modelId?
    ▼
ACP session registry (per-session serialization and acknowledged selection)
    │  newSession / setProvider / setModel / prompt
    ▼
GooseClient → local `goose serve` (one long-lived broker, one ACP agent per WS session)
    │  provider ID + PATH / GOOSE_SEARCH_PATHS
    ├── claude-agent-acp shim → bundled Claude native executable
    ├── codex-acp shim         → bundled Codex native executable
    └── other ACP agents       → host/private-prefix binaries when supported
```

The first two levels are directly evidenced by BERD's README, `goose_serve.rs`, `acpConnection.ts`, `acp.ts`, and `managed_acp_tools.rs`. The exact provider-to-child dispatch inside Goose is upstream behavior and is not present in this BERD commit; the source comments explicitly describe that boundary, so the final hop is an informed inference rather than a claim about Goose internals.

## Scope and evidence method

- **Primary source:** BERD source at the pinned commit above, plus BERD's checked-in `acp-tools.lock.json` and generation script.
- **Inspected seams:** managed Node/npm and ACP installs; startup reconciliation; Goose sidecar spawn and environment; ACP connection/session APIs; provider catalog and readiness; model inventory; persona/system-prompt handoff; session target transitions; agent setup/auth gates.
- **Not inspected as facts:** the implementation of the upstream Goose server, the implementation of the published Claude/Codex ACP bridge packages, or Eido's current provider code. Where those boundaries matter, the dossier labels the result as inference or unknown.

## 1. BERD's provider vocabulary is intentionally split

### Facts

The curated catalog distinguishes an **agent harness** from a **model provider**. Goose, Claude Code, Codex, Copilot, Amp, and Cursor are catalogued as `category: "agent"`; Databricks is a `category: "model"` provider. Claude Code and Codex use canonical IDs `claude-acp` and `codex-acp`, aliases for common CLI spellings, `setupMethod: "cli_auth"`, and `bundledBridge: true`. Their catalog entries also declare install/auth/auth-status support. [`curatedProviders.ts#L4-L54`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/providers/curatedProviders.ts#L4-L54)

The renderer-facing `AcpProvider` is deliberately small (`id`, `label`), while the catalog carries capabilities and setup metadata. [`acp.ts#L49-L52`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L49-L52), [`providers.ts#L16-L47`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/types/providers.ts#L16-L47)

BERD canonicalizes provider aliases before presenting or persisting provider identity. `discoverAcpProviders()` maps the IDs returned by ACP through `resolveAgentProviderCatalogId`, deduplicates by the resolved ID, and uses the catalog's display name. [`acp.ts#L90-L116`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L90-L116) The resolver first accepts an exact canonical ID, then matches normalized aliases, including the provider label. [`providerCatalog.ts#L44-L65`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/providers/providerCatalog.ts#L44-L65), [`providerCatalog.ts#L127-L169`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/providers/providerCatalog.ts#L127-L169)

### Inference

The canonical ID is the stable cross-layer key. Labels such as `Claude Code`, aliases such as `claude-code`, doctor IDs such as `ai-agent-claude`, and executable names such as `claude-agent-acp` are boundary representations, not interchangeable domain identities.

### Eido lesson

Keep these as separate fields in Eido:

```text
Harness        = which agent runtime/CLI owns the conversation
Model provider = which model/account endpoint the harness uses (when applicable)
Model          = concrete model selection acknowledged by the runtime
Executable     = adapter/bridge command used to reach the harness
```

Do not make one `provider` string carry all four meanings. A target shape equivalent to BERD's `SessionExecutionTarget` is a strong starting point: `harnessId`, optional `modelProviderId`, optional concrete `modelId`, and display-only `modelName`. [`sessionExecutionTarget.ts#L3-L30`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sessionExecutionTarget.ts#L3-L30)

## 2. Installation is an app-owned, private, reproducible bridge supply chain

### Facts: two install families

BERD's managed ACP module documents two separate families:

- **Private npm prefix:** `packages/npm-prefix` for doctor fixes that install tools such as Copilot or Amp.
- **Managed bridges:** `packages/tools` plus `packages/bin` for Claude/Codex ACP bridges. Each has a checked-in immutable version and a checked-in `package.json` plus npm `package-lock.json` for the full dependency graph. [`managed_acp_tools.rs#L1-L29`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1-L29)

The managed bridge registry is explicit and small at this commit:

| Canonical provider ID | Shim binary | npm package | Pinned version |
| --- | --- | --- | --- |
| `claude-acp` | `claude-agent-acp` | `@agentclientprotocol/claude-agent-acp` | `0.66.0` |
| `codex-acp` | `codex-acp` | `@agentclientprotocol/codex-acp` | `1.2.0` |

The table is the source of the provider ID, binary name, package, and exact version; managed tools resolve by provider ID. [`managed_acp_tools.rs#L256-L321`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L256-L321)

The lock artifact shows that the ACP package is the executable entrypoint and that the package graph contains the harness implementation. Claude's bridge package has `bin: { "claude-agent-acp": "dist/index.js" }`, depends on the Claude Agent SDK, and the lock maps each platform to the native `claude` executable. [`acp-tools.lock.json#L4-L20`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/acp-tools.lock.json#L4-L20), [`acp-tools.lock.json#L35-L49`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/acp-tools.lock.json#L35-L49)

Codex's bridge package has `bin: { "codex-acp": "dist/index.js" }`, depends on `@openai/codex`, and the lock maps each platform to the native `codex` executable. [`acp-tools.lock.json#L1320-L1336`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/acp-tools.lock.json#L1320-L1336), [`acp-tools.lock.json#L1351-L1365`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/acp-tools.lock.json#L1351-L1365)

BERD's own comments state the consequence: the two bridge packages vendor their full agent CLI, so the user does not need a separate main-CLI install for those providers. [`managed_acp_tools.rs#L275-L281`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L275-L281)

### Facts: runtime and install directory contract

The Node runtime is also app-owned. BERD downloads the exact version in `node-runtime.lock.json`, verifies the lock's SHA-256, and installs under `<app-data>/packages/node/<version>/<platform>`. [`managed_node.rs#L1-L8`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_node.rs#L1-L8) The managed package root is `<app-data>/packages`, with `npm-prefix`, `tools`, `bin`, and the Node runtime beneath it. [`managed_acp_tools.rs#L69-L78`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L69-L78)

On every launch, the startup reconciler loops through all managed tools, installs/upgrades each one, records errors in state, and emits `berd:acp-tools-reconciled`. A failed bridge install is retried next launch; a previously working bridge remains in place. [`acp_tools_reconciler.rs#L1-L29`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp_tools_reconciler.rs#L1-L29), [`acp_tools_reconciler.rs#L47-L83`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp_tools_reconciler.rs#L47-L83)

For child-process resolution, BERD prepends (in order) a developer override if active, managed bridge shims, the private npm-prefix bin directory, and the managed Node bin directory. [`managed_acp_tools.rs#L174-L201`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L174-L201) `BERD_ACP_TOOLS_DIR` replaces managed resolution entirely for bridge development; the restricted `no-managed-acp-tools` feature and unsupported targets disable the managed set. [`managed_acp_tools.rs#L31-L35`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L31-L35), [`managed_acp_tools.rs#L103-L127`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L103-L127)

### Facts: pin replay and transactional commit

The installer does not run `npm install <package>` against a floating range. It stages a synthetic root `package.json` and the release-controlled `package-lock.json`, then runs `npm ci --prefix <staged tree>` with `--omit=dev`, `--include=optional`, `--ignore-scripts`, no audit/fund, explicit platform selectors, and an optional distribution registry. [`managed_acp_tools.rs#L1234-L1270`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1234-L1270), [`managed_acp_tools.rs#L1272-L1291`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1272-L1291)

The implementation removes inherited npm target selectors, forces the managed Node bin directory onto `PATH`, and applies the private npm cache. It streams both npm stdout and stderr and kills a hung npm after 15 minutes. [`managed_acp_tools.rs#L1293-L1396`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1293-L1396)

Before promotion, BERD requires all of the following:

1. The bridge entrypoint exists (`dist/index.js`).
2. The replayed lock graph contains exactly the expected package paths, versions, and npm integrity values—no missing or extra package.
3. The current target's mapped native executable exists physically.

Only after those checks does it write a shim and `state.json`; the install transaction atomically swaps the staged tree, shim, and state with backups/journal recovery. [`managed_acp_tools.rs#L536-L607`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L536-L607), [`managed_acp_tools.rs#L1102-L1202`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1102-L1202), [`managed_acp_tools.rs#L647-L774`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L647-L774)

The generated-lock script reinforces the design: it regenerates the exact package documents, normalizes registry hosts, replays the same `npm ci` command for each supported target, derives the native executable map from real installs, and requires `ManagedTool::version` to be updated with the lock. [`update-acp-tools-lock.mjs#L1-L12`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/scripts/update-acp-tools-lock.mjs#L1-L12), [`update-acp-tools-lock.mjs#L45-L82`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/scripts/update-acp-tools-lock.mjs#L45-L82)

### Inference

BERD treats a bridge as a release-managed product dependency, not as a user-installed convenience CLI. This is why the bridge's executable path, runtime, package graph, registry choice, platform selector, readiness probe, and upgrade state all have explicit seams.

### Eido lesson

For Eido's headless provider adapters, copy the supply-chain shape where the risk warrants it:

- Use an app-private runtime and provider install root.
- Pin the adapter package and transitive graph, not only the top-level version.
- Install into a staging directory; verify entrypoint, target-native executable, and graph; then atomically promote.
- Write a small absolute-path shim with argument forwarding; do not depend on the host's Node or PATH.
- Keep a last-known-good adapter if an update fails or the network is unavailable.
- Make the provider registry the only place that knows package name, binary name, version, target selectors, and health probe.

The notable trade-off is that transitive security updates require an explicit lock regeneration. BERD records that limitation in the lock artifact's own comment. [`acp-tools.lock.json#L1-L3`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/acp-tools.lock.json#L1-L3)

## 3. Goose is the process broker; ACP is the renderer-facing adapter protocol

### Facts: one long-lived Goose server

BERD's README says the app talks to upstream Goose via the ACP WebSocket served by a `goose serve` sidecar. [`README.md#L1-L5`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/README.md#L1-L5)

`GooseServeProcess` owns one long-lived child. It binds to a free loopback port, creates a per-process secret, and documents that each WebSocket connection to `/acp` creates an independent ACP agent, allowing one server to serve many concurrent sessions. [`goose_serve.rs#L47-L64`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L47-L64), [`goose_serve.rs#L147-L170`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L147-L170)

The spawn command is `goosed serve --enable-scheduler --host 127.0.0.1 --port <reserved port>`; release builds add the allowed Tauri WebView origin. BERD sets `GOOSE_SERVER__SECRET_KEY`, waits for the port to accept TCP connections, and exposes a tokenized `ws://127.0.0.1:<port>/acp` URL. [`goose_serve.rs#L232-L247`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L232-L247), [`goose_serve.rs#L363-L376`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L363-L376), [`goose_serve.rs#L987-L1012`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L987-L1012)

The command can be overridden for development (`GOOSE_BIN`); otherwise Tauri resolves the bundled `goosed` sidecar. [`goose_serve.rs#L974-L985`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L974-L985)

### Facts: environment is the bridge discovery contract

Before spawning Goose, BERD restores the user's login-shell environment, prepends the distro binary directory, then prepends managed ACP shims, private-prefix shims, and managed Node. It applies `PATH` and a JSON `GOOSE_SEARCH_PATHS` array. The source comment says Goose and harness children inherit this environment and that bridge resolution occurs through `PATH`/`GOOSE_SEARCH_PATHS`. [`goose_serve.rs#L173-L221`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L173-L221), [`goose_serve.rs#L1022-L1095`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L1022-L1095)

Runtime provider endpoint values and a declared Goose fast model are applied as environment variables to the Goose process. This is for Goose's own model-provider policy; it is not the external Claude/Codex bridge selection mechanism. [`goose_serve.rs#L1124-L1157`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L1124-L1157)

### Facts: renderer ACP connection

The renderer requests the Goose WebSocket URL through Tauri, creates a `GooseClient` over a WebSocket stream, initializes ACP with protocol version, client capabilities, and client identity, and reuses the client until it closes. On close/error, BERD clears the cached client so the next operation reconnects. [`acpConnection.ts#L61-L93`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpConnection.ts#L61-L93), [`acpConnection.ts#L122-L199`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpConnection.ts#L122-L199), [`acpConnection.ts#L202-L227`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpConnection.ts#L202-L227)

### Inference

Goose is the broker and ACP adapter host. React is not a provider-specific process supervisor. The bridge is selected by the provider ID and the broker's search path, while all renderer messages use one ACP shape.

### Unknown

The BERD repository does not contain Goose's provider dispatch implementation. It does not show whether Goose invokes each bridge as a child process per session, maintains a bridge process pool, or uses another internal strategy. The existence of `GOOSE_SEARCH_PATHS`, the managed shims, and the comments about Goose spawning bridges establish the contract but not the upstream implementation details.

### Eido lesson

For Eido, decide explicitly whether the product wants a broker boundary like Goose or direct CLI execution. If direct execution is retained, keep the same conceptual seam:

```text
Eido session target → adapter registry → child process command/env → normalized event stream
```

Do not let UI or a headless CLI construct raw provider commands ad hoc. A broker can centralize process reuse, session routing, permission handling, and normalized events; direct execution can still centralize those concerns in an adapter manager.

## 4. Chat routing: target tuple → ACP session config → prompt

### Facts: target tuple and wire conversion

`SessionExecutionTarget` separates a harness from a concrete model provider/model. `normalizeSessionExecutionTarget` rejects a model without a provider and rejects treating Goose itself as a concrete model provider. [`sessionExecutionTarget.ts#L33-L82`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sessionExecutionTarget.ts#L33-L82)

When converting a target to the Goose/ACP boundary, BERD sends:

- `target.harnessId` for an external harness (`claude-acp`, `codex-acp`, etc.).
- `target.modelProviderId` for a Goose session using a concrete model provider.
- `goose` as the default sentinel when a Goose target has no concrete model provider.

This is encoded in `gooseServeSelectionFromExecutionTarget`. [`gooseServeExecutionTarget.ts#L72-L86`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/gooseServeExecutionTarget.ts#L72-L86)

The inverse boundary canonicalizes persisted/ACP provider fields, drops a model when there is no provider identity, and uses known harness IDs to choose the harness. [`gooseServeExecutionTarget.ts#L88-L107`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/gooseServeExecutionTarget.ts#L88-L107), [`gooseServeExecutionTarget.ts#L110-L140`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/gooseServeExecutionTarget.ts#L110-L140)

### Facts: session preparation and provider selection

`acpPrepareSession` resolves the selection, then either configures a concrete model or prepares the provider. `acpCreateSession` sends `newSession` with a provider ID (unless it is the default Goose sentinel with deferred setup), then explicitly calls `setProvider` for concrete providers. BERD's comment is important: concrete providers are sent even without a model so Goose does not fall back to a missing global provider. [`acp.ts#L376-L410`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L376-L410), [`acp.ts#L412-L460`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L412-L460)

`setProvider` writes ACP config ID `provider` and uses `toWireProviderId`. `setModel` writes config ID `model`. The response is converted into a config snapshot and recorded with the provider/model context. [`acpApi.ts#L215-L247`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts#L215-L247), [`acpApi.ts#L286-L322`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts#L286-L322)

`resolveGooseSessionSelection` treats catalog entries with `category: "agent"` as outside Goose model-provider policy and passes their concrete model ID through. Goose model providers are instead checked against runtime policy; a concrete provider cannot be silently replaced by another provider's default. [`acp.ts#L327-L374`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L327-L374)

`toWireProviderId` rewrites only the `goose` agent sentinel to the current default model provider; real IDs such as `claude-acp` and `codex-acp` pass through unchanged. [`acpPersonaHandoff.ts#L22-L39`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpPersonaHandoff.ts#L22-L39)

### Facts: session registry prevents stale routing

The ACP session registry serializes mutations per session, tracks the provider and last model acknowledged by ACP, updates the working directory, and rejects prompts unless the session has a configured provider and model. [`acpSessionRegistry.ts#L21-L37`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpSessionRegistry.ts#L21-L37), [`acpSessionRegistry.ts#L102-L129`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpSessionRegistry.ts#L102-L129), [`acpSessionRegistry.ts#L132-L229`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpSessionRegistry.ts#L132-L229), [`acpSessionRegistry.ts#L349-L381`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpSessionRegistry.ts#L349-L381)

Model application requires ACP to acknowledge the requested model. If the acknowledged model differs, BERD drops the cached selection and rejects the operation rather than proceeding with an unverified target. [`acpSessionRegistry.ts#L235-L309`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpSessionRegistry.ts#L235-L309)

The target coordinator is latest-wins and rechecks ownership after asynchronous preparation. It can resolve a Goose model selection repair, call `acpPrepareSession`, materialize a model snapshot from the ACP response, and commit only if the session still belongs to that selection. [`sessionTargetCoordinator.ts#L203-L234`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sessionTargetCoordinator.ts#L203-L234), [`sessionTargetCoordinator.ts#L267-L445`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/sessionTargetCoordinator.ts#L267-L445)

### Facts: prompt dispatch is provider-neutral after preparation

`acpSendMessage` requires the session registry to confirm a prepared provider, assembles ACP content blocks, and calls `directAcp.prompt`. The same path carries text and image blocks to Goose/ACP for every harness. [`acp.ts#L142-L151`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L142-L151), [`acp.ts#L153-L289`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L153-L289)

The low-level ACP API sends the same `prompt({ sessionId, prompt: content, _meta })` request and does not expose provider-specific command construction in the renderer. [`acpApi.ts#L468-L486`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts#L468-L486)

### Inference

For Claude Code and Codex, the route is effectively:

```text
selected `claude-acp` / `codex-acp`
  → target.harnessId
  → ACP `provider` option
  → Goose provider dispatch
  → matching PATH/GOOSE_SEARCH_PATHS shim
  → ACP bridge package
  → vendored Claude/Codex runtime
```

The renderer never needs to know `claude --...` versus `codex ...` prompt flags. That translation is behind the bridge/broker boundary.

### Eido lesson

Make “selection” and “dispatch” different phases:

1. Normalize aliases to a canonical adapter ID.
2. Build a typed target tuple.
3. Prepare/configure the target and wait for an acknowledgement.
4. Snapshot the acknowledged target into the session.
5. Dispatch a provider-neutral prompt/event protocol.

Reject prompts when the session has not completed preparation. Serialize target mutations per session and make newer user selections supersede older in-flight selections.

## 5. Provider/model inventory and capability differences

### Facts

The model picker uses a different inventory rule for Goose and external agents. For an external agent, `getModelsForAgent(agentId)` returns the models cached for that exact agent provider. For Goose, it combines model lists from all configured model providers and applies runtime recommendation metadata. [`useProviderModels.ts#L91-L124`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/providers/hooks/useProviderModels.ts#L91-L124)

The cache discovers model IDs through Goose's `GooseUnstableProvidersSupportedModelsList({ providerId })`, transforms IDs into model options, persists them in localStorage, and refreshes non-runtime-managed inventories after a five-minute TTL. [`providerModelCacheStore.ts#L8-L20`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/providers/stores/providerModelCacheStore.ts#L8-L20), [`providerModelCacheStore.ts#L112-L149`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/providers/stores/providerModelCacheStore.ts#L112-L149), [`providerModelCacheStore.ts#L213-L353`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/providers/stores/providerModelCacheStore.ts#L213-L353)

Model-provider resolution handles ambiguous/unqualified model IDs. A model provider is removed when it is the Goose sentinel; an external harness defaults its model provider to the harness ID; Goose only accepts an inferred provider when exactly one inventory provider matches. [`modelProviderResolution.ts#L21-L39`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/providers/lib/modelProviderResolution.ts#L21-L39), [`modelProviderResolution.ts#L41-L98`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/providers/lib/modelProviderResolution.ts#L41-L98)

Readiness is not a single “binary exists” check. BERD derives `ready`, `not_installed`, and `not_ready` from doctor status, bridge presence, curated capabilities, and auth status. A missing ACP bridge (`fixType: "bridge"`) makes a two-binary agent not installed. A bundled bridge must resolve its `path`; a missing path means the bundle is broken. Auth-capable agents with a real probe use `authStatus`; auth-capable agents without a probe are pessimistically `not_ready`; no-auth agents become ready once installed. [`useAgentProviderStatus.ts#L42-L115`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/providers/hooks/useAgentProviderStatus.ts#L42-L115)

The model picker only permits switching to an agent in `ready` state, and determines whether the action should be `install` or `connect` from readiness and catalog capabilities. [`useAgentModelPickerState.ts#L53-L103`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/hooks/useAgentModelPickerState.ts#L53-L103), [`useAgentModelPickerState.ts#L156-L168`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/hooks/useAgentModelPickerState.ts#L156-L168)

Skills expose another capability split. Goose/model providers use Goose source discovery, while external agents use agent skill files. Activation style is inferred from provider identity (`codex`, `claude`, `gemini`, or standard). [`skillProviderCapabilities.ts#L1-L38`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/skillProviderCapabilities.ts#L1-L38)

### Capability matrix at this commit

| Capability | Goose | Claude Code | Codex | Copilot / Amp / Cursor |
| --- | --- | --- | --- | --- |
| Catalog class | Agent + default broker | External agent harness | External agent harness | External agent harness |
| Canonical ID | `goose` | `claude-acp` | `codex-acp` | `copilot-acp`, `amp-acp`, `cursor-agent` |
| BERD-managed bridge | `goosed` sidecar | Yes | Yes | No in `MANAGED_TOOLS` |
| App-private binary path | Bundled sidecar | `packages/bin/claude-agent-acp` | `packages/bin/codex-acp` | Private prefix / user or distro path depending on doctor fix |
| Auth status probe | Goose model-provider readiness | Yes (`supportsAuthStatus`) | Yes (`supportsAuthStatus`) | Varies; Copilot is explicitly no probe |
| Model inventory | Combined configured providers | Per agent provider cache | Per agent provider cache | Per agent provider cache unless disabled |
| System-prompt channel | Goose extension | No Goose extension; in-band handoff | No Goose extension; in-band handoff | Same external-agent fallback |
| Skill discovery | Goose sources | Agent skill files | Agent skill files | Agent skill files |

Rows for Claude/Codex come from the curated catalog, managed tool table, readiness logic, and persona/skill capability code. The “private prefix / user or distro path” wording for other agents is intentionally qualified: BERD's code supports multiple doctor installation sources, and this dossier does not claim a single path for every release configuration.

### Eido lesson

Represent adapter capabilities as data, not scattered conditionals. At minimum, Eido should track:

```text
install mode       = managed | external | bundled | unavailable
auth mode          = none | login-command | OAuth/browser | API-key
auth observation   = probeable | unprobeable
model inventory    = none | static | queried | harness-owned
system prompt      = native channel | in-band fallback | unsupported
skills             = shared files | harness-specific files | prompt-only
stream protocol    = ACP-like normalized events | stdout parser | JSONL | unknown
```

That matrix determines setup UX, readiness, prompt assembly, model picker behavior, and failure messaging.

## 6. Setup/auth orchestration is backend-owned and fail-closed

### Facts

The frontend sends a typed provider ID, action, and setup plan; Rust owns the operation registry, streamed output, phase, terminal status, and rehydration. The registry is keyed by provider ID, idempotently ignores duplicate starts while an operation is running, bounds output to 50 lines, and garbage-collects old terminal entries. [`agent_setup.rs#L1-L16`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L1-L16), [`agent_setup.rs#L42-L103`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L42-L103), [`agent_setup.rs#L207-L293`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L207-L293)

The frontend contract explicitly says that the backend is the source of truth and that progress survives navigation and a full reload. [`agentSetup.ts#L1-L11`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/providers/api/agentSetup.ts#L1-L11)

Frontend provider IDs map to the doctor crate's `ai-agent-*` IDs at one boundary (`claude-acp` → `ai-agent-claude`, `codex-acp` → `ai-agent-codex`). [`agent_setup.rs#L358-L377`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L358-L377)

The install/auth chain re-probes doctor state and authorizes the requested typed operation before doing work. It rejects a renderer-supplied install seed that does not match the currently offered fix. For update operations, the renderer names only `updateMain`/`updateBridge`; Rust resolves the exact source-aware command from the fresh doctor readout and rejects duplicates. [`agent_setup.rs#L529-L598`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L529-L598), [`agent_setup.rs#L683-L729`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L683-L729)

Auth authorization is capability-aware. BERD distinguishes:

- `None`: no registered login flow (for example Goose/pi).
- `Probeable`: login command plus status probe (the source comments name Claude, Codex, Amp, and Cursor); auth is permitted only when doctor currently offers `Auth`.
- `Unprobeable`: login command without a status probe (the source names Copilot); auth is permitted only when the agent is installed and no install fix is offered.

[`agent_setup.rs#L600-L681`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L600-L681)

For managed Claude/Codex bridge installs, `run_fix` dispatches to the managed installer rather than executing a renderer-provided command. Other doctor fixes resolve a trusted command and run it with the private environment; npm-backed fixes ensure the managed Node runtime first. [`agent_setup.rs#L907-L976`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L907-L976)

The older/general doctor command has the same backend gate: it accepts only typed `(check_id, fix_type)`, resolves the currently offered fix, and dispatches to managed install, local command, or crate command. No renderer-supplied command string crosses the wire. [`doctor.rs#L1555-L1563`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/doctor.rs#L1555-L1563), [`doctor.rs#L1585-L1644`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/doctor.rs#L1585-L1644), [`doctor.rs#L1664-L1690`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/doctor.rs#L1664-L1690)

The Windows managed-bridge repair reveals the provider-specific login command forms BERD expects at that boundary: `claude-agent-acp --cli auth login` and `codex-acp cli login`, with corresponding status probes. [`doctor.rs#L1214-L1313`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/doctor.rs#L1214-L1313)

### Inference

BERD's setup API is a capability-authorized job system, not a UI callback that shells out. The backend owns the recipe and checks that the recipe is still valid immediately before the side effect. This protects against stale UI state and a compromised renderer.

### Unknown

The exact persistence location and credential storage behavior of Claude Code/Codex are delegated to those harnesses/bridges. BERD's source shows login/status commands and readiness probes, but does not expose provider tokens or implement their authentication stores.

### Eido lesson

Adopt a typed setup plan and backend-owned execution:

```text
UI/CLI request: providerId + action + typed fix identity
        │
        ▼
backend re-probe → authorize current capability/fix → resolve trusted command
        │
        ▼
run in managed env → stream bounded output → verify readiness → persist result
```

Never accept a raw shell command from Eido's renderer, CLI client, or automation payload. For headless CLI use, the same rule means the CLI should send an adapter ID and intent; the adapter registry should supply command, arguments, environment, and health/auth probes.

## 7. Prompt/system-prompt normalization across harnesses

### Facts

Goose has a Goose-only ACP extension for system prompts. External agents do not implement it, and the generic ACP protocol does not provide a system-prompt channel on `session/new` or `session/prompt`. BERD therefore injects persona/app instructions once, on the first prompt for a `(session, provider, persona/system-prompt fingerprint)`, as an assistant-audience content block. Switching provider or changing persona creates a new handoff key. [`acpPersonaHandoff.ts#L1-L16`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpPersonaHandoff.ts#L1-L16), [`acpPersonaHandoff.ts#L41-L66`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpPersonaHandoff.ts#L41-L66)

`acpSendMessage` applies Goose's native system prompt extension for Goose/model-provider sessions, but calls `preparePersonaHandoff` for external agents. It merges the handoff with skill/builder assistant text before the user's content and sends the resulting ACP content blocks. [`acp.ts#L179-L247`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L179-L247)

### Inference

BERD normalizes the *intent* of system instructions while allowing the transport to differ by capability. It does not pretend that a generic “system prompt” API means every harness has a native system channel.

### Eido lesson

Make system/context delivery an adapter capability. For a headless CLI adapter, explicitly choose one of:

- native system/developer channel;
- one-time in-band handoff;
- per-turn prefix (only if required and safe);
- unsupported, with a visible capability warning.

Track delivery state by session + adapter + prompt fingerprint so a provider switch does not silently inherit or lose context.

## 8. Fact / inference / unknown ledger

### Facts directly visible in BERD

- Claude and Codex have canonical ACP provider IDs and are marked as bundled ACP bridges. [`curatedProviders.ts#L15-L41`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/providers/curatedProviders.ts#L15-L41)
- The managed bridge table contains only Claude and Codex at this commit. [`managed_acp_tools.rs#L275-L295`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L275-L295)
- The bridge packages and platform-native harness executable paths are locked in `acp-tools.lock.json`. [`acp-tools.lock.json#L4-L12`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/acp-tools.lock.json#L4-L12), [`acp-tools.lock.json#L1320-L1328`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/acp-tools.lock.json#L1320-L1328)
- Goose is spawned once as a local `goose serve` process and exposes tokenized ACP WebSocket connectivity. [`goose_serve.rs#L51-L87`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L51-L87)
- Renderer-to-backend chat operations are ACP `newSession`, `setProvider`, `setModel`, and `prompt`; the renderer does not build Claude/Codex command lines. [`acpApi.ts#L215-L322`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts#L215-L322), [`acpApi.ts#L412-L486`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts#L412-L486)
- Bridge discovery depends on managed shims plus `PATH`/`GOOSE_SEARCH_PATHS`. [`goose_serve.rs#L195-L209`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L195-L209)
- Setup/auth and readiness are backend-gated and capability-aware. [`agent_setup.rs#L640-L681`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L640-L681), [`useAgentProviderStatus.ts#L76-L113`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/providers/hooks/useAgentProviderStatus.ts#L76-L113)

### Inferences from the boundary contract

- Goose is the process router that turns a provider ID plus search-path contract into an external harness bridge invocation.
- The ACP bridge package is the provider-specific translation layer from generic ACP session/prompt operations into Claude Code or Codex behavior.
- BERD's durable session identity is the acknowledged target tuple, not the user's last picker click.

### Unknowns requiring upstream or runtime inspection

- Goose's internal child-process supervision, bridge reuse/pooling, and exact provider-dispatch implementation.
- Exact Claude Agent ACP and Codex ACP command-line argument mapping and event quirks inside their npm packages.
- Where each harness stores auth state on a user's machine and whether the bridge modifies inherited environment variables.
- Whether an installed `/Applications/Berd.app` instance has the same embedded versions as this pinned source commit.
- Eido's current CLI provider architecture and which BERD patterns are compatible with its existing process and profile boundaries.

## 9. Prioritized Eido takeaways

### Highest leverage

1. **Separate harness and model-provider identity.** Adopt a target tuple and persist the ACP/adapter-acknowledged selection.
2. **Centralize adapters in a registry.** One record should own canonical ID, aliases, executable/bridge, install mode, command construction, environment policy, auth/status probe, model inventory, and event parser.
3. **Use a provider-neutral event contract.** Route all provider output through one normalized stream; keep Claude/Codex quirks at the adapter boundary.
4. **Protect headless invocation with typed intents.** Accept provider ID and operation fields, never arbitrary shell text. Re-probe and authorize before install/login/update/run.
5. **Make provider setup durable.** Backend-owned/idempotent jobs with bounded output, reload-safe status, and last-known-good fallback are more reliable than UI-owned subprocess state.

### Important hardening

6. **Private, transactional installs.** Managed runtime + pinned graph + target-native verification + absolute shims + atomic promotion.
7. **Capability matrix.** Explicitly model auth probeability, model inventory, system prompt, skills, streaming, and cancellation rather than assuming parity.
8. **Race-safe session routing.** Serialize per-session target mutations, require provider/model acknowledgement, and make latest selection win.
9. **Context handoff semantics.** If a harness lacks a native system channel, use a deliberate, fingerprinted handoff and make provider switches trigger a new one.
10. **Keep unknowns visible.** Don't infer bridge internals from a provider label; expose adapter health and provenance so failures say whether they occurred in setup, bridge startup, harness auth, model selection, or prompt transport.

### Suggested Eido adapter record

```ts
interface HeadlessHarnessAdapter {
  id: string;                 // canonical, e.g. "codex"
  aliases: string[];
  bridge: { command: string; args: string[] };
  install: {
    mode: "managed" | "external" | "bundled";
    version?: string;
    lock?: string;
    nativeExecutable?: Record<string, string>;
  };
  capabilities: {
    auth: "none" | "login-command" | "oauth" | "api-key";
    authStatus: "probeable" | "unprobeable";
    modelInventory: "none" | "static" | "queried" | "harness-owned";
    systemPrompt: "native" | "in-band" | "unsupported";
    skills: "shared-files" | "harness-files" | "prompt-only";
    stream: "acp" | "jsonl" | "stdout";
  };
  buildInvocation(input: {
    sessionId: string;
    workingDir: string;
    modelId?: string;
    prompt: string;
  }): { command: string; args: string[]; env: Record<string, string> };
  probe(): Promise<{ installed: boolean; authenticated: boolean }>;
  normalizeEvent(raw: unknown): NormalizedHarnessEvent;
}
```

Treat this as a design direction derived from BERD, not a claim that Eido should copy every Goose/ACP detail. The decisive BERD pattern is the depth of the adapter seam: the rest of the app can route sessions, persist intent, and render normalized events without learning each harness's CLI grammar.
