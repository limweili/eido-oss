# BERD: install, discovery, authentication, and harness routing

**Research lane:** install/discovery/authentication

**Source boundary:** BERD checkout at commit `874e078c931c14386a7d2e16cfe3b32cdbe295e0` (the links below are pinned to that commit), plus a read-only inspection of the locally installed `/Applications/Berd.app` on 2026-08-22. The local app is useful corroboration, but the pinned source is the authority for behavior.

## Executive answer

BERD has two deliberately different installation boundaries:

1. **Goose is the application backend.** Release builds bundle a pinned `goosed` sidecar and connect to its local ACP WebSocket. This is not a user-installed provider CLI.
2. **Claude Code and Codex are managed ACP bridge packages.** BERD downloads them on launch or from the provider setup UI into private app data, using a BERD-managed Node runtime, a checked-in npm lock graph, platform selectors, and absolute-path shims. The bridges vendor the full Claude/Codex CLI, so BERD does not need to install the user's global `claude` or `codex` command.

The chat route is therefore:

```text
UI provider/session target
        |
        |  ACP session/new: _meta.provider = provider/harness id
        v
one long-lived goosed process (local ACP WebSocket)
        |
        +-- provider = goose       -> Goose model-provider policy
        |
        +-- provider = claude-acp  -> packages/bin/claude-agent-acp
        |                              -> managed Node + ACP bridge
        |                              -> vendored Claude Code CLI/runtime
        |
        +-- provider = codex-acp   -> packages/bin/codex-acp
                                       -> managed Node + ACP bridge
                                       -> vendored Codex CLI/runtime
```

This is a useful separation for Eido: **harness selection is not model selection**. BERD treats `goose` as an in-app harness whose model provider can be selected by Goose policy, while Claude/Codex/etc. are external ACP harness providers whose IDs pass through unchanged.

## 1. What BERD packages and what it discovers

The repository describes the app as a Tauri desktop whose agent loop goes through ACP and whose shell starts or resolves `goose serve`; it also identifies `acp-tools.lock.json` as the release-controlled npm input for managed bridges. [AGENTS.md#L5-L22](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/AGENTS.md#L5-L22)

The public build bundles the Goose backend as the `goosed` Tauri external sidecar. `just bundle` stages the pinned backend; `GOOSE_BIN` is explicitly a local override rather than the normal installation path. [README.md#L35-L54](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/README.md#L35-L54) [AGENTS.md#L113-L125](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/AGENTS.md#L113-L125)

The managed bridge table is small and explicit:

| UI/provider id | shim | npm package | pinned source version at this commit | install model |
|---|---|---|---:|---|
| `claude-acp` | `claude-agent-acp` | `@agentclientprotocol/claude-agent-acp` | `0.66.0` | BERD-managed bridge; package vendors full Claude Code CLI |
| `codex-acp` | `codex-acp` | `@agentclientprotocol/codex-acp` | `1.2.0` | BERD-managed bridge; package vendors full Codex CLI |

The comments in the implementation explicitly say that both managed packages vendor their agent's full CLI, making a separate main-CLI install unnecessary. [managed_acp_tools.rs#L252-L295](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L252-L295) The checked-in lock records the native executable that must exist for each target: Claude's native `claude` executable and Codex's vendored `codex` executable. [acp-tools.lock.json#L1-L20](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/acp-tools.lock.json#L1-L20) [acp-tools.lock.json#L1320-L1365](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/acp-tools.lock.json#L1320-L1365)

Other agents are catalogued but not necessarily BERD-managed:

- Claude Code and Codex are `bundledBridge: true`, with install/auth/status support.
- Copilot, Amp, and Cursor are external agent entries with their own binary names and setup capabilities.
- Goose is the built-in default provider and has no CLI setup step in the frontend catalog.

The catalog is an allowlisted product registry, not a free-form scan of arbitrary executables. [curatedProviders.ts#L4-L82](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/providers/curatedProviders.ts#L4-L82) The frontend `listProviders()` returns that curated agent catalog, and `discoverAcpProviders()` canonicalizes provider IDs/aliases against it. [acpApi.ts#L90-L116](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L90-L116) [acpApi.ts#L60-L68](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts#L60-L68)

**Interpretation:** discovery is split cleanly. The catalog answers “which providers does BERD know how to route?”, while Doctor answers “what is installed, where did it come from, is it authenticated, and is an install/update fix actionable?”. BERD does not make arbitrary PATH binaries become first-class providers merely because they happen to exist.

## 2. Managed installation lifecycle

### Startup reconciliation

At app setup, BERD starts a background reconciler for every managed bridge. It retries on the next launch after failure, preserves the last working bridge, and prunes old Node runtimes only after the full reconcile succeeds. [acp_tools_reconciler.rs#L1-L29](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp_tools_reconciler.rs#L1-L29) [acp_tools_reconciler.rs#L47-L84](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp_tools_reconciler.rs#L47-L84) The app wires this reconciler into startup directly. [lib.rs#L368-L376](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/lib.rs#L368-L376)

The lifecycle is:

```text
app launch
  -> enumerate MANAGED_TOOLS
  -> ensure BERD-managed Node runtime
  -> create staged bridge tree in app data
  -> write checked-in package.json + package-lock.json
  -> npm ci --prefix <staged-tree> with target selectors
  -> verify exact graph, integrity, entrypoint, and native executable
  -> write absolute shim + state.json
  -> atomically promote staged artifacts
  -> emit berd:acp-tools-reconciled
  -> frontend reruns Doctor/readiness
```

The installer is intentionally transactional. It serializes concurrent provider/setup/reconcile installs with a process-wide mutex, stages the npm tree, checks the entrypoint and native executable before promotion, writes the shim and state, then commits. A failed install cleans only the staging area and leaves the old bridge usable. [managed_acp_tools.rs#L459-L470](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L459-L470) [managed_acp_tools.rs#L513-L608](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L513-L608)

### Lockfile and supply-chain boundary

`acp-tools.lock.json` contains the release-controlled package manifest and complete npm lock graph. BERD writes those documents into the staged tree before running `npm ci`; it does not pass a package spec that would re-resolve a range from the registry. The command includes `--omit=dev`, `--include=optional`, `--ignore-scripts`, `--no-audit`, `--no-fund`, target selectors, and an optional distribution registry. [managed_acp_tools.rs#L1234-L1290](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1234-L1290)

After npm exits, BERD re-reads the lockfile and verifies every expected package has the exact expected version/integrity, rejects extra packages, and requires the target-native executable to be a physical file. This matters because optional native package fetch/extract failures can otherwise produce a clean npm exit but an unrunnable bridge. [managed_acp_tools.rs#L1102-L1201](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1102-L1201)

The installer derives npm target selectors for macOS arm64/x64, Linux glibc arm64/x64, and Windows x64; it clears inherited npm target variables so a user's npm configuration cannot materialize the wrong native artifact. [managed_acp_tools.rs#L1204-L1231](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1204-L1231) [managed_acp_tools.rs#L1316-L1344](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1316-L1344)

### Runtime and directories

All npm-backed assets live below `<app-data>/packages`, with separate locations for the private npm prefix, managed bridge trees, managed Node, bridge shims, and `state.json`. [managed_acp_tools.rs#L69-L100](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L69-L100) BERD sets both uppercase and lowercase npm prefix/cache variables plus `COREPACK_HOME`, after sanitizing inherited values, so normal user npm globals are not mutated. [managed_acp_tools.rs#L212-L242](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L212-L242)

The generated shim has no dependency on a host `node`: Unix uses `#!/bin/sh` and absolute Node + entrypoint paths; Windows uses an absolute `.cmd` launcher and `%*` argument forwarding. [managed_acp_tools.rs#L1398-L1417](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1398-L1417)

### Developer/restricted-build escape hatches

`BERD_ACP_TOOLS_DIR` replaces managed resolution completely: no managed tools, shim directory, or installs are attempted. A `no-managed-acp-tools` build feature similarly compiles the managed set out, and unsupported targets stay silent. [managed_acp_tools.rs#L1-L35](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1-L35) [managed_acp_tools.rs#L297-L321](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L297-L321)

## 3. Provider setup UX and validation

The Rust backend owns install/update/auth orchestration. The renderer starts an operation and observes an event-backed registry, so a setup operation continues after navigation or a full window reload. [agent_setup.rs#L1-L16](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L1-L16)

The setup plan deliberately carries **fix identities**, not arbitrary shell strings. Install can name only `command` or `bridge`; update can name only `updateMain` or `updateBridge`; the backend re-derives the exact source-aware command from its current trusted Doctor readout. [agent_setup.rs#L118-L185](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L118-L185)

For a from-scratch two-binary agent, setup re-probes after each pass: the main CLI may appear first, then the ACP bridge. The pinned source comment describes Codex as `codex` plus `codex-acp` under one click. For the current managed Claude/Codex path, the bridge package already vendors the main CLI, so this two-pass behavior is mainly relevant to external/two-binary Doctor recipes or older/alternate provider paths. [agent_setup.rs#L812-L875](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L812-L875) Managed Claude/Codex command/bridge fixes are intercepted and routed to the managed installer; other npm-backed fixes first ensure the managed Node runtime, then execute the Doctor fix with the managed environment. [agent_setup.rs#L907-L975](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L907-L975) [agent_setup.rs#L978-L1025](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L978-L1025)

Doctor returns independent main/bridge paths, versions, install sources, freshness, and auth status. This lets BERD distinguish “main CLI exists but bridge missing” from “bundled bridge exists but is broken”. [doctor.ts#L3-L77](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/doctor.ts#L3-L77)

Readiness follows those semantics: Goose is considered separately because the in-app `goosed` sidecar does not depend on a system Goose CLI; a bundled bridge must resolve its `path`; a two-binary agent may be ready from either main or bridge path; auth-capable agents are not ready until authenticated. [useAgentProviderStatus.ts#L20-L105](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/providers/hooks/useAgentProviderStatus.ts#L20-L105)

When startup reconciliation finishes, the backend emits `berd:acp-tools-reconciled`; the renderer reruns Doctor immediately so a fresh profile does not remain stuck on “Install” while the background bridge download has already completed. [acp_tools_reconciler.rs#L35-L84](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp_tools_reconciler.rs#L35-L84) [AcpToolsEvents.tsx#L1-L31](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/app/AcpToolsEvents.tsx#L1-L31)

## 4. Authentication behavior

BERD delegates provider-specific sign-in to the Doctor-registered agent commands, but puts an authorization gate in front of them. The backend classifies providers from its own static Doctor metadata:

| capability | Doctor metadata | BERD authorization rule |
|---|---|---|
| None | no login command (e.g. Goose/Pi) | reject renderer-requested sign-in |
| Probeable | login command + auth-status probe (Claude, Codex, Amp, Cursor) | allow only when current Doctor state offers `Auth` |
| Unprobeable | login command but no auth-status probe (Copilot) | allow only when installed and no install fix is currently offered |

The capability classification is backend-owned, and the auth gate fails closed for unknown providers or stale state. [agent_setup.rs#L600-L638](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L600-L638) [agent_setup.rs#L640-L680](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L640-L680)

The auth operation re-reads the current Doctor check, authorizes it, runs the static auth fix, and then verifies installation/path. [agent_setup.rs#L878-L905](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/agent_setup.rs#L878-L905) The renderer never supplies an arbitrary login command. BERD's public source does not expose provider tokens, OAuth refresh tokens, or the exact credentials-file/keyring implementation used by each vendored harness; those remain harness/Doctor behavior rather than app-owned data in this repository.

**Important distinction:** installation status is not authentication status. A bridge can be physically present and resolve on PATH while Claude/Codex still require sign-in. BERD's readiness code preserves that distinction instead of treating a resolved executable as ready.

## 5. PATH, shell, and platform behavior

Desktop apps launched from Finder/Dock often inherit a minimal launchd environment. Before spawning Goose, BERD captures the user's home interactive login shell environment and then prepends the distro bin directory and managed bridge/runtime directories. [goose_serve.rs#L170-L209](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L170-L209)

On Unix, shell capture resolves `$SHELL` with `/bin/bash` fallback and runs it as `-i -l`; if capture fails, PATH falls back to the app process PATH. [dir_env/unix.rs#L10-L30](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/dir_env/unix.rs#L10-L30) [dir_env/unix.rs#L51-L73](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/dir_env/unix.rs#L51-L73) PATH construction deduplicates, filters stale Unix Hermit activation paths, preserves a usable fallback, and appends common tool-manager shims. [path_env.rs#L5-L58](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/path_env.rs#L5-L58)

The managed prepend order is:

```text
BERD_ACP_TOOLS_DIR override (if active)
  -> packages/bin                 (Claude/Codex absolute shims)
  -> packages/npm-prefix/bin     (npm-installed Copilot/Amp bridge shims)
  -> packages/node/<pin>/bin     (node/npm runtime)
  -> captured user PATH
  -> tool-manager dirs
```

That order is encoded in the backend and is used wherever agent binaries need to resolve. [managed_acp_tools.rs#L174-L210](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L174-L210) BERD also writes `GOOSE_SEARCH_PATHS` as a JSON array with the same prepend directories, so Goose's own discovery does not depend on PATH alone. [goose_serve.rs#L1022-L1095](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L1022-L1095)

The managed target matrix is explicit for macOS arm64/x64, Linux glibc arm64/x64, and Windows x64. Unix shims are shell scripts; Windows uses `.cmd` launchers and target-aware npm global-bin placement. [managed_acp_tools.rs#L80-L100](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L80-L100) [managed_acp_tools.rs#L1204-L1231](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1204-L1231)

## 6. How chats actually route to the harnesses

Goose is a singleton long-lived server. Each ACP WebSocket connection creates an independent ACP agent/session, allowing concurrent sessions through one process. [goose_serve.rs#L47-L70](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L47-L70) The frontend obtains the authenticated local WebSocket URL from Tauri and initializes the Goose ACP client over that stream. [acpConnection.ts#L137-L199](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpConnection.ts#L137-L199)

When creating a session, BERD puts the selected provider in ACP `session/new` metadata and then explicitly sets the provider on the session. [acpApi.ts#L405-L438](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts#L405-L438) [acpApi.ts#L446-L477](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpApi.ts#L446-L477)

The selection policy is intentionally asymmetric:

- A concrete agent harness ID (`claude-acp`, `codex-acp`, `copilot-acp`, etc.) bypasses Goose's model-provider allowlist.
- The `goose` sentinel is resolved through runtime Goose provider policy/defaults.
- A concrete provider is not silently replaced with another provider's default model.

This policy is explicit in `resolveGooseSessionSelection`. [acp.ts#L327-L374](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L327-L374) The wire conversion makes the same contract visible: `goose` becomes its concrete default model provider, while real harness IDs pass through unchanged. [acpPersonaHandoff.ts#L22-L39](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpPersonaHandoff.ts#L22-L39) [gooseServeExecutionTarget.ts#L36-L85](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/chat/lib/gooseServeExecutionTarget.ts#L36-L85)

External harnesses do not implement Goose's system-prompt extension. BERD therefore sends Goose-owned persona/system instructions through the Goose ACP extension, but uses a one-time in-band assistant-audience handoff for Claude Code, Codex, Copilot, Amp, and Cursor. The handoff is keyed by session/provider/persona fingerprint, so switching harnesses replays the handoff exactly once for the new target. [acp.ts#L179-L232](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L179-L232) [acpPersonaHandoff.ts#L1-L16](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpPersonaHandoff.ts#L1-L16)

**Implication:** the bridge is the process-level adapter; the ACP `provider` field is the session-level route. BERD does not make every provider look like a Goose model API. It preserves external harness identity and adapts only the pieces (system prompt, setup, status) that the external ACP surface lacks.

## 7. Local installed-app corroboration

Read-only inspection of `/Applications/Berd.app` on 2026-08-22 found:

- app version `0.6.2`, arm64 macOS binaries including `Berd`, `berdctl`, `goosed`, and `catch`;
- dynamic bridge assets under the user's app-data `packages` directory rather than an embedded `acp` directory in the app bundle;
- managed Node `v24.11.0/darwin-arm64`;
- `packages/bin/claude-agent-acp` and `packages/bin/codex-acp` shims with absolute Node and entrypoint paths;
- `packages/state.json` reporting installed bridge versions `claude-acp 0.70.0` and `codex-acp 1.6.2`, with a successful last reconcile.

This live artifact corroborates the architecture (app-data installs, absolute shims, stateful reconcile), but it is newer than the pinned source's `0.66.0` / `1.2.0`. Do not mix those versions in implementation decisions: source links above establish the pinned behavior; the local inspection establishes only the observed packaging shape.

## 8. Facts, inferences, and unknowns

### Facts from the pinned source

- Goose is bundled as a pinned `goosed` sidecar; `GOOSE_BIN` is an explicit local override.
- Claude and Codex use BERD-managed ACP bridge packages that vendor their full CLI, installed under private app data with managed Node.
- The bridge install is lockfile-driven, target-aware, integrity-checked, native-executable-checked, transactional, and retried on launch.
- The frontend provider catalog is curated and alias-canonicalized; Doctor supplies binary paths, versions, install source, freshness, and auth status.
- Backend setup and auth are stateful and fail closed: the renderer supplies narrow fix identities, not shell commands or arbitrary login commands.
- `goose` and external harness IDs are separate route classes; concrete external provider IDs bypass Goose model policy.
- External harnesses receive persona context through an in-band handoff because ACP lacks Goose's system-prompt extension.

### Strong inferences

- BERD chose bridge-vendors-full-CLI to make the desktop app reproducible and avoid depending on each user's global Node/npm/package-manager state. The absolute shim and private prefix implementation support this design.
- A bridge is the right compatibility seam for Eido when a harness exposes a CLI but not a stable library/API: Eido can install and invoke the bridge uniformly while retaining the harness's own runtime/auth semantics.
- Startup reconcile plus a completion event is a product-level consistency mechanism, not just a downloader. Without the event, readiness UI would lag reality; without atomic promotion, a bad network update could destroy a working provider.
- Treating auth as a capability matrix (probeable vs unprobeable) is safer than assuming every CLI's `login` command has a reliable status probe.

### Unknowns not answered by this checkout

- The exact internal OAuth/token/keychain locations and refresh behavior for Claude Code or Codex are not owned by BERD's public source. The app delegates provider-specific auth to the registered Doctor/harness command.
- The implementation of `doctor::run_checks_with_options` and its static `AI_AGENT_CHECKS` comes from the pinned `block/builderbot` git dependency, not this checkout. We can see BERD's authorization boundary and consumption of its readout, but not every underlying provider probe/install recipe without separately auditing that dependency.
- The external bridge packages' complete runtime behavior (subprocess topology, child environment, model flags, and error translation) is in their npm packages; this repository proves how BERD installs/routes them, not every bridge-internal detail.
- No evidence here says BERD imports or migrates a user's existing global Claude/Codex installation. The code path is consistent with an app-owned bridge, but whether a harness internally reuses a global credential/config is provider-specific and should not be assumed.

## 9. Lessons for Eido's CLI provider layer

### Highest-value patterns to copy

1. **Model the route as `{ harnessId, modelProviderId?, modelId? }`.** Keep “which process/protocol owns the conversation?” separate from “which model/provider does that process use?”. This prevents a Claude/Codex harness from being accidentally treated as a Goose/OpenAI-compatible model provider.
2. **Own an explicit provider adapter catalog.** Give each adapter canonical ID, aliases, binary/bridge names, setup method, auth capability, readiness rule, and whether Eido manages its lifecycle. Avoid discovering arbitrary PATH names and then inferring support.
3. **Install app-owned bridges into an app-owned runtime/prefix.** A managed Node/runtime plus private package root avoids host version-manager, npm-global, and shell-profile drift. Use absolute shims so a bridge cannot silently switch interpreters after PATH changes.
4. **Make install an atomic, verifiable transaction.** Stage; install from a reviewed lock graph; verify exact dependencies, target-native executable, entrypoint, and version; promote only after all checks pass; keep the old version on failure.
5. **Make the backend the setup/auth authority.** The UI should submit a narrow action/slot, the backend should re-probe current state and resolve the exact command. Never accept a renderer-provided shell/login string as the authority.
6. **Separate installed, runnable, and authenticated.** A path hit is not enough. Readiness should account for bridge presence, native executable, auth status, and provider-specific probe limitations.
7. **Reconcile in the background but notify the UI.** Startup installs can complete after the first status query; emit a completion event and rerun the authoritative probe so the UI converges without restart.

### Eido-specific design cautions

- If Eido supports both “use my existing global CLI” and “managed app bridge”, make the source explicit in the status model. Do not allow a managed shim and a user PATH binary to race silently.
- Keep credential ownership out of Eido unless there is a deliberate product/security decision. Delegate provider sign-in to the harness and expose only sanitized status/errors.
- Preserve harness identity in session history and diagnostics. Provider aliases should canonicalize at the boundary, not erase the fact that a chat ran through Claude Code versus Codex.
- Use shell capture only as an interoperability fallback. Managed installs should not depend on shell startup files; shell capture is still valuable for user-owned tools and Finder-launched desktop processes.
- Treat lockfile refresh as a security operation with an owner and cadence. BERD's lock comments explicitly acknowledge that transitive security updates arrive only when the lock is regenerated. [acp-tools.lock.json#L1-L3](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/acp-tools.lock.json#L1-L3)

### Suggested Eido acceptance checks

```text
install provider
  -> provider is in catalog
  -> backend re-probes offered fix
  -> managed runtime/prefix selected
  -> package graph + native executable verified
  -> atomic shim/state commit
  -> fresh provider probe
  -> status = installed/runnable/authenticated (or exact next action)

start chat
  -> resolve canonical harness/model target
  -> create ACP/CLI session with explicit harness identity
  -> apply harness-specific system-context strategy
  -> serialize session mutations
  -> record route + binary/version/source for diagnostics
```

The main BERD lesson is not “bundle every CLI.” It is **make provider routing a first-class, backend-owned contract with explicit lifecycle, environment, authentication, and failure semantics**. BERD's managed bridges are one concrete implementation of that contract; Eido can reuse the seam while retaining a user-owned CLI option where that is product-required.
