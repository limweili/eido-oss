# Integrations

Boards, Profile exports, and local CLI and MCP access work offline. OpenRouter
and Linkup handle online AI and web tools. Website previews fetch their pages
and assets, and coding CLIs can use their own provider connections when you run
them. Download and install a new release when you want to update Eido.

## OpenRouter

| Aspect | Current behavior | Evidence |
| --- | --- | --- |
| Endpoint | `https://openrouter.ai/api/v1/chat/completions` | `src/brain/openRouter.ts` `ENDPOINT`. |
| Auth | Bearer token hydrated into the in-memory graph settings from the device credential seam | `openRouter.ts`; `src/graph/store.ts`; `SettingsModal.tsx`. |
| Key storage | Electron main atomically writes a versioned local file at `userData/credentials/openrouter-api-key.v2.json` holding a version and OS-protected ciphertext, never the key; POSIX uses a `0700` directory and `0600` file. A readable `*.v1.json` from an older build is migrated on first read and removed only after the protected file is committed and reopened (#1359). The OS protected store is approached only once a credential file has been found, so an install holding no key still reaches it zero times (#774). A store that will not open answers `locked`, never `absent`, and never destroys what it cannot read. Unpackaged disposable Profile review alone reads the canonical installed-device credential through a read-only facade while keeping its Profile and `userData` scratch-owned. Browser development is session-only | `electron/localCredentialStore.ts`; `electron/profileCredentialInstallation.ts`; `electron/keychainBridgeContract.ts`; `src/graph/apiCredential.ts`. |
| Request | Streaming chat completion with system + user messages | `openRouter.ts`. |
| Reasoning | Sends `reasoning: { effort: settings.reasoningEffort }` | `openRouter.ts`; `SettingsModal.tsx`; `store.ts`. |
| Models | User-curated OpenRouter slugs; default shortlist in code | `src/brain/models.ts`; `SettingsModal.tsx`; `AskAiCard.tsx`. |
| Assets | Images sent as `image_url`; PDFs/files sent as `file` content with file-parser plugin | `openRouter.ts`; `src/shared/clipboardAssets.ts`; `compiler.ts`. |
| Attribution headers | Sends `HTTP-Referer: http://localhost` and `X-Title: Eido` | `openRouter.ts`. |

The key stays device-local, outside the logical Profile, Boards, snapshots, gateway output, and Portable Export. Its protection boundary is OS-protected ciphertext, the signed-in OS account, and local file permissions. A locked protected store leaves the credential unavailable without removing its ciphertext. Packaged startup migrates a legacy `eido-v3-settings.apiKey` only when the new local file is empty, then removes the renderer field. A valid bridge whose storage is unavailable leaves that legacy value for retry and starts the Profile with AI credentials unavailable; it never turns a credential fault into a Board/Profile failure. If the file is removed, malformed, moved to another account, or has unsafe permissions, the user must re-enter the OpenRouter key.

Removing the legacy renderer field is a logical scrub; Chromium can retain old values in LevelDB journals, so migration makes no secure-erasure claim for historical browser files. The packaged proof injects its synthetic legacy value through an in-memory storage adapter, still exercises native credential migration, and scans its complete disposable root for readable key bytes. On macOS, GUI proof launchers pass Chromium's `--use-mock-keychain` before Electron starts, because a disposable Profile directory does not isolate the login Keychain. Proof credentials use a fixed test key; this validates framing, migration, and plaintext absence without accessing the real Keychain, and does not certify the real OS protection boundary. The unpackaged updater UI proof uses `--eido-profile-synthetic-proof` with scratch credentials; only an explicit user review can borrow installed-device credentials.

Development Profile review does not copy that credential into its disposable
root and cannot set, clear, or migrate the installed file. Its renderer exposes
one fixed model, `openai/gpt-5.6-luna`, across every execution shape and rejects
a different model again at the OpenRouter boundary. Ordinary and packaged-proof
launches retain their existing key and model behavior.

## Retired Eido services

Eido has no account/authentication service, AI control plane, managed provider
credential, billing integration, operator console, commercial feature flag, or
product analytics integration. Provider requests use the person's own access.
See [ADR 0051](../adr/0051-free-open-source-byok-only.md). Deleting source does
not decommission deployed resources; the
[handover](../agents/open-source-handover.md) owns that external boundary.

## Link previews

Pasting a public URL can attach a preview to a Note. The request goes directly
from Eido to the public page and the hosts of its preview image and favicon.
This path needs no API key and retrieves metadata for the preview. AI runs use
separate search and page retrieval tools.

| Boundary | Current behavior | Evidence |
| --- | --- | --- |
| Installed app | The renderer loads the preview through a bounded Electron bridge. The service checks public destinations and redirects before requesting metadata or preview assets. | `src/shared/loadLinkPreview.ts`; `electron/installedLinkPreviewMainSession.ts`; `electron/linkPreviewService.ts`. |
| Browser development | The same preview service runs behind Vite's local `/api/eido/link-preview` endpoint. | `scripts/vite/linkPreviewPlugin.ts`. |
| Result | A successful preview can show the title, description, image, and favicon. An unavailable preview leaves the link usable. | `src/shared/linkPreview.ts`; `src/shared/loadLinkPreview.ts`; `src/graph/store.ts`. |

## Agentic Runs

An Agentic Run is an ordinary Run in which the model may call tools. The globe
on the Ask AI card asks for it, cycling Off, Web mode, Research mode, off by
default. Who runs the tool loop is decided by the key (ADR 0036): with a Linkup
key on OpenRouter, Eido runs it; without one, the provider does; a local
harness owns its own either way.

| Aspect | Current behavior | Evidence |
| --- | --- | --- |
| With a Linkup key, on OpenRouter | Eido runs the tool loop inside the completion boundary. The request declares `search_web`, `fetch_page`, and, in Research mode, `research` as ordinary function tools whose parameters the model fills per call; a travelling brief in the system prompt carries the vendor's selection rules. When the model emits a tool call, Eido executes it through the Linkup boundary, appends the result as a `role: "tool"` message, and re-requests, streaming throughout | `eidoWebToolSetFor` and `WEB_TOOL_BRIEF` in `src/brain/webTools.ts`; the loop in `src/brain/openRouter.ts`. |
| Without a Linkup key, on OpenRouter | The request declares two OpenRouter Server Tools, `openrouter:web_search` and `openrouter:web_fetch`, which OpenRouter executes server-side inside the same completion. This is the shipped fallback, exercised by every keyless user, which is what keeps it trustworthy | `SERVER_TOOLS` in `src/brain/openRouter.ts`; ADR 0033. |
| On a local harness | Nothing changes. The harness owns its own tools and its own loop, and the bridge carries a prompt only. The Card states this instead of offering a switch that would do nothing | `src/brain/aiProvider.ts`; `agenticReachFor` in `src/brain/agenticRun.ts`. |
| Bounds on a run | No call cap and no spend cap, on founder direction (ADR 0036): a working run is never stopped. One termination guard ends the loop after consecutive failed calls with no success between them, so a dead host cannot spin forever. Each tool result is capped before it enters the prompt, head-weighted with the cut declared to the model, and the context compile reserves prompt room for the opening stretch of lookups; both are the size of the container, not spending limits | `src/brain/webTools.ts`; `src/brain/agenticRun.ts`. |
| Cost to the user | Model tokens bill to the OpenRouter key; Eido-executed lookups bill to the Linkup key. Prices are said at the press that spends them, on the research depths, and nowhere else: Settings names each key's job and leaves the numbers alone (founder decision 2026-08-18). Only Research asks before submitting, because that spend is irreversible, not because it is large | `src/canvas/cards/AskAiCard.tsx`; ADR 0037. |
| Reading the stream | Tool calls and `url_citation` annotations are read from both the streamed delta and the finished message, deduplicated by a collector, so the boundary is correct whichever way a provider delivers them. The reader is per request, because tool-call indices restart at zero on every response of the loop | `toolActivityReader` in `src/brain/openRouter.ts`. |
| What is recorded | Each tool used, in order: a search phrase or a page address, plus a page title when the provider supplies one, and, on the Eido-executed loop, the model's own readable reasoning between lookups, bounded per step. A handoff note written when the context outgrew the model's window is recorded the same way (ADR 0038), and is the one row a plain non-agentic follow-up can carry, because a discussion compacts whatever the card is armed to do. Page text is never stored, and reasoning with no readable text records nothing. Steps live on the Run and are stripped from the intent-log clones, because there is no cap on how many a run may use | `RunToolStep` and `thinkingStepFrom` in `src/brain/agenticRun.ts`; `cloneForLog` in `src/graph/store.ts`. |
| What the user sees | A trail on the Result card: open while the run is live, folded to a count of its lookups once the answer lands. Every row is pressable across its whole line and opens to the full step: the whole question, address, or thinking passage. The trail lists Eido's own calls only; a deep search or a research job iterates on the vendor's side without reporting steps, which the trail does not claim otherwise about. The globe's tooltip names its mode and nothing more (founder decision 2026-08-18) | `src/canvas/cards/RunToolTrail.tsx`; `words.reachWebOn` and neighbours in `src/shared/words.ts`. |

## Linkup

The keyed reach behind Eido-executed tools. One file names the vendor;
everything above it speaks Eido's own types and error codes.

| Aspect | Current behavior | Evidence |
| --- | --- | --- |
| Endpoint | `https://api.linkup.so/v1`: `POST /search`, `POST /fetch`, `POST /research` plus `GET /research/{id}` for polling. Plain `fetch`, no vendor SDK, called from the renderer because the API reflects browser origins and allows the `authorization` header (probed 2026-08-18) | `LINKUP_ENDPOINT` in `src/brain/linkup.ts`; `research/10-linkup-web-intelligence/03-live-capture.md`. |
| Key storage | An optional second credential in the same account-private local file mechanism as the OpenRouter key, slot `linkup-api-key`. Absent key means the provider-executed fallback, not an error | `electron/localCredentialStore.ts`; ADR 0037. |
| Packaged browser session | `connect-src 'self' https://openrouter.ai https://api.linkup.so`. Electron also checks the path and method of each provider request. Website previews use the separately validated main-process reader. Coding CLI tools use their own processes. | `electron/protocol.ts`; `electron/main.ts`; `electron/linkPreviewService.ts`. |
| Error mapping | Every failure maps to a closed set of codes (`no-key`, `bad-key`, `out-of-credit`, `rate-limited`, `no-results`, `page-too-large`, `page-unreadable`, `unsupported-content`, `unreachable`, `canceled`, `failed`), keyed on the response body's `code`, never the status alone | `classifyRefusal` in `src/brain/linkup.ts`; `webToolFailureLabel` in `src/shared/words.ts`. |
| The two traps | Both verified live, 2026-08-18, and both contradict the published docs. One: a missing key answers 402 `X402_PAYMENT_REQUIRED` with an x402 payment challenge, while the docs say 401, so a status-keyed mapping would tell a user who has not pasted a key that payment failed. Two: 429 carries both "slow down" and "out of credit", separated only by the body | `research/10-linkup-web-intelligence/03-live-capture.md`; the trap tests in `src/brain/linkup.test.ts`. |
| Rate limits | Undocumented `x-ratelimit-*` headers are read when present and never depended on; a rate-limited tool call waits a bounded interval before the model may retry. Research polling starts at 2s, doubles to a 10s cap, and never exceeds one poll per second | `readRateLimit` and the poll constants in `src/brain/linkup.ts`. |
| Research jobs | Submit commits the charge and the job; there is no cancel API. The job id is written into `card.meta` the moment the vendor acknowledges it and removed only when a run consumed a terminal state, so a quit, crash, or cancel leaves the handle to paid work standing | `runResearch` in `src/brain/linkup.ts`; `src/brain/researchJobMeta.ts`. |
| What Eido pins | `outputType` only: `searchResults` for search (this model does the synthesis) and `sourcedAnswer` for research (the vendor's agent did work this model cannot redo). Depth, filters, fetch mode, research mode, and reasoning depth are the model's per-call choice | `src/brain/linkup.ts`; `src/brain/webTools.ts`; ADR 0036. |

## Local AI Harnesses

Eido can route the same execution stream through an installed, already-authenticated
CLI instead of a remote provider. Local harness provider and model lists belong to
the current Idea; the executable command is device-local. OpenRouter's small
Recommended Model Catalog is a separate editable device-settings list. No CLI credential or subscription token enters the Profile, Board,
bridge request, or renderer storage.

| Harness | Default command | Model selection | Access mode | Output boundary | Evidence |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `claude` | Claude Code aliases `default`, `fable`, `opus`, `sonnet`, and `haiku`, plus user-added values | Starts in the disposable run directory with `dontAsk` and no session persistence. Read-only and already allowed tools can run; anything that needs approval is denied | Main-process child using print-mode `stream-json`; partial text is forwarded to the ordinary run engine | `electron/aiHarnessMainSession.ts`; [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage) |
| Codex | `codex` | Codex model ids `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`, plus user-added values | Starts ephemerally in the disposable run directory with the `read-only` sandbox. Shell commands can inspect but cannot write or use the network; Codex web search is a separate provider tool and remains available according to the user's Codex configuration | Main-process `codex exec --json --ephemeral`; lifecycle stays visibly running and each completed agent message is forwarded, although `exec --json` does not expose token deltas. Reasoning values are sent through `model_reasoning_effort`; account/model acceptance of the lowest values is not live-proven here | `electron/aiHarnessMainSession.ts`; [Codex CLI source](https://github.com/openai/codex); [Codex CLI reference](https://developers.openai.com/codex/cli/reference); [Codex configuration reference](https://developers.openai.com/codex/config-reference) |
| Antigravity | `agy` | `gemini-3.7-flash` with `low`, `medium`, or `high`; `gemini-3.1-pro` with `low` or `high`; plus user-added values | Starts in the disposable run directory with terminal sandboxing. Workspace file tools remain available there; anything that needs approval is denied in the headless run | Main-process headless `stream-json`; only documented `event: "step_update"` records whose `step_update.step_type` is `agent_response` are streamed, then the documented terminal `result.response` is reconciled. Requires Antigravity CLI 1.1.15 or later for the stream-input envelope | `electron/aiHarnessMainSession.ts`; [Antigravity headless CLI](https://antigravity.google/docs/cli/headless); [Antigravity CLI changelog](https://antigravity.google/changelog) |

The Settings page exposes one provider picker, one device-local command field for
local harnesses, and the editable Recommended Model Catalog for OpenRouter. Local
harness provider/model edits are staged until Done, then saved with the Idea as
one change; OpenRouter catalog edits are merged into device settings and are
available to all Ideas. Opening an older Board may import a
legacy OpenRouter list only when it contains at least two unique structurally
valid slugs and the device catalog is still unset; Profile Review never performs
that migration. Local tools use the user's existing
CLI login; Eido does not automate or inspect a separate ChatGPT, Claude, or Google
web subscription. Settings names the effective access mode beside each local
command so the safety boundary is visible without requiring CLI knowledge.

The Gemini CLI provider was removed on 2026-08-20 as deprecated. An Idea saved
against it opens on Antigravity, the same vendor's current CLI, and takes
Antigravity's model list. Remaining cleanup is tracked in issue #1118.

Prompts travel over the child's stdin, never process arguments. Attachments are
staged in a per-run temporary directory and the harness starts there, so Eido's
installation/source tree is not ambient model context. Antigravity's stdin is a
single `event: "user"` stream-input envelope containing the prompt. Every
harness now receives the Idea's reasoning setting, each in its own vocabulary:
Claude Code takes `--effort` with `max`, `high`, `medium`, or `low`; Codex takes
`model_reasoning_effort`; Antigravity takes `--effort` with `low`, `medium`, or
`high`, except its Pro model has no medium rung. A stored value a harness has no
rung for is mapped to that harness's nearest real rung at the point the command
is built, so an older saved Idea cannot send a word its CLI does not know.
Settings shows each provider's own rung names rather than one shared vocabulary
(founder decision 2026-08-20). Local CLIs do not expose a common temperature
flag, so Eido preserves variation intent in the explicit variation instruction
while the harness owns sampling. Antigravity remains install-dependent on a given device;
missing commands produce the actionable unavailable result, while an installed
command whose JSONL no longer matches the bounded parser fails as an
incompatible harness result.

Harness children run in an isolated process group on POSIX and are terminated as
a process tree on Windows. Normal quit and fatal shutdown stop admission,
cancel active work, escalate resistant children, and await bounded settlement
before releasing the rest of the Electron runtime.

## Browser Storage

IndexedDB and the disk-backed Idea adapter are available only in explicit trusted browser development. Appearance and model preferences remain local browser APIs. OpenRouter credentials are session-only in browser development and account-private local files in packaged Eido; the packaged Mod library and Boards use the installed native Profile.

| Storage | Data | Evidence |
| --- | --- | --- |
| IndexedDB database `eido-v3`, version 2 | Browser-development fallback for Idea summaries, Board snapshots, active Idea metadata, legacy single-board store | `src/graph/save.ts`; `src/graph/profileRendererPersistence.ts`. |
| `localStorage` `eido-v3-settings` | Non-secret device settings: local harness commands and the editable Recommended Model Catalog. Legacy provider preferences remain only for compatibility; local harness catalogs and active Idea selections still have Board/Profile mirrors for execution/provenance. A legacy `apiKey` is read once for migration and scrubbed; credentials otherwise use the protected local seam | `src/graph/store.ts`; `src/graph/apiCredential.ts`; `src/ui/recommendedModelCatalog.ts`; `src/ui/theme.ts`. |
| `localStorage` `eido-v3-model-windows` | Per-model context windows read from OpenRouter's public catalog (#1034), plus the corrections a provider proved by refusing a request as too long (#1038). Refreshed at most once a day, only when an OpenRouter key is held, and only alongside a completion the person asked for; a correction survives a refresh until the published window for that model moves | `src/brain/modelWindows.ts`. |
| `localStorage` `eido-v3-actor-id` | Browser-development Intent actor identity only; packaged hydration supplies `intentActorId` without reading or writing this key | `src/graph/commitFunnel.ts`; ADR 0029. |
| Exported JSON file | Browser-development export of `IdeaExport` containing Idea metadata and `SavedBoard`; packaged Profiles use Portable Export | `App.tsx`; `src/graph/types.ts`; `electron/installedProfileRouter.ts`. |

## Installed Packaged Profile

| Boundary | Current behavior | Evidence |
| --- | --- | --- |
| Product path | Electron main fixes `appData/Eido/profiles/default/eido-profile.sqlite`; branding and renderer input cannot relocate it | `electron/profileInstallation.ts`; ADR 0029. |
| GUI owner | Stable `userData` plus the GUI single-instance lock precede Profile-directory creation; the primary starts one post-ready utility owner before loading mutable UI | `electron/main.ts`; `electron/installedProfileSingleInstance.ts`; `electron/installedProfileSession.ts`. |
| Native storage | One utility process owns SQLite, sidecar, blobs, recovery, Portable Export, Duplicate/current-Idea import, native Agent command batches, and bounded inspection behind one FIFO | `electron/profileUtilityHost.ts`; `electron/sqliteProfileOwnerCoordinator.ts`; `electron/installedProfileRouter.ts`. |
| Renderer bridge | One versioned allowlisted channel exposes logical hydration/ACK, projection/flush, lifecycle/recovery, status, capability, and bounded query methods to the exact owned `eido://app` frame. Its tokened Agent barrier holds renderer schedules before live mutation admission, then applies and acknowledges the exact committed revision and drains a record-aware rebase of held GUI work | `electron/profileBridgeContract.ts`; `electron/preload.ts`; `electron/security.ts`; `electron/profileRendererAgentBarrier.ts`; `src/desktop/profileAgentMutationBarrier.ts`; `src/graph/profileRendererPersistence.ts`. |
| Credential bridge | One separate versioned allowlisted channel exposes only get/set/clear and migrate-if-empty to the same exact owned frame; errors never reflect keys, paths, or storage details, and carry one of two codes, `unavailable` or `locked`. Missing or malformed bridge shape remains a packaged-shell integrity failure, while an unavailable valid store disables AI credentials without blocking Profile hydration. `locked` is reported separately from an empty key so the app can say a saved key exists and could not be opened, rather than that none was set (#1359, #1360) | `electron/keychainBridgeContract.ts`; `electron/installedKeychainMainSession.ts`; `electron/localCredentialStore.ts`; `src/graph/apiCredential.ts`; `electron/security.ts`. |
| Credential bridge | One separate versioned allowlisted channel exposes only get/set/clear and migrate-if-empty to the same exact owned frame; errors never reflect keys, paths, or storage details. Missing or malformed bridge shape remains a packaged-shell integrity failure, while an unavailable valid store disables AI credentials without blocking Profile hydration | `electron/keychainBridgeContract.ts`; `electron/installedKeychainMainSession.ts`; `electron/localCredentialStore.ts`; `src/graph/apiCredential.ts`; `electron/security.ts`. |
| Existing-only Gateway | One transport-neutral session projects installed descriptors without opening Profile authority. Its first valid headless invocation single-flights and retains one fixed-path, no-seed lease; close stops admission and drains accepted work before release. Private utility initialization binds trusted `cli` or `mcp` transport once, outside request JSON | `src/persistence/profileAgentGateway.ts`; `electron/installedProfileHeadlessLease.ts`; ADR 0029. Headless CLI fallback and MCP share the validated command route without adding a path resolver, provider, raw SQL/patch escape, or second authority; MCP projects only the exact seven compatibility tools. |
| Standalone `eido` and live Gateway | The packaged SEA embeds the Node.js runtime that built it. It selects transport: it uses the app-owned Unix socket/named pipe when a tokened, same-user handshake reaches the active owner, and falls back to the existing-only headless lease only after pre-admission endpoint absence. A structurally unrepresentable macOS socket path is such absence; the headless owner still arbitrates GUI contention. Ergonomic JSON adds versioned `cli.servedBy` and `cli.live` evidence. Raw `batch` forwards headless input bytes verbatim and preserves the Gateway envelope, diagnostic, and exit while absorbing Electron's Windows-only stdout CRLF. A colocated native helper owns peer checks, five-second frame-read deadlines, endpoint cleanup, and the one safe pre-ready orphan retry | `electron/eidoCliStandalone.ts`; `electron/profileLiveGatewayClient.ts`; `electron/profileLiveGatewayServer.ts`; `native/profile-live-gateway/`; `scripts/electron/profile-mcp-sea-after-pack.mjs`; ADR 0031. Live Agent mutations acquire the renderer hold before main's authority FIFO; ambiguous post-dispatch failure never falls back or cancels onto an old base. |
| Delegated Agent Runs | `run.submit`, `run.status`, and `run.read` are CLI-only and require the active packaged app. Main correlates a bounded Ask/Conversation request with the exact owned renderer; the renderer admits only OpenRouter-backed Conversations and non-Agentic Ask chains, then reserves app/session budgets for one run or 1–8 variations, including Group refresh, Conversation-turn, and context-compaction calls; the brain executor revalidates and applies exactly that admitted schedule through the ordinary runners; then the app retains status plus bounded Run/output-version references for later processes. Device-local harness commands and Agentic loops without a call ceiling fail closed because they cannot satisfy exact pre-admission accounting. Provider keys, caller-selected model/prompt/style/turn controls, and model output stay inside the renderer/engine. Definite app absence never launches headless AI; possible post-admission submit loss is nonretryable `submit-outcome-unknown`. Joined quit closes the broker/live route, stops new renderer admission, best-effort cancels the active execution kind, drains all accepted jobs and their flushes, then takes the final renderer checkpoint before native shutdown | `src/brain/agentRunContract.ts`; `src/brain/agentRunSession.ts`; `src/brain/agentRunExecutor.ts`; `src/desktop/profileAgentRunRendererService.ts`; `src/desktop/profileAgentRunRendererRuntime.ts`; `electron/profileAgentRunRendererBroker.ts`; `electron/profileAgentRunLiveService.ts`; `src/graph/profileRendererPersistence.ts`; `src/persistence/profileAgentRunGateway.ts`. |
| Packaged JSON CLI | Exact `--eido-profile-json` mode synchronously validates and pins only the fixed product/proof root, lets bounded stdin admission and Electron readiness complete in either order, then consumes one `cli` session for a single operation, joins close, and writes one JSON line. Windows pulls inherited fd0 without read-ahead and Electron precedes the response with exactly one native CRLF; macOS does not | `electron/main.ts`; `electron/profileJsonCli.ts`; ADR 0029. |
| Packaged stdio MCP | Exact `--eido-profile-mcp` mode accepts no extra arguments or path selector and exposes the seven Gateway descriptors as tools only. JSON-RPC framing, results, diagnostics, and Gateway responses are bounded; resources/prompts are absent; generated Gateway request IDs and trusted `mcp` attribution cannot be supplied by the caller. EOF, repeated signals, and transport failure stop admission and drain accepted work before server close. macOS enters Electron directly; Windows uses a packaged SEA console relay built with the packaging host’s Node.js runtime over fd3/4/5 so protocol stdout begins at byte zero. The relay is transport only and kills no accepted work on ordinary signal/pump loss | `electron/main.ts`; `electron/profileLaunchMode.ts`; `electron/profileMcpServer.ts`; `electron/profileMcpStdio.ts`; `scripts/electron/profile-mcp-sea-after-pack.mjs`; `electron-builder.yml`; ADR 0029. |

## Browser-Development Disk Storage API

In explicit browser development, the app uses `/api/eido/**` instead of IndexedDB when the Vite plugin is available. If the API is absent, `src/graph/save.ts` falls back to browser IndexedDB. Packaged `eido://app` never selects this path.

| Route/behavior | Data | Evidence |
| --- | --- | --- |
| `GET /api/eido/status` | Returns data file path, Idea count, and whether user content exists | `scripts/vite/storagePlugin.ts`; `src/graph/diskApi.ts`. |
| `GET /api/eido/initial` | Loads or creates the active Idea and list | `scripts/vite/storagePlugin.ts`; `src/graph/diskApi.ts`. |
| `/api/eido/ideas` | List/create Ideas | `scripts/vite/storagePlugin.ts`; `src/graph/diskApi.ts`. |
| `/api/eido/ideas/:id` | Load, rename, delete one Idea | `scripts/vite/storagePlugin.ts`; `src/graph/diskApi.ts`. |
| `/api/eido/ideas/:id/board` | Save one board snapshot | `scripts/vite/storagePlugin.ts`; `src/graph/diskApi.ts`. |
| `POST /api/eido/import-browser-store` | Best-effort migration from meaningful IndexedDB/browser data into disk store | `src/graph/save.ts`; `scripts/vite/storagePlugin.ts`. |
| `GET /api/eido/link-preview?url=…` | Browser-development counterpart of the packaged bridge's website-load operation; returns the same bounded preview/fallback shape through the same public-network reader | `scripts/vite/linkPreviewPlugin.ts`; `electron/linkPreviewService.ts`; `src/shared/loadLinkPreview.ts`. |
| Data file | Defaults to `~/.eido/eido-v3-ideas.json`; `EIDO_DATA_FILE` can override | `scripts/vite/storagePlugin.ts`. |

The default browser-development data file is private legacy data and stays outside Git. Tests and experiments should select a disposable path with `EIDO_DATA_FILE`; packaged Eido does not read this file as its Profile authority.

## Clipboard And Files

| Feature | Current behavior | Evidence |
| --- | --- | --- |
| Paste one website address on board | Creates one selected ordinary Note at the pointer/center. Its editable text retains the pasted label while its optional inset preview uses the normalized durable URL. Explicit HTTP(S) URLs keep their scheme; a whole scheme-less registrable domain such as `www.example.com`, `example.co`, or `example.co.uk/path` is normalized through the platform URL parser to HTTPS, then checked locally against the packaged ICANN Public Suffix List before entering the same preview pipeline. The renderer's platform parser and host-shape gate keep emails, IPs, versions, token-shaped strings, and ordinary text away from that boundary; the bridge and local Vite route repeat the gate, while the suffix data remains outside the canvas bundle. Recognition falls back to the ordinary Note path after a short deadline, and an Idea change cancels a pending paste so it cannot land on the wrong board. Open Graph/Twitter/title/description/site/favicon/image metadata settles into the attached preview; unavailable or preview-less pages settle into a website-shaped fallback. Clipboard text containing prose, whitespace, multiple URLs, a bare/unknown suffix, or a common dotted filename stays on the ordinary Note path; a supported image/PDF still takes priority. Refresh/Retry remains keyboard-stable. Editing Note text keeps the preview; Remove preview is undoable and preserves the current text | `src/canvas/Board.tsx`; `src/shared/linkPreview.ts`; `src/shared/loadLinkPreview.ts`; `electron/linkPreviewUrlClassifier.ts`; `src/canvas/cards/NoteCard.tsx`; `src/canvas/cards/NoteLinkPreview.tsx`; `src/graph/store.ts`. |
| Paste one local HTML path on board | A whole absolute Finder/File Explorer `.html` or `.htm` path creates one selected ordinary Note with a local-preview element in the installed desktop app. Electron canonicalizes a bounded regular file and records the physical path only in its device-local source registry; the Board receives an opaque source ID and basename. The Electron-main registry uses a fail-fast SQLite connection with `busy_timeout=0`, so lock contention cannot impose the Profile runtime's one-second wait on the UI-sensitive main loop. One isolated, JavaScript-disabled, network-blocked offscreen window captures a bounded JPEG, then is destroyed. Network requests and unrelated local-file subresources are denied; asynchronous canonical-path checks allow only real same-directory-tree assets and embedded data, including denying an in-tree symlink that escapes. At most two captures run and sixteen wait, and a newer source fingerprint supersedes an older result as soon as it is admitted. Capture, bridge, Card, and Profile persistence share one JPEG size/dimension/byte-envelope contract, including bounded high-DPI output. The JPEG settles through the ordinary Card asset and content-addressed Profile blob path, while SQLite persists the matching logical asset metadata. The Note filters this private JPEG out of its ordinary asset gallery and renders it once in the preview. Reopened Notes use the saved static image without recreating the HTML renderer. Open resolves the opaque ID back to the original on that device, Refresh explicitly recaptures it even when the HTML file timestamp is unchanged, and Remove preview preserves Note text and unrelated assets while removing the projection and private JPEG. A failed Open or Refresh marks the original unavailable without removing the saved image. Missing, moved, non-HTML, UNC/network-share-shaped, relative, multiline, directory, and oversized candidates fail closed; a locally mounted volume is treated as an ordinary local filesystem path | `src/shared/loadLinkPreview.ts`; `electron/localHtmlPreviewSourceStore.ts`; `electron/localHtmlPageCapturer.ts`; `electron/localHtmlPreviewService.ts`; `src/canvas/cards/NoteCard.tsx`; `src/canvas/cards/NoteLocalHtmlPreview.tsx`; `src/persistence/profileLogicalProjection.ts`. |
| Paste image/PDF on board | Creates a note at pointer/center and attaches assets | `src/canvas/Board.tsx`; `src/shared/clipboardAssets.ts`. |
| Paste image/PDF in note | Adds assets to the selected note | `src/canvas/cards/NoteCard.tsx`; `src/shared/clipboardAssets.ts`. |
| Supported image MIME types | PNG, JPEG, WebP, GIF | `src/shared/clipboardAssets.ts`. |
| Supported file MIME type | PDF | `src/shared/clipboardAssets.ts`; OpenRouter file-parser plugin in `openRouter.ts`. |
| Asset storage | The renderer uses a `CardAsset` data URL, while installed Profile persistence stores logical metadata/digest in SQLite and immutable bytes in the content-addressed Profile blob store | `src/graph/types.ts`; `clipboardAssets.ts`; `src/persistence/profileLogicalProjection.ts`; `electron/sqliteProfileBlobStore.ts`. |

Creating a preview makes bounded requests to the pasted website and its declared image/favicon immediately. Website work is limited to eight active and sixteen waiting loads; overflow fails quickly into the ordinary website card. Remote media must decode as a dimension-bounded, non-animated PNG or JPEG before it can cross the preview boundary. The Note stores the source URL, state, and bounded text metadata so reopening, copying, searching, undo/redo, Profile persistence, and Portable Export share its meaning. Encoded media stays in a bounded renderer-memory cache and never enters logical Profile records. Reopening or cache eviction renders the durable metadata card without network work; Refresh is the explicit media-enrichment path and cannot downgrade already saved rich metadata. Failed first enrichment does not erase or disable the source URL, and every preview offers keyboard-stable Refresh/Retry plus an undoable Remove preview action that leaves the Note body unchanged.

Preview generation is not only paste-triggered: a Note's own body text is watched too (`src/canvas/cards/NoteCard.tsx`), debounced, for its first `http(s)` URL (`firstWebUrlInText` in `src/shared/linkPreview.ts`), skipping fenced and inline code so a pasted or typed code sample is never fetched. A Note already carrying a link preview or a local HTML preview is left alone. Each URL gets at most one attempt per Note; a failed or finished attempt is remembered in the Card's `meta` bag and never retried on a later edit, reload, or Board revisit. Removing either preview kind through Remove preview (`src/graph/store.ts`) also remembers that URL as dismissed, so the body-driven watcher cannot immediately regrow the preview the founder just closed.

Local HTML previews use a different lifecycle because Eido owns the source device. Their captured image is durable Card content, so reopening is a static-image read rather than another browser render. The physical source path is intentionally not portable Profile meaning: exports and transferred Profiles retain the screenshot but cannot open or refresh the original until that device has its own source authority.

The device-local source authority deliberately outlives Card deletion and conversion. Undo, duplicated Cards, and multiple Cards may still share the same opaque source ID, so deleting a Card cannot safely delete that registry entry. A future cleanup must prove Profile-wide reachability and respect the undo horizon; until then, missing sources fail closed and registry rows remain tiny metadata rather than rendered page resources.

## GitHub CI

| Trigger | Behavior | Evidence |
| --- | --- | --- |
| Pull request proven to change only `site/` | Use database-free classification and static marketing-site proof; report the aggregate `Required gate` and stable `Browser interactions` checks without app/browser work | `.github/workflows/ci.yml`; `.github/workflows/browser-canary.yml`; `scripts/ci/marketing-site-scope.mjs`. |
| Any other or unclassifiable pull request | Fail open from classification diagnostics to the full lane: install, type-check/build, enforce bundle budget, run fast tests and browser interactions | `.github/workflows/ci.yml`; `.github/workflows/browser-canary.yml`. |
| `site/`-only push to `main` | Re-run the static site contract and let Cloudflare Pages deploy; do not build or preserve an app artifact | `.github/workflows/ci.yml`; Cloudflare Pages build watch include `site/*`. |
| Any other push to `main` | Run full required app proof, then preserve `dist/` for three days | `.github/workflows/ci.yml`. |
| Desktop-related PR or `main` push | Check the exact PR head or pushed SHA on `macos-15` arm64 and `windows-2025` x64, run a fresh disposable installed-Profile package proof, and retain structured JSON for three days | `.github/workflows/desktop-proof.yml`; `.local/electron-shell/proof-evidence.json`. |
| Non-site-only pull request | Prove browser startup, run the focused Playwright smoke, then exercise full-detail Card activation against the production bundle | `.github/workflows/browser-canary.yml`. |
| Nightly/manual browser | Run startup health plus four isolated shards of the full interaction suite, with the production-bundle Card activation regression on shard 1; retain artifacts only for failures | `.github/workflows/browser-canary.yml`. |
| Manual experiment | Run candidate/performance evidence only when deliberately dispatched; job names end ` (experimental)` and do not enter the merge verdict | Candidate/baseline workflows; `scripts/ci/workflow-policy.mjs`. |
| Weekly | Audit dependencies, group npm patch/minor updates, isolate npm majors, and group Actions updates | `.github/workflows/maintenance.yml`; `.github/dependabot.yml`. |
| Working directory | the repository root | `.github/workflows/ci.yml` defaults. |
| Cache | npm cache keyed by `package-lock.json` | `.github/workflows/ci.yml`. |

## Cloudflare Delivery

| Aspect | Current behavior | Evidence |
| --- | --- | --- |
| Update and Release Storage | Cloudflare R2 bucket `eido-releases` on custom domain `https://updates.eido.so`. Holds the signed `eido-update.json` authority, Squirrel transport metadata at `latest-mac.yml`, and exact versioned platform packages (`.dmg`, `.zip`, `.exe`). Publication uploads certified binaries first and the signed Eido manifest last, then live-verifies the ZIP's SHA-256, SHA-512, and size against certification. Older versions use the signed feed. Install a newer release manually to update the current desktop app. CORS allows `GET`/`HEAD` from `https://eido.so` and `https://www.eido.so`. | `electron/updateEndpoints.ts`; `scripts/release/generate-update-manifest.mjs`; `.github/workflows/desktop-release.yml`; ADR 0032; ADR 0039; GitHub Actions `release-publish` secrets (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`). |
| Public Website, Legal Notices, and Downloads | Cloudflare Pages project `eido-site` serves the non-executable HTML/CSS `site/` tree on `https://eido.so` and `https://www.eido.so`. The homepage links the standalone `/legal`, `/privacy`, and `/terms` pages; `/privacy` owns the plain-language trust explanation as well as the complete policy. Shared local CSS, a restrictive `_headers` policy, and a static 404 preserve the no-script/no-form boundary. The legal pages remain noindexed and carry a machine-readable review state until operator and operational facts are confirmed; the rendered pages do not expose internal publication warnings. The homepage links to the public source and build instructions. `Desktop release publication` still republishes the stable `Eido-latest-arm64.dmg` and `Eido-latest-x64.exe` aliases. The homepage can link to them once they serve certified builds of the open-source app. Cloudflare still receives ordinary connection/request metadata at the edge; the site itself adds no analytics, ads, third-party scripts, or forms. Zero application or canvas code is served. The Pages build output is `site/` and its account-scoped build watch include is `site/*`, so only a changed marketing-site path creates a preview/production deployment and GitHub `Cloudflare Pages` check. A skipped build emits no check and cannot block merge because that provider check is not required. The GitHub required workflows separately keep stable check names and run the static site contract for a proven `site/`-only diff. | `site/`; `scripts/ci/site-static.test.mjs`; `scripts/ci/marketing-site-scope.mjs`. |

## Non-Integrations

| Area | Status | Evidence |
| --- | --- | --- |
| Production backend server | None | The only local API is a Vite dev/preview middleware in `scripts/vite/storagePlugin.ts`. |
| Remote database | None | Packaged storage is one local SQLite Profile; explicit browser development uses the Vite disk adapter or IndexedDB fallback. |
| Accounts/auth | Eido has no account, sign-in, or sign-up. OpenRouter and Linkup use device-local user-owned keys; supported local tools reuse their own provider login | `src/canvas/SettingsModal.tsx`; `src/graph/apiCredential.ts`; `src/brain/aiProvider.ts`; ADR 0051. |
| Web crawling | Link previews request individual public pages and their preview assets. AI web tools stay inside the chosen provider path. | `electron/linkPreviewService.ts`; `src/brain/webTools.ts`. |
| Provider-executed-only tool use | No longer the whole story. With a Linkup key on OpenRouter, Eido runs the tool loop itself (ADR 0036); without one, tools are declared to OpenRouter and executed there inside one completion, or owned outright by a local harness | `src/brain/agenticRun.ts`; `src/brain/openRouter.ts`; ADR 0033; ADR 0036. |
| Collaboration/sync | Designed-for but not implemented | v3 plan docs; no Yjs/CRDT dependency in `package.json`. |
| Provider SDKs | None | `package.json` has no provider SDK; OpenRouter uses `fetch` and local tools use their installed CLIs. |
