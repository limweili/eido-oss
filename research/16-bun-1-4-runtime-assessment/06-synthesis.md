# Should Eido adopt Bun 1.4?

Point-in-time decision brief, 2026-08-23.

## Decision

**Do not replace Eido's shipped runtime, Electron stack, Vite build, Vitest, Playwright, or SQLite Profile authority with Bun 1.4.** Bun would not make the board, cards, AI responses, or durable saves materially faster because it does not own those hot paths.

**A reversible Bun package-install canary is worth considering only if an ROI baseline shows dependency installation costs more than the experiment and its continuing maintenance.** The canary should use Bun 1.4 only to produce `node_modules` in an isolated experiment, then run the existing Node/npm build, test, browser, and unpacked-package gates. Keep npm authoritative. Persist the exact Bun version, migrated `bun.lock`, registry and trust configuration, dependency-tree hash, and lifecycle outputs as experiment artifacts or on an isolated branch so the comparison is reproducible without merging a second lockfile to main.

Confidence is high for the product-runtime conclusion and medium for the installer opportunity. Exact Eido install and CI savings remain unmeasured.

## Governing mental model

Bun is six separable technologies: package manager, script runner, JavaScript runtime, test runner, bundler/dev server, and standalone executable compiler. Eido uses its current technologies in different processes. A fast Bun package install does not put Bun into the Electron renderer, and a Bun CLI does not make Chromium paint a board faster.

Eido's user-visible work has three dominant owners:

1. **Chromium, React, and React Flow** own the board, pointer gestures, card UI, layout, paint, and browser APIs.
2. **OpenRouter, the selected model, and the network** own most short and long AI-run latency.
3. **Electron's Node utility process and SQLite** own durable Profile reads, writes, recovery, and one-owner coordination.

Bun can most safely affect the outer developer loop: dependency installation and selected short scripts. Moving it inward produces less speed benefit and more compatibility, packaging, and recovery risk.

## What Bun could replace, and what it should not

| Bun capability | Current Eido technology it could replace | Decision | Reason |
| --- | --- | --- | --- |
| `bun install`, `bun.lock`, global cache | npm 11.6.2, `package-lock.json`, npm cache | **Canary only** | The likely large win is install wall time. Eido currently enforces npm metadata, exact npm execution, `package-lock.json`, and npm CI caching. Bun also blocks untrusted lifecycle scripts by default, so Electron and Playwright downloads need proof. |
| `bun run` and direct TypeScript execution | `npm run`, host Node 24.12.0 for scripts | **New unguarded probes only** | Short process startup can be much faster, but every supported Eido script enters the npm runtime guard. Existing commands cannot switch runners without a deliberate toolchain-policy change and audit consequence. |
| `bun:test` | Vitest 4.1.10 | **Retain Vitest** | Eido tests use Vitest APIs, Vite transforms, jsdom, Testing Library, coverage, and process semantics. Migration changes test semantics and gives no product-speed benefit. |
| Bun DOM alternatives | jsdom 29.1.1 | **Retain jsdom** | Bun documents that jsdom depends on unsupported V8 APIs. Replacing it with happy-dom would be a separate fidelity decision. |
| `Bun.build` and Bun HTML development | Vite 8.0.16, Rolldown, `@vitejs/plugin-react`, `storagePlugin`, `linkPreviewPlugin`, `designTokensPlugin`, Vite HMR/preview | **Retain Vite** | The named plugins supply Connect middleware, disk storage, link previews, generated token CSS, virtual assets, manual chunks, and four Electron CommonJS build modes. Bun's bundler does not type-check and would require plugin and output-contract rewrites. |
| Built-in transpilation | TypeScript compiler 5.9.3 resolved from `^5.6.3` | **Retain `tsc`** | Bun strips/transforms TypeScript but does not replace type checking or declaration work. |
| Bun runtime and Web APIs | Host Node 24.12.0 for an optional CLI, maintenance, or harness process | **Independent sidecar experiment** | A non-authoritative helper could start faster without touching Profile ownership. Measure one concrete CLI or harness workload first. It must preserve streaming, cancellation, signals, paths, environment behavior, and serialization; sign it only if it later becomes a shipped artifact. |
| `bun build --compile` | Node SEA plus postject for standalone CLI artifacts | **Do not replace current release path** | Bun can make executables, but Eido's CLI/MCP topology injects SEA blobs into package-owned Electron binaries and signs the result. A Bun binary adds another artifact and certification path. |
| Bun `node:sqlite` | Electron utility process using embedded Node 24.18.0 `node:sqlite` | **API hypothesis only, retain authority** | Bun 1.4.0 passed a basic in-memory `DatabaseSync` probe, despite stale reference text. Eido still needs WAL, full synchronous durability, busy timeout, transactions, CAS, backup, recovery, concurrency, utility-process ownership, and packaged proof. |
| `bun:sqlite` | The Node-compatible SQLite driver contract | **Do not substitute** | It is Bun's synchronous native API, not proof of Eido's `node:sqlite` semantics. Its Northwind read benchmark does not support Profile write or recovery claims. |
| `Bun.SQL` | The synchronous one-owner revision-store contract | **Do not substitute** | Its promise, pooling, and multi-database model is a different interface and concurrency shape. Replacing the Profile boundary would be a storage redesign. |
| `Bun.serve`, WebSocket, HTTP/3 | Vite development server or a future local service | **No current replacement** | Eido has no packaged Bun backend server. Vite's server supplies HMR and custom middleware in development. HTTP/3 is experimental and irrelevant to current provider calls. |
| Bun Node-API or FFI | Node-API/native addon tooling | **Retain Node/Electron ABI contracts** | Eido's current native helper is C11 over platform pipes, not a `.node` addon. Electron native addons require Electron-specific ABI rebuilding. Bun FFI remains experimental. |
| Bun desktop `WebView` | Electron 43.2.0, Chromium, BrowserWindow, preload, IPC, utility process, updater and fuses | **Do not replace** | Bun is not a drop-in Electron shell. This would be a new desktop product architecture. |

## Technologies Bun should not replace

The retain boundary is broader than the table above:

- **Product UI and state:** React 18.3.1, React DOM, `@xyflow/react`, Zustand, Immer, MDXEditor, PrismJS, Lucide, nanoid, tldts, and zip.js. Bun may install or bundle these packages, but does not replace their product roles.
- **Browser runtime:** Electron's Chromium/V8 renderer, HTML, CSS, Canvas, DOM, Web Streams, browser `fetch`, pointer events, `requestAnimationFrame`, and GPU/layout/paint work. Bun uses JavaScriptCore outside Electron and cannot accelerate code already executing inside Chromium.
- **Desktop and persistence:** Electron main/preload/IPC/`utilityProcess`, SQLite itself, IndexedDB for browser development, electron-updater, electron-builder, Electron fuses, asar, Node SEA, postject, the C11 live-gateway helper, clang/MSVC, OS pipes/sockets, Apple codesign, notarization, and Gatekeeper.
- **Quality:** TypeScript type checking, Vite/Rolldown, Vitest, jsdom, Testing Library, Playwright, Chromium browser binaries, traces, screenshots, and packaged smoke/certification tests.
- **External services and protocols:** OpenRouter and model providers, HTTP/SSE latency, the Model Context Protocol, `@modelcontextprotocol/sdk`, GitHub Actions, and operating-system security/keychain facilities. Bun could host a client or step, but it does not replace the service or protocol.

Three Node versions must not be conflated. Eido's host toolchain pins Node 24.12.0, Electron 43.2.0 embeds Node 24.18.0 for main and utility processes, and Bun 1.4 targets compatibility with Node 26.3.0 tests. A successful Bun import does not certify Electron's embedded runtime, native ABI, or Profile behavior.

## Estimated performance effects

The ranges below are planning estimates, not promises. “Faster” means lower wall-clock time. The likely column assumes the recommended scope: Bun is tried only for dependency installation or one new unguarded sidecar probe, while the shipped app remains unchanged. Unmeasured broad-migration effects are labelled unknown instead of receiving a precise range.

| Category | Likely effect under recommended scope | Broad-migration possibility | Confidence and mechanism |
| --- | --- | --- | --- |
| **End-user app download/install/update** | **0% if artifact equivalence passes** | **Unknown** if a Bun helper ships; measure artifact size and updater behavior | High for the recommended scope. A developer package manager is not in the `.app`. |
| **Developer dependency install** | **50–90% faster** (about **2–10×**) | Could be slower or fail if lifecycle scripts, Electron downloads, registry/auth, or lock migration dominate | Medium direction, low Eido absolute time. Bun's vendor fixture is faster by 5–30× depending on cache, but Eido's larger graph and platform artifacts justify a narrower range. |
| **No-op and short script startup** | **40–80% faster runtime startup**, usually only **0.1–0.25 seconds saved per guarded Eido command** | Compatibility remediation can erase the win | Medium. Bun reports 5.1 ms versus Node 27.2 ms for a tiny Linux script; Eido's local Node/npm guard measured 0.26 seconds and includes npm policy work. |
| **Coding, cold dev start** | **Unknown; measure**. Only launcher overhead is expected to improve | **Unknown** when Vite runs under Bun | Low. Vite and plugin loading dominate, and no Eido Bun/Vite timing exists. |
| **Coding, HMR and edit feedback** | **0% expected** | **Unknown regression risk** if Bun env loading, plugin behavior, or HMR semantics diverge | Medium for no expected gain. Vite/Rolldown and Chromium own HMR and renderer execution. |
| **Type checking** | **0%** | A Bun-only build can be faster only by omitting type checking, which is not equivalent | High. `tsc` remains required. |
| **Unit tests, keeping Vitest** | **0–25% faster** | Could regress or fail on forks, transforms, jsdom, coverage, mocks, or timers | Low. Bun's fast `bun:test` example is not Vitest and not Eido. |
| **Browser QA with Playwright** | **0–10% faster** from setup/install only | Could be slower or unsupported at runner edges | Medium. Browser startup, Chromium, web server, and interactions dominate; Playwright's official workflow remains Node-oriented. |
| **Whole required CI job** | **0–15% faster**, roughly **0–90 seconds** under current unknown baseline | **10–36% faster only if install is 20–40% of the gate and Bun removes 50–90% of it**; compatibility failures can make the lane slower overall | Low until CI steps are timed. This is Amdahl's law: speeding one fraction does not speed the rest. |
| **Release build/package/certification** | **0% if the canary runs in parallel and artifacts match** | Broad replacement is **unknown** and could cost **20–50 engineer-days** plus cross-platform remediation | Medium. First compare trees, bundles and unpacked smoke. Sign/notarize only if outputs differ or a Bun binary is introduced. |
| **Packaged app startup** | **0%** | **Unknown** if bundles or process topology change | High for no direct effect. Electron and Chromium launch the app. |
| **Whole-app memory** | **0% expected** | **Unknown** for a shipped helper; Bun's own Vite development row used about **9% more memory** than Node | Medium. Bun can use much less memory for tiny scripts, but Chromium dominates the packaged app. |
| **Board pan/zoom** | **0%** | **About 5% faster to 5% slower** only through different emitted browser code | High. React Flow, Chromium input, layout, Canvas and paint own the frame. |
| **Drag and resize cards** | **0%** | A new Bun IPC hop could add **1–5 ms per event** and reduce reliability under back-pressure | High. Eido already coalesces drag work with `requestAnimationFrame`; keep it renderer-local. |
| **Local card interaction and editing** | **0%** | **About 5% faster to 5% slower** if bundling changes | High. Note, result, image, link, group, conversation and editor UI execute in Chromium. |
| **Short AI/card run** | **0–5% faster**, usually near 0 | A sidecar can add **1–5% first-token delay** | Medium. Provider/model/network dominate; local startup is a small fraction. |
| **Long AI/conversation/tool run** | **0% provider-throughput gain** | Extra hops can add **1–10% inter-turn latency** and complicate cancellation/order | High for the dominant mechanism. Repeated model turns dwarf runtime startup. |
| **SQLite/Profile reads** | **0% under recommended scope** | Raw reads might improve, but **no defensible Eido percentage exists**; end-to-end could be slower after IPC/serialization | High for no scoped effect, low for hypothetical migration. Bun's older 3–6× Northwind claim is not transferable to Eido. |
| **SQLite/Profile saves** | **0% under recommended scope** | A sidecar adds a serialization leg, plausibly **5–20% slower**; full-sync disk durability limits runtime wins | Medium. Saving includes validation, revision CAS, WAL, `synchronous=FULL`, receipts and recovery semantics. |
| **Pure graph/serialization or compression script** | **0–30% faster** if moved to Bun | Could regress where V8-specific behavior or conversion dominates | Low for Eido. Bun's zlib examples range from tied to roughly 39% faster, but no Eido fixture has run. |
| **Standalone CLI or harness startup** | **Unknown; measure one concrete workload** | Profile operations remain Electron/SQLite bound; streaming and cancellation can regress | Low. Bun's micro-startup advantage supports the direction, not an Eido percentage. |

## Maintenance over Eido's lifetime

### What becomes easier

- Dependency installs and no-op commands can become materially faster.
- Bun combines installer, runner, test runner, bundler, server, SQLite clients, and executable compiler in one distribution. This can reduce tool discovery for a Bun-native project.
- Lifecycle scripts are blocked unless trusted, which is a useful supply-chain default when the allowlist is reviewed deliberately.
- Standalone Bun helpers can avoid a separate Node installation and may use less memory for small processes.

### What becomes harder

- Eido would maintain **two JavaScript engines and support contracts**: Chromium/V8/Node inside Electron, and JavaScriptCore/Bun for outer tools. A failure can become runtime-specific rather than product-specific.
- A dual npm/Bun setup adds `package-lock.json` versus `bun.lock`, cache differences, lifecycle trust configuration, registry/auth differences, and drift between the development and release authorities.
- Bun 1.4 is a major Rust rewrite released on 2026-08-20. Its release notes, living compatibility table, and generated `node:sqlite` reference already disagreed. The exact binary worked for the basic API, but documentation skew becomes work Eido must absorb.
- Node has LTS lines, broad upstream support, stable Node-API contracts, and explicit support statements from Electron, Vite, Vitest, and Playwright. Bun's 1.x security policy does not publish an equivalent long-term support window or SLA.
- Debugging spans WebKit Inspector/JavaScriptCore for Bun and Chrome DevTools/V8 for Electron. Profiles, serialization formats, stack traces, source maps, mocks, and timers can differ.
- Every new Bun executable increases cross-platform artifact, license, signing, notarization, update, incident-response, and supply-chain scope. It removes none of Eido's existing Electron/Apple/Windows obligations.
- Contributors and automation must learn which command is authoritative. A “fast local Bun path, real npm release path” can hide failures until CI or release day.

The lowest long-term maintenance shape is therefore not “replace everything with Bun.” It is either keep the current single Node/npm authority, or make Bun a tightly bounded installer with an explicit removal path.

## Trade-offs and thresholds

| Choice | Benefit | Cost and failure timing | Reversibility |
| --- | --- | --- | --- |
| Keep Node/npm only | One supported toolchain, no migration work | Forgoes faster installs; developers pay on every clean install and CI run | Complete |
| Shadow Bun installer canary | Measures the only likely large win without changing the app | Estimated **3–7 engineer-days**; native/lifecycle trouble may raise this to **10–20 days**. Failures appear in CI/build/package comparison before release | High if no Bun lockfile or product artifact becomes authoritative |
| Adopt Bun as authoritative package manager | Faster installs and one Bun cache | Lock/provenance/policy migration, dual-runtime support, upstream compatibility tracking | Medium; rollback needs a known-good npm lock and package-tree proof |
| Replace test/build tools | Potential runner/bundler speed | Vitest/jsdom/Vite plugin semantics, coverage, HMR, Electron CJS output and developer debugging all change | Medium to low |
| Replace runtime/storage or ship Bun sidecars | Possible CLI/server/raw I/O wins | New process, storage, signing, recovery, cancellation, security and incident boundaries. Users discover mistakes through lost work or broken releases | Low at the Profile boundary |

Run the installer canary only if an ROI calculation is positive. Measure cold and warm minutes, annual install count across developers and CI, onboarding frequency, and the value of waiting time. Compare that annual cost with the estimated 3–7 engineer-day experiment, possible 10–20 day remediation, and continuing dual-toolchain maintenance. Include npm cache and CI tuning as the control arm. The canary has not earned authority merely by being faster.

## Recommended next move

1. Time the existing npm install and each required CI phase on cold and warm caches. Count annual clean installs, cache misses, CI runs, and onboarding events. Benchmark npm cache and workflow tuning as the control.
2. If annual time value exceeds the canary and maintenance cost, run a Bun 1.4 shadow install on macOS arm64, Windows x64, and Ubuntu. Preserve exact Bun, lock, trust, registry, tree-hash, and lifecycle artifacts on an isolated branch or as durable CI evidence. Keep Node/npm as executor and release authority.
3. Compare dependency trees, lifecycle outputs, audit results, Vite browser and four Electron bundles, Vitest, Playwright health, and unpacked Electron smoke. Sign and notarize only when outputs differ or a Bun executable is proposed.
4. Independently, a concrete non-authoritative CLI or harness sidecar may earn its own benchmark if startup is a known user or developer cost. Test streaming, cancellation, signals, serialization, packaged launch and rollback without touching Profile ownership.
5. Adopt only the seam whose measured benefit survives its gates. Do not use either pilot to smuggle in Bun test, bundler, Electron, or Profile-runtime migration.

## Evidence limits

No Bun dependency install, Vite build, Vitest suite, Playwright suite, Electron package, or Profile benchmark ran in this worktree because dependencies were absent and the task did not authorize a production migration. One exact Bun 1.4.0 macOS arm64 in-memory probe established that basic `node:sqlite` import/create/insert/select works. It did not test performance, durability, recovery, cross-platform behavior, or packaging.

The strongest unknown is Eido's actual install share of developer and CI time. That number can reverse the package-manager recommendation, but it cannot reverse the conclusion that Bun does not accelerate the board, model provider, or current Electron Profile authority.
