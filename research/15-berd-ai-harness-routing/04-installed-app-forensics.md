# BERD 0.6.2 installed-app forensics

Date: 2026-08-22

Scope: read-only inspection of `/Applications/Berd.app` on Apple Silicon; no GUI launch, no app-data inspection, no network calls to providers, and no mutation of user state.

Source comparison ref: [`874e078c931c14386a7d2e16cfe3b32cdbe295e0`](https://github.com/block/berd/tree/874e078c931c14386a7d2e16cfe3b32cdbe295e0)

## Executive finding

Berd’s release bundle is a signed desktop shell plus one long-lived Goose broker. It does not contain Claude Code, Codex, Copilot, or Amp executables as app-bundle files. Instead, the app installs selected ACP bridge packages into private app data, creates absolute-path shims, prepends those shims to the Goose child’s environment, and lets Goose’s ACP provider layer launch the selected harness.

```text
CLI / UI request
       |
       |  durable target: harnessId + modelProviderId? + modelId?
       v
  Berd app-control / renderer
       |
       |  local authenticated ACP WebSocket
       v
  one long-lived `goosed serve`
       |
       |-- harness `goose` ------------------> Goose model provider
       |                                         (OpenAI, Anthropic, etc.)
       |
       |-- harness `claude-acp` --> app-data shim --> Claude ACP bridge
       |                                      --> vendored Claude Code CLI
       |
       `-- harness `codex-acp` ----> app-data shim --> Codex ACP bridge
                                              --> vendored Codex CLI
```

The important separation is:

| Concern | Berd’s location | What the installed bundle proves |
| --- | --- | --- |
| Desktop shell | `Contents/MacOS/Berd` | Native Tauri/macOS app, signed and notarized |
| Goose broker | `Contents/MacOS/goosed` | Goose 1.46.0, ACP HTTP/WebSocket server, provider implementations compiled in |
| App control | `Contents/MacOS/berdctl` | JSON CLI that drives the running app; it is not the harness runner |
| ACP bridge installation | app data, not `Berd.app` | No Claude/Codex bridge files are shipped in the bundle; source installs them privately at runtime |
| Goose model-provider policy | `Contents/Resources/runtime-config.json` and/or runtime config source | Installed file has an empty provider list; this is separate from ACP harness availability |
| App defaults | `Contents/Resources/distro` | Bundled agents, skills, and an empty Goose config; no customer/provider credentials |

## Evidence boundary and reproducibility

All commands below are read-only. The only executable invocations were `--help`/`--version` on the bundled CLI backends, with `HOME`, XDG config/data paths set to `/nonexistent`; the desktop GUI was never launched. No command was run against `berdctl` that would require a running app or read app data.

```sh
APP=/Applications/Berd.app
SRC=research/repos/berd
REF=874e078c931c14386a7d2e16cfe3b32cdbe295e0

find "$APP/Contents" -type f | wc -l
# 39
du -sh "$APP/Contents"
# 334M

for f in "$APP"/Contents/MacOS/*; do
  file "$f"
  stat -f 'size=%z mode=%Sp %N' "$f"
done
```

Observed executable inventory:

| File | Mach-O / size | SHA-256 |
| --- | --- | --- |
| `Contents/MacOS/Berd` | arm64 / 78,601,920 bytes | `a58d783bf492934209610f17bad520215a3e298345ad708687227add20bcacf8` |
| `Contents/MacOS/goosed` | arm64 / 265,391,808 bytes | `bc7d9cc7f45925fca13d102d1a7ad8a1b74a6f7fd7e32b70b724ae3837b81855` |
| `Contents/MacOS/berdctl` | arm64 / 3,558,080 bytes | `a99f871218750fd80cc73f6ceb65a473afed8e8d7f0544e3fce45e60c0` |
| `Contents/MacOS/catch` | arm64 / 1,581,584 bytes | `1744d46370e352ba141a040c710d3ba9b650df2b9adb4cee2522d0504bce38a8` |

The bundle contains no file path matching `claude`, `codex`, `copilot`, `amp`, `acp`, `node`, or `npm` under `Berd.app`; the following check returned no matches:

```sh
find /Applications/Berd.app -type f \
  | rg -i 'claude|codex|copilot|amp|acp|node|npm'
```

## Bundle identity, signing, and entitlements

`Info.plist` reports:

```text
CFBundleIdentifier       xyz.block.berd
CFBundleShortVersionString 0.6.2
CFBundleVersion          0.6.2
CFBundleExecutable       Berd
CFBundleURLSchemes       berd
LSMinimumSystemVersion   10.13
```

The bundle is accepted by Gatekeeper as a stapled notarized Developer ID app:

```sh
codesign --verify --deep --strict --verbose=2 /Applications/Berd.app
# /Applications/Berd.app: valid on disk
# /Applications/Berd.app: satisfies its Designated Requirement

spctl --assess --type execute --verbose=4 /Applications/Berd.app
# /Applications/Berd.app: accepted
# source=Notarized Developer ID
```

The outer app is signed by `Developer ID Application: Block, Inc. (EYF346PHUG)`, uses hardened runtime, and has a stapled notarization ticket. Each nested executable is independently signed by the same team. The source build declares the same hardened-runtime and external-binary contract in [`src-tauri/tauri.conf.json`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/tauri.conf.json#L65-L95) and the same entitlements in [`src-tauri/entitlements.plist`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/entitlements.plist#L5-L20).

Observed entitlements on `Berd`, `goosed`, `berdctl`, and `catch` include:

```text
com.apple.security.cs.allow-dyld-environment-variables = true
com.apple.security.cs.allow-jit                    = true
com.apple.security.cs.allow-unsigned-executable-memory = true
com.apple.security.device.audio-input              = true
com.apple.security.files.downloads.read-write      = true
com.apple.security.files.user-selected.read-write   = true
com.apple.security.network.client                  = true
com.apple.security.network.server                  = true
```

This is a useful Eido release lesson: the app is hardened and notarized, but the runtime deliberately permits dynamic child-process/environment behavior because the shell must run managed runtimes, ACP shims, and a local authenticated server. That capability boundary deserves explicit audit and least-privilege review.

Dynamic-library inspection found only macOS system libraries/frameworks for the four binaries. In particular, the bundle does not contain a vendored `libnode`, Node framework, or provider-specific dynamic library. `goosed` links to system AppKit/CoreGraphics/Metal/Foundation/Accelerate/SystemConfiguration/Security/IOKit/CoreFoundation/libc++/libSystem libraries.

## What is actually packaged

The source build maps the whole `distro` directory and `runtime-config.json` into Tauri resources, and declares only `goosed`, `berdctl`, and `catch` as external binaries: [`tauri.conf.json`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/tauri.conf.json#L75-L86).

The installed resource tree is:

```text
Contents/Resources/
├── runtime-config.json
├── release-channels.json
├── distro/
│   ├── README.md
│   ├── config.yaml                 # 0 bytes
│   ├── agents/                     # 7 bundled persona files
│   └── skills/                     # Berd help, agent-builder, skill-builder
└── berd-sounds-0.mp3 ... berd-sounds-6.mp3
```

`runtime-config.json` is byte-identical to the source file at the requested ref:

```json
{
  "schemaVersion": 1,
  "goose": {
    "modelProviders": []
  },
  "featureToggles": {}
}
```

The source explicitly stages this file as the runtime-config resource: [`src-tauri/resources/runtime-config.json`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/resources/runtime-config.json#L1-L7). In a non-admin-runtime-config build, the Rust loader treats the bundled file as the source of truth; an empty `modelProviders` list is valid and means no runtime-managed Goose model provider is declared: [`runtime_config.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/runtime_config.rs#L366-L420), [`runtime_config.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/commands/runtime_config.rs#L756-L872).

That does **not** mean Claude Code or Codex support is absent. Those are ACP harnesses, not entries in this Goose model-provider list. The installed `goosed` binary contains provider symbols for `ClaudeAcpProvider`, `CodexAcpProvider`, `ClaudeCodeProvider`, `CodexProvider`, `CopilotAcpProvider`, `AmpAcpProvider`, `PiAcpProvider`, and `CursorAgentProvider`; this was observed with read-only `nm -gU` inspection. This is binary evidence of compiled support, not a claim that each provider is installed or authenticated on this machine.

The bundled `distro/config.yaml` is empty. The source distro contract says the optional config is appended to Goose’s `GOOSE_ADDITIONAL_CONFIG_FILES`, while `distro/bin` (if present) is prepended to `PATH`: [`distro/README.md`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/distro/README.md#L5-L20), [`distro/README.md`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/distro/README.md#L54-L68). The installed empty file therefore contributes no Goose provider settings.

`release-channels.json` is generated updater configuration, not AI routing. It points at the public GitHub rolling-release endpoint and contains a public updater verification key. No provider credential or user data was extracted.

## Installation architecture for Claude Code and Codex

The strongest source evidence is the managed ACP installer. Berd deliberately keeps two install families separate:

1. A private npm prefix for doctor-driven installs such as Copilot and Amp.
2. A pinned managed bridge tree for Claude and Codex.

The module-level design documents this separation and says both bridge packages vendor their full harness CLI, so the user does not need a separate main-CLI install: [`managed_acp_tools.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1-L35).

```text
<app-data>/packages/
├── node/<version>/<platform>/       # pinned Node 24.11.0 runtime
├── npm-prefix/                      # private npm global prefix (Copilot/Amp fixes)
├── tools/
│   ├── claude-acp/                  # npm --prefix install tree
│   └── codex-acp/
├── bin/
│   ├── claude-agent-acp             # absolute-path POSIX shim
│   └── codex-acp                    # absolute-path POSIX shim
└── state.json                       # installed pins + last reconcile result
```

The source makes these paths explicit: `<app-data>/packages/tools/<id>` is each bridge’s install prefix, `<app-data>/packages/bin` holds shims, and managed prepending includes bridge shims, private-prefix bins, and the managed Node bin directory: [`managed_acp_tools.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L69-L112), [`managed_acp_tools.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L168-L201).

The managed set is deliberately small and stable:

| Frontend harness id | Shim / binary name | npm package | pinned version |
| --- | --- | --- | --- |
| `claude-acp` | `claude-agent-acp` | `@agentclientprotocol/claude-agent-acp` | `0.66.0` |
| `codex-acp` | `codex-acp` | `@agentclientprotocol/codex-acp` | `1.2.0` |

This table is in [`managed_acp_tools.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L256-L321). The release-controlled lock also maps the current target (`aarch64-apple-darwin`) to the expected native executable inside each npm package: [`acp-tools.lock.json`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/acp-tools.lock.json#L4-L35), [`acp-tools.lock.json`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/acp-tools.lock.json#L1320-L1364).

The install transaction is more disciplined than a plain `npm install`:

```text
startup reconciler
      |
      v
ensure pinned Node runtime (SHA-256 checked)
      |
      v
seed staged package.json + package-lock.json from repo lock
      |
      v
npm ci --prefix ... --omit=dev --include=optional --ignore-scripts
      |                 --os darwin --cpu arm64 [--registry ...]
      v
verify replayed dependency graph: exact versions + SRI integrities
      |
verify target native executable exists
      |
write absolute-path shim + state.json
      |
atomic commit; retain old working bridge on failure
```

The implementation serializes installs, uses a staged tree, verifies the replayed lock graph and target-native executable before promotion, and records the installed pin in `state.json`: [`managed_acp_tools.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L459-L607), [`managed_acp_tools.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1102-L1201). The exact npm arguments and target selectors are defined in [`managed_acp_tools.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/managed_acp_tools.rs#L1234-L1395).

At startup the reconciler runs in the background for every managed bridge. A partial failure is recorded and retried next launch while a previous working bridge remains in place: [`acp_tools_reconciler.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp_tools_reconciler.rs#L1-L84). App setup starts this reconciler after registering runtime/distro state: [`src-tauri/src/lib.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/lib.rs#L184-L207), [`src-tauri/src/lib.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/lib.rs#L313-L375).

## Runtime routing and process topology

The app starts one long-lived `goose serve` child. The source describes it as a singleton accepting WebSocket connections, with each `/acp` connection creating an independent ACP agent: [`goose_serve.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L47-L64).

Observed `goosed --version` output:

```text
1.46.0
```

Observed `goosed serve --help` output confirms the release binary exposes an ACP HTTP/WebSocket server with `--host`, `--port`, `--allowed-origin`, `--enable-scheduler`, and an authentication mode controlled by `GOOSE_SERVER__SECRET_KEY`. `goosed acp --help` exposes the stdio ACP server mode. These were help-only invocations; no server was started.

The Berd shell selects the bundled sidecar unless `GOOSE_BIN` overrides it: [`goose_serve.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L918-L985). On startup it:

1. reserves a free loopback port and creates a per-process secret;
2. restores the login-shell environment;
3. prepends distro tools, managed ACP shims, private npm-prefix bins, and managed Node;
4. writes `GOOSE_SEARCH_PATHS` as an ordered JSON array;
5. appends distro config via `GOOSE_ADDITIONAL_CONFIG_FILES`;
6. exports runtime-config endpoint variables and optional `GOOSE_FAST_MODEL`;
7. runs `goosed serve --enable-scheduler --host 127.0.0.1 --port <port>` with the secret;
8. waits for the loopback port and records a guarded process record for orphan cleanup.

The environment assembly and command arguments are visible in [`goose_serve.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L147-L245), [`goose_serve.rs`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src-tauri/src/services/acp/goose_serve.rs#L1022-L1157). The resulting target order is effectively:

```text
PATH / GOOSE_SEARCH_PATHS precedence
  1. bundled distro/bin (if present)
  2. Berd-managed ACP shims: packages/bin
  3. private npm prefix bin
  4. managed Node bin
  5. restored user shell PATH
```

This is a key routing seam: Goose resolves `claude-agent-acp` or `codex-acp` as a bare command, but the app controls which physical executable wins. No host-global Node or user-global bridge is required for the managed providers.

## How the CLI expresses a route

The installed `berdctl --help` output says it controls the running desktop app, returns JSON, and can create a background session with `--harness-id claude-acp`. The source command contract makes the model/harness distinction explicit:

```text
berdctl session create --prompt "..." --harness-id claude-acp
berdctl session create --prompt "..." --harness-id codex-acp --model-id <id>
```

`createSession.ts` accepts `harness_id`, `model_id`, `agent_id`, and `project_id`; defaults the harness to Goose; checks readiness; and, for Goose, resolves a matching model to its concrete model-provider id. For external harnesses, the harness id itself is the model-provider id unless inventory says otherwise: [`createSession.ts`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/berdctl/commands/impl/createSession.ts#L8-L45), [`createSession.ts`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/berdctl/commands/impl/createSession.ts#L113-L155).

The frontend discovers installed ACP providers from Goose, canonicalizes them against the provider catalog, and sends prompts through the prepared ACP session. Goose-managed providers receive a real Goose system-prompt extension; external agents such as Claude Code and Codex receive an in-band persona handoff because ACP has no system-prompt channel for them: [`src/shared/api/acp.ts`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L90-L116), [`src/shared/api/acp.ts`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acp.ts#L172-L221), [`acpPersonaHandoff.ts`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/shared/api/acpPersonaHandoff.ts#L1-L15).

For a session, Berd retains a canonical execution target rather than treating provider choice as transient UI state. The source’s target resolver maps model providers to the Goose harness, maps external provider ids to their own harness, and preserves `modelProviderId`/`modelId`: [`personaExecutionTarget.ts`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/agents/lib/personaExecutionTarget.ts#L50-L98), [`personaExecutionTarget.ts`](https://github.com/block/berd/blob/874e078c931c14386a7d2e16cfe3b32cdbe295e0/src/features/agents/lib/personaExecutionTarget.ts#L104-L160).

## What the installed binary strings add

Static strings are not a substitute for source, but they confirm the packaged release’s shape without launching it:

```sh
for f in /Applications/Berd.app/Contents/MacOS/*; do
  echo "--- $(basename "$f")"
  strings -a "$f" | rg -i \
    'claude-agent-acp|codex-acp|copilot-acp|amp-acp|cursor-cli|GOOSE_SEARCH_PATHS|GOOSE_FAST_MODEL|GOOSE_DISTRO_DIR|BERDCTL_BIN|BERDCTL_LOCK|--allowed-origin' \
    | sort -fu | sed -n '1,160p'
done
```

Observed markers include:

- `Berd`: `@agentclientprotocol/claude-agent-acp`, `@agentclientprotocol/codex-acp`, `amp-acp`, `packages/tools`, `packages/bin`, `npm-prefix`, `state.json`, `claude-agent-acp`, `codex-acp`, and `GOOSE_DISTRO_DIR`.
- `goosed`: `claude-acp`, `codex-acp`, `copilot-acp`, `amp-acp`, `pi-acp`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `https://api.anthropic.com`, `https://api.openai.com`, and ACP server route strings.
- `berdctl`: `claude-acp` and `codex-acp` in the public session-create help contract.

The `goosed` symbol table independently exposes provider families, including `goose::providers::claude_code::ClaudeCodeProvider`, `goose::providers::codex::CodexProvider`, `goose::providers::claude_acp::ClaudeAcpProvider`, `goose::providers::codex_acp::CodexAcpProvider`, and `goose::providers::copilot_acp::CopilotAcpProvider`.

## Source/package mismatch: do not treat 0.6.2 as an exact commit build

The installed bundle’s executable/resource mtimes are `2026-08-19 02:50:06 +1000`. The requested source ref’s commit metadata is `2026-08-21T20:36:21-04:00` (the target commit is the AirPods voice change). Filesystem mtimes can be normalized, but content comparison confirms this app was not built byte-for-byte from that exact ref.

```sh
for f in \
  src-tauri/resources/runtime-config.json \
  distro/config.yaml distro/README.md \
  distro/agents/berdy.md distro/agents/wildcard.md \
  distro/agents/agt-builder.md distro/agents/copycat.md \
  distro/agents/pushback.md distro/agents/choosey.md distro/agents/tinker.md \
  distro/skills/berd-help/SKILL.md distro/skills/skill-builder/SKILL.md \
  distro/skills/agent-builder/SKILL.md; do
  case "$f" in
    src-tauri/resources/runtime-config.json) installed="$APP/Contents/Resources/runtime-config.json" ;;
    *) installed="$APP/Contents/Resources/$f" ;;
  esac
  source_hash="$(git -C "$SRC" show "$REF:$f" | shasum -a 256 | awk '{print $1}')"
  installed_hash="$(shasum -a 256 "$installed" | awk '{print $1}')"
  printf '%s source=%s installed=%s\n' "$f" "$source_hash" "$installed_hash"
done
```

Observed comparisons:

| Resource | Comparison result |
| --- | --- |
| `runtime-config.json` | Exact hash match: `e5ef7d6324e2a74e31894c6b244379bea6c38c2011abd49de21a47aff69aea97` |
| `distro/config.yaml` | Exact hash match; both are empty |
| `distro/README.md` | Exact hash match |
| `distro/skills/berd-help/**` | Exact hashes for inspected files |
| `distro/skills/skill-builder/SKILL.md` | Exact hash match |
| `distro/skills/agent-builder/SKILL.md` | Different; installed copy has older wording/contract |
| all seven inspected `distro/agents/*.md` | Different; installed copy has older/newer metadata/avatar/body variations |

For example, the installed `berdy.md` adds `good_for`/`vibes` frontmatter absent at the target ref, while installed `agt-builder.md` has a different avatar and body. Therefore:

- the package confirms the release architecture and its runtime split;
- the package is strong evidence for what a user on this machine actually received;
- source code at the requested ref is the authority for the intended installer/routing implementation;
- exact binary behavior should not be attributed to commit `874e078...` without a release provenance record or matching build hash.

## Recommendations for Eido’s CLI provider layer

These are design lessons, not claims that Eido must copy Berd’s implementation verbatim.

1. **Separate harness identity from model-provider identity.** Persist a target like `{ harnessId, modelProviderId?, modelId? }`. Goose can be the harness with a concrete provider underneath; Claude Code and Codex can be harness ids with their own model inventories. Do not collapse all three concepts into one “provider” string.

2. **Keep install state out of the app bundle.** Ship only the orchestrator and immutable metadata in the release. Install external harnesses into an Eido-private app-data root, with a `state.json`/readiness record. This avoids requiring host-global Node/npm and prevents user PATH drift from silently selecting a different CLI.

3. **Use a lock-driven, transactional installer.** Pin package versions, dependency integrities, target-native executable paths, and runtime versions. Stage, install, verify the replayed graph and native executable, then atomically promote. On offline or tampered-registry failure, keep the previous working bridge.

4. **Make PATH precedence explicit.** Build the child environment in a deliberate order: Eido-managed harness shims first, Eido-managed runtime next, then a sanitized/restored user PATH. Consider a separate structured search-path variable so the broker and its children agree on the same resolution order.

5. **Centralize execution in one broker process.** A long-lived local broker gives Eido one lifecycle, one auth boundary, one log stream, and one place to multiplex sessions. Use loopback-only binding, a per-process secret, an origin check, readiness polling, and guarded orphan cleanup.

6. **Treat readiness as a state machine.** Separate `not_installed`, `installed/not_authenticated`, `ready`, and `failed` with bounded diagnostics. Allow Claude and Codex setup to progress independently; do not block a ready harness because another bridge failed.

7. **Handle prompt adaptation at the harness boundary.** External ACP harnesses may not support Goose’s system-prompt extension. Preserve persona/context semantics by an explicit first-turn handoff keyed by session, harness, persona, and prompt fingerprint, and make this behavior visible in tests.

8. **Do not put credentials in bundled runtime config.** Berd’s empty public runtime config and source validation boundary are a good pattern. Runtime config can describe provider ids, endpoint env names, models, and fast-model policy; credentials should come from secure per-user setup/auth state.

9. **Publish release provenance.** Record the source commit, backend commit, managed Node version, bridge package pins, and bundle hashes in release metadata. The installed-app/source mismatch found here is exactly the kind of ambiguity a provenance manifest would remove.

## Limits

- No GUI or `goosed serve` process was started.
- No `berdctl` command that would connect to the running app was executed.
- No app-data directory, keychain, provider token, session, or user profile was inspected.
- Static symbols/strings prove compiled names and code presence, not provider authentication or a successful live chat.
- The exact release source commit for the installed app remains unknown; the requested ref is a source comparison point, not a proven build provenance match.
