# Stack

Source-grounded map of the active Eido implementation. Evidence comes from `docs/codebase/.codebase-map-scan.md`, `package.json`, `.github/workflows/ci.yml`, and the source paths named below.

## Active Runtime

| Area | Current choice | Evidence |
| --- | --- | --- |
| Active app | Root Eido app | `README.md`; `package.json`; source inventory contains `src/**` source files. |
| Development and CI runtime | Node.js 24 or 26.9 and later 26.x releases | `package.json` declares both supported lines. GitHub Actions selects the Node 24 line through `.github/node-version`. |
| Package manager | npm 11 | `package.json` declares npm compatibility. `package-lock.json` records the exact dependency versions used by `npm ci`. |
| App shell | Vite + React renderer inside an installed manifest-pinned Electron Profile shell; Vite browser development remains explicit | `vite.config.ts`; `src/main.tsx`; `electron/main.ts`; `electron/shell-manifest.json`. |
| Dev/preview storage server | Vite plugin mounted in dev and preview | `vite.config.ts`; `scripts/vite/storagePlugin.ts`. |
| Language | TypeScript, strict mode with separate renderer and desktop type surfaces | `tsconfig.json` keeps Node-bearing Electron declarations behind a root-only module quarantine; `tsconfig.electron.json` explicitly loads Node types for main, Profile utility, and preload; both enforce strict unused checks. |
| Website, legal notices, and downloads | Standalone non-executable HTML/CSS site on Cloudflare Pages (`eido.so`, `www.eido.so`) | `site/`; `scripts/ci/site-static.test.mjs`. |
| Tests | Vitest | `package.json` script `test`; `src/**/*.test.ts`. |

## Main Dependencies

| Package | Role | Evidence |
| --- | --- | --- |
| `react`, `react-dom` | UI runtime | `package.json`; `src/main.tsx`. |
| `@xyflow/react` | Canvas rendering, cards, connections, selection, pan/zoom | `package.json`; `src/canvas/Board.tsx`; `src/canvas/cards/CardShell.tsx`. |
| `@mdxeditor/editor` | Markdown-native editing for the currently selected Note, Ask AI, or Conversation card; loaded as a separate chunk | `package.json`; `src/canvas/cards/MarkdownCardEditor.tsx`; `src/canvas/cards/RichMarkdownEditor.tsx`. |
| Security-patched transitive overrides | `@hono/node-server`, `fast-uri`, `hono`, `ip-address`, and `js-yaml` stay on patched releases even while their parents permit vulnerable versions. Remove an override only after the resolved tree remains clean without it | `package.json` `overrides`; `package-lock.json`; the required production dependency audit. |
| `prismjs` | Syntax grammar runtime required by MDXEditor's Lexical code support; loaded and initialized before the lazy editor chunk | `package.json`; `src/canvas/cards/MarkdownCardEditor.tsx`. |
| `tldts` | Offline, paste-time ICANN Public Suffix List lookup behind the installed-main/local-development boundary for deciding whether a scheme-less whole clipboard value contains a registrable website domain; it stays out of the renderer bundle and is not a network-security boundary | `package.json`; `electron/linkPreviewUrlClassifier.ts`; `research/10-link-preview-url-recognition/`. |
| `zustand` | Single graph store | `package.json`; `src/graph/store.ts`. |
| `nanoid` | Prefixed local IDs | `package.json`; `src/shared/ids.ts`. |
| `vite`, `@vitejs/plugin-react` | Dev/build toolchain | `package.json`; `vite.config.ts`. |
| `typescript` | Type checking and build gate | `package.json`; `tsconfig.json`. |
| `vitest` | Unit test runner | `package.json`; `src/brain/*.test.ts`; `src/graph/store.test.ts`. |
| `electron`, `electron-builder`, `@electron/fuses` | Exact installed desktop runtime, utility-process host, unpacked packager, and independent fuse readback | `package.json`; `electron-builder.yml`; `electron/main.ts`; `scripts/electron/packaged-smoke.mjs`; `scripts/electron/proof-host.mjs`. |
| `@zip.js/zip.js` | Exact native ZIP reader behind the installed Portable Export/current-Idea import seam; archive layout and publication remain owned by Eido's deterministic writer | `package.json`; `electron/profilePortableZip.ts`; `electron/profilePortableSource.ts`; `electron/profileUtilityHost.ts`. |

## Browser APIs Used Directly

| API | Use | Evidence |
| --- | --- | --- |
| IndexedDB | Explicit browser-development fallback for local Ideas and Board snapshots; never packaged Profile authority | `src/graph/save.ts` opens database `eido-v3` with stores `ideas`, `ideaBoards`, `meta`, and legacy `board`; `src/graph/profileRendererPersistence.ts` fails closed for a packaged origin without its bridge. |
| `localStorage` | Non-secret device settings plus browser-development Intent actor identity | `src/graph/store.ts` and `src/ui/theme.ts` share `eido-v3-settings` for model preferences, reasoning effort, and Light/Dark/Match system theme; `src/graph/apiCredential.ts` removes any legacy `apiKey` after successful local-file migration and preserves it only when migration must retry. `src/graph/commitFunnel.ts` uses `eido-v3-actor-id` only in explicit browser development. |
| `fetch` streaming | OpenRouter chat completions SSE parsing | `src/brain/openRouter.ts`. |
| `fetch` JSON API | Browser-development disk-backed Idea storage when the Vite storage plugin responds | `src/graph/diskApi.ts`; `scripts/vite/storagePlugin.ts`. |
| Clipboard + FileReader | Paste images/PDFs into note cards as data URLs | `src/shared/clipboardAssets.ts`; `src/canvas/Board.tsx`; `src/canvas/cards/NoteCard.tsx`. |
| Blob/object URL/download | Browser-development export of an Idea as JSON; packaged Profiles use native Portable Export | `src/App.tsx`; `electron/installedProfileRouter.ts`. |

## Node APIs Used By The Vite Plugin

These APIs support explicit browser development, not packaged Profile persistence.

| API | Use | Evidence |
| --- | --- | --- |
| `node:fs/promises` | Read/write the disk-backed Idea store atomically via temp file rename | `scripts/vite/storagePlugin.ts`. |
| `node:os`, `node:path` | Default data file path under the user's home directory; optional `EIDO_DATA_FILE` override | `scripts/vite/storagePlugin.ts`. |
| Vite middleware server | Serves `/api/eido/**` in dev and preview | `scripts/vite/storagePlugin.ts`; `vite.config.ts`. |

## Electron APIs Used By The Installed Profile

| API | Use | Evidence |
| --- | --- | --- |
| `app.getPath`, `app.setPath`, `requestSingleInstanceLock` | Resolve/create the stable `appData/Eido` root, pin the singleton identity, and admit only one GUI primary before Profile descendants exist | `electron/main.ts`; `electron/profileInstallation.ts`; `electron/installedProfileSingleInstance.ts`. |
| `node:fs/promises` | Atomically publish the protected OpenRouter or Linkup credential file under `userData/credentials`. On POSIX the directory and files use `0700` and `0600` permissions. | `electron/localCredentialStore.ts`; `electron/main.ts`. |
| `safeStorage` | Protects the user-supplied OpenRouter and Linkup keys in device-local credential files; no Eido Account token exists. Missing protection leaves AI credentials unavailable without blocking the local Profile | `electron/localCredentialStore.ts`; `electron/main.ts`. |
| `utilityProcess.fork` | Start the sole packaged SQLite/Profile owner after Electron readiness for either the GUI session or one admitted existing-only CLI request, join it before clean GUI shutdown or CLI stdout, and attempt bounded forced termination/join on terminal uncertainty | `electron/main.ts`; `electron/installedProfileSession.ts`; `electron/installedProfileHeadlessLease.ts`; `electron/profileUtilityLifecycle.ts`. |
| `node:sqlite` | Execute synchronous WAL transactions, checkpoints, integrity, and runtime evidence only inside the Profile utility | `electron/sqliteRuntime.ts`; `electron/profileUtilityHost.ts`; `electron/runtimeProbe.ts`. |
| `ipcMain`, `contextBridge`, `ipcRenderer` | Carry separate versioned Profile and credential bridges for the exact owned `eido://app` main frame | `electron/profileBridgeContract.ts`; `electron/keychainBridgeContract.ts`; `electron/preload.ts`; `electron/security.ts`. |

## Commands

Run from the repository root.

Package scripts check the Node.js and npm versions on your PATH before they
run. The installed desktop app uses the runtime bundled with Electron. The
standalone CLI and Windows MCP relay embed the Node.js executable used to
package them.

Node.js 26.9 includes the SQLite backup completion fix required by the Profile
recovery tests. [Node.js 26.9 release notes](https://nodejs.org/en/blog/release/v26.9.0/)

| Command | What it does | Evidence |
| --- | --- | --- |
| `npm ci` | Install the exact locked dependencies for local development | `README.md`; `package-lock.json`. |
| `npm start` | Build and launch the ordinary Electron app against its fixed SQLite Profile | `README.md`; delegates to the `package.json` script `desktop`. |
| `npm run desktop` | Type-check/build the renderer and Electron entries, then launch `electron .` through the installed Profile bridge | `package.json`; `electron/main.ts`. |
| `npm run dev` | Start explicit Vite browser development at `http://localhost:5173`; this uses the legacy JSON adapter or IndexedDB fallback, never the installed Profile | `README.md`; `package.json` script `dev`. |
| `npm run typecheck` | TypeScript check only | `package.json`; useful as focused local proof. CI gets the same proof through `npm run build`. |
| `npm run build` | `tsc -b && vite build` | `package.json`; CI runs this. |
| `npm run build:electron` | Type-check and independently bundle self-contained CommonJS main, Profile utility, and preload entries | `tsconfig.electron.json`; `vite.electron.config.ts`. |
| `npm run desktop:package:dir` | Fresh renderer build in explicit `desktop-proof` mode, Electron build, and unpacked-only `electron-builder --dir --publish never` output; ordinary production renderer builds exclude the non-promotable proof harness | `package.json`; `src/desktop/packagedProfileProof.ts`; output is ignored under `.local/electron-shell/`. |
| `npm run desktop:smoke` | Rebuild/package, then use a disposable Profile root to prove installed bridge mutation, local credential migration/round-trip with no renderer plaintext persistence, the exact CSP/egress surface, checkpointed close, offline reopen, bounded query/capability, ASAR/fuses (including disabled cookie encryption), signing boundary, and cleanup | `scripts/electron/packaged-smoke.mjs`; supported Windows x64 and macOS arm64 hosts. |
| `npm test` | `vitest run` | `package.json`; CI runs this. |
| `npm run check:bundle` | Enforce deterministic JavaScript bundle budgets after build | `scripts/ci/bundle-budget.mjs`; CI runs this. |
| `npm run ci:runtime` | Check the active Node.js and npm versions against the supported ranges | `scripts/ci/toolchain-policy.mjs`; `package.json`. |
| `npm run ci:toolchain` | Check runtime compatibility, lockfile engine metadata, and the shared CI Node.js line | `scripts/ci/toolchain-policy.mjs`; `package.json`; `.github/node-version`. |
| `npm run ci:workflow-policy` | Reject automatically triggered experimental evidence workflows | `scripts/ci/workflow-policy.mjs`; required CI runs this. |
| `npm run test:browser:health` | Prove app startup, hydration, and one seeded rendered card | `browserHealth.browser.test.ts`; browser canaries run this first. |
| `npm run test:browser:smoke` | Run the focused Playwright PR canary | `package.json`; `.github/workflows/browser-canary.yml`. |
| `npm run test:browser:production` | Build and run the production-preview Card activation regression against a synthetic save | `package.json`; `playwright.production.config.ts`; `.github/workflows/browser-canary.yml`. |
| `npm run preview` | Vite production preview | `package.json`. |

## Non-Runtime Areas

| Path | Status | Evidence |
| --- | --- | --- |
| `docs/archive/initial-product-plan/` | Historical plan from the v3 transition | Useful for intent archaeology, not proof of current behavior. |
| `research/` | Research and reference notes, not active runtime | `README.md`; `research/README.md`; scanner ignores `research/repos`. |
