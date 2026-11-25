# Bun 1.4 lifecycle trade-offs

Point-in-time assessment: 2026-08-22. Facts are marked **Fact**; conclusions are
**Inference**, **Estimate**, or **Recommendation**. No Eido-on-Bun benchmark was
run.

## Scope inspected

**Fact.** The active repository is a Node 24/npm 11 project: `package.json:7-63` pins
Node 24.12.0/npm 11.6.2, every supported script enters through
`npm run ci:runtime`, and `.github/workflows/ci.yml:57-81` uses
`actions/setup-node` with npm cache and `package-lock.json`, then the canonical
`npm run ci:required`. `scripts/ci/toolchain-policy.mjs:6-10,260-285` treats
those commands and the npm lockfile as policy, not convenience.

**Fact.** Eido’s shipped boundary is materially different from its browser toolchain.
`package.json:82-97` selects Electron 43.2.0, electron-builder 26.15.3, Vite
8.0.16, Vitest 4.1.10, and Playwright 1.62.0. `electron/main.ts:867-888`
starts the Profile owner with Electron `utilityProcess.fork`; the utility and
`electron/sqliteRuntime.ts:1-3` use Electron’s embedded `node:sqlite`.
`scripts/electron/profile-mcp-sea-after-pack.mjs:78-180` builds Node SEA
executables, injects them into copied Electron binaries, and signs them.
`docs/release/macos-signing.md:33-68,119-136` makes Apple signing/notarization
and exact-byte certification part of the release contract.

**Fact.** External first-party evidence used: Bun 1.4 release (GitHub, released
2026-08-20), Bun’s compatibility, Node-API, install/lockfile, debugger,
benchmarking, and security-policy pages (all accessed 2026-08-22), Bun’s
official 1.4 breaking-change ledger (opened 2026-04-02; reconciled to 1.4),
Node’s release/security pages, Electron 43/release-policy/process-model pages,
Vite/Vitest/Playwright requirements, Node-API/node-gyp contracts, GitHub
runner availability, and Apple notarization requirements (URLs listed below).

## Time horizon

**Fact. Now (0–12 months).** Bun 1.4 is new (the release ledger records its Node
compatibility target as Node 26.3.0 and `NODE_MODULE_VERSION` 147). The same
ledger says native addons built for Node 24 must be rebuilt, Bun lockfile v2
cannot be read by older Bun, and `node:sqlite` is an additive 1.4 feature.
However, the compatibility page retrieved on 2026-08-22 still marks
`node:sqlite` unimplemented and `node:inspector` partial against its documented
Node v23 comparison. That version skew is itself a maintenance signal: do not
interpret “implemented” as Eido-certified parity.

**Fact.** Bun can read `package-lock.json` and write `bun.lock`; its installer
has a frozen-lockfile mode, global cache, and an official `oven-sh/setup-bun@v2`
action. **Inference.** The low-risk value is a disposable **package-manager**
canary. The risk is
that Bun intentionally does not run arbitrary dependency lifecycle scripts
unless named in `trustedDependencies`, while this lock has install-script
packages (`package-lock.json:10,5118-5123,5672,8425`). Electron’s binary
download and native packaging must be proven, not assumed. Keep npm and the
Node guard authoritative during this canary.

**Recommendation.** Do not replace Eido’s shipped runtime now. Electron 43.2.0 embeds Node 24.18.0
and its main/utility process contract is Node-integrated; Bun cannot provide
Electron’s `app`, IPC, `utilityProcess`, SEA injection, or the existing
`node:sqlite`/Profile behavior. Replacing it with a Bun child would be a new
packaging and security architecture, not a runtime toggle.

**Recommendation (1–2 years).** If a two-platform CI canary is green across install, Vite build,
Vitest, Playwright, unpacked Electron smoke, and signed macOS certification,
Bun may become an optional developer/CI installer and perhaps a script runner
for pure, non-Electron maintenance tasks. Keep Vite, Vitest, Playwright,
Electron/electron-builder, Node 24 for packaging, and the Node `node:sqlite`
Profile owner as the authoritative seams. Vite explicitly requires Node
20.19+/22.12+; Vitest 4 requires Vite 6+ and Node 20+; Playwright’s current
system requirements name Node 22/24/26 and its Node.js runner. Those are
positive Node support statements, not Bun runtime support statements.

**Inference.** Replacing Vite with `bun build` or Vitest with `bun:test` would create a second
plugin/test semantic model (mocking, jsdom, coverage, snapshots, source maps)
for little product benefit. Bun’s WebKit Inspector and `.cpuprofile` output
are useful for Bun-only scripts, but its compatibility page says V8 serialization
uses JavaScriptCore’s wire format and inspector coverage is partial. Eido’s
renderer and Electron profiling should remain in the Chromium/V8 tool family.

**Inference (5+ years).** Bun could mature into a useful standard for standalone services,
but a whole-stack replacement would couple Eido to Bun’s Zig/JavaScriptCore
implementation, release-specific compatibility, lockfile semantics, and
single-vendor support contract. Node’s LTS schedule gives overlapping supported
lines and Node-API’s stable ABI; Bun’s security policy supports “1.x.x” and
promises a five-day acknowledgement but states no LTS window or support SLA.
That is not evidence Bun is insecure; it is a narrower lifecycle contract and
an inference that reversal/staffing risk is higher. Bun’s repository also says
its binary statically links JavaScriptCore/WebKit under LGPL-2, so shipping Bun
helpers adds a long-lived license/compliance review.

## Replacement/retain matrix

| Technology/seam | Decision | Why maintenance gets easier or harder |
|---|---|---|
| npm 11 + `package-lock.json` | **Pilot replacement only** | Potentially faster installs, one global Bun cache, and dependency lifecycle scripts blocked by default. Harder: a second lock format, `trustedDependencies`, registry/auth behavior, npm audit parity, and dual-lock drift. |
| Node 24 host for scripts/CI | **Retain as authority; optional Bun shadow lane** | Node has broad staffing/ecosystem and LTS/security continuity. Bun can run many Node packages, but its compatibility table is version-sensitive and Bun 1.4 changes Node/native targets. |
| Vite/Rolldown build | **Retain** | Eido depends on Vite plugins, manual chunks, four Electron CJS modes, and externalization (`vite.electron.config.ts:5-63`). Bun’s bundler is a different contract; no Eido proof exists. |
| Vitest + Playwright | **Retain** | Existing tests/configs and Playwright browser/trace workflows are mature. Bun test migration would duplicate semantics; Playwright documents Node, not Bun, as its supported JS runner. |
| Electron 43 + embedded Node/Chromium | **Retain** | Electron’s process model, utility process, IPC, updater, fuses, and Chromium UI are product architecture. Bun cannot replace this without a new app shell. |
| `node:sqlite`, Node-API, node-gyp, SEA | **Retain** | Node-API is ABI-stable only when used exclusively; node-gyp documents separate Electron headers. Bun implements much of Node-API, but 1.4 explicitly requires rebuilding Node-24 native addons. |
| GitHub Actions | **Retain; add setup-bun only to canary** | Hosted macOS arm64 and Windows x64 exist, but arm64 macOS has no static UDID and community actions may need runtime fixes. Existing SHA-pinned Actions and cache policy are valuable supply-chain controls. |
| Apple codesign/notarytool/Gatekeeper | **Retain** | Apple requires signed executables, Developer ID, hardened runtime, secure timestamp, and notarization. A Bun helper increases the signed-binary set; it removes none of that work. |

## Migration and rollback shapes

1. **Recommendation — shadow install:** in a disposable worktree, run Bun 1.4
   with `bun.lock` and `bun ci`, but continue running Node/npm scripts and the
   existing CI gate. Compare package trees, lifecycle outputs, Vite artifacts,
   Electron downloads, Playwright browsers, and audit results on Ubuntu,
   macOS arm64, and Windows x64. Do not commit a second lockfile until the
   comparison is repeatable.
2. **Narrow adoption:** if green, use Bun only for local/CI installation or
   explicitly pure scripts. Keep `package-lock.json`, Node provenance, and
   release scripts unchanged; no Profile/schema migration is allowed.
3. **Full replacement:** only after an independently certified Bun-built
   Electron package, native helper matrix, macOS notarization, and rollback
   artifact. This is a new architecture decision, not an optimization PR.

**Recommendation.** Rollback is cheap only before lock/runtime authority changes: remove `bun.lock`
and `bunfig.toml`, restore `package-lock.json` from the known-good commit, and
rerun `npm ci`. Never “repair” the npm lock by running Bun in place. A planning
estimate (not measured) is 3–7 engineer-days for the package-manager canary,
10–20 if lifecycle/native remediation is needed, and 20–50 for full test/build/
runtime replacement plus two-platform certification. No product-latency gain
should be expected. If install is 20–40% of the required gate and Bun cuts only
that stage by 50–90%, the conditional total-gate saving is roughly 10–36%; the
repository contains no timing baseline, so this is an estimate, not a claim.

## Failure cases, uncertainty, implications

**Fact.** Known failure classes include native-addon load/rebuild errors after Bun’s Node
26.3 target change; older-Bun rollback failure on lockfile v2; suppressed
dependency install scripts; and cross-platform signing/SEA failures if a Bun
executable is added. Bun’s official tracker records a 1.4 `Bun.build` regression
 (issue [#32686](https://github.com/oven-sh/bun/issues/32686), opened 2026-06-25)
 and a test-time `setSystemTime()` leak (issue
 [#32793](https://github.com/oven-sh/bun/issues/32793), opened 2026-06-26);
these are upstream incidents, not Eido failures. The biggest unresolved gap is
an Eido disposable pilot:
we do not know whether this dependency tree’s lifecycle scripts, Vite plugins,
Vitest/jsdom, Playwright Electron driver, or electron-builder are actually
green under Bun 1.4. Staffing/bus-factor conclusions are inferences, not
measured labor data.

**Recommendation:** adopt Bun 1.4 only as a reversible package-manager/CI
experiment with Node, npm lock provenance, Vite, Vitest, Playwright, Electron,
Node-API/SEA, SQLite, GitHub Actions, and Apple signing deliberately retained.
Revisit a broader runtime decision only when Bun’s compatibility documentation,
native ABI behavior, and Eido’s paired packaging evidence converge.

## Sources (first-party, accessed 2026-08-22 unless dated)

- [Bun v1.4 release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.0), released 2026-08-20; [Bun 1.4 breaking changes](https://github.com/oven-sh/bun/issues/28792), opened 2026-04-02.
- [Bun Node compatibility](https://bun.sh/docs/runtime/nodejs-compat); [Node-API](https://bun.sh/docs/runtime/node-api); [install/CI](https://bun.sh/docs/pm/cli/install); [lockfile](https://bun.sh/docs/pm/lockfile); [debugger](https://bun.sh/docs/runtime/debugger); [benchmarking](https://bun.sh/docs/project/benchmarking); [security policy](https://github.com/oven-sh/bun/security/policy); [license](https://github.com/oven-sh/bun/blob/main/LICENSE.md).
- [Node release schedule](https://nodejs.org/en/about/previous-releases); [Node 24 LTS, 2025-10-28](https://nodejs.org/en/blog/release/v24.11.0); [security reporting](https://nodejs.org/en/about/security-reporting); [2026-06-18 security release](https://nodejs.org/en/blog/vulnerability/june-2026-security-releases).
- [Electron release policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines); [Electron 43, 2026-07-02](https://www.electronjs.org/blog/electron-43-0); [Electron 43.2.0, 2026-07-21](https://releases.electronjs.org/release/v43.2.0); [process model](https://www.electronjs.org/docs/latest/tutorial/process-model); [utility process](https://www.electronjs.org/docs/latest/api/utility-process); [security](https://www.electronjs.org/docs/latest/tutorial/security).
- [Vite requirements](https://vite.dev/guide/); [Vitest 4 requirements](https://v4.vitest.dev/guide/); [Playwright installation/system requirements](https://playwright.dev/docs/intro); [Playwright browser lifecycle](https://playwright.dev/docs/browsers).
- [Node-API ABI contract](https://nodejs.org/api/n-api.html); [node-gyp README and Electron headers](https://github.com/nodejs/node-gyp).
- [GitHub-hosted runner availability](https://docs.github.com/en/actions/reference/runners/github-hosted-runners); [official setup-bun action](https://github.com/oven-sh/setup-bun/blob/main/README.md).
- [Apple notarization requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution); [Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates).
