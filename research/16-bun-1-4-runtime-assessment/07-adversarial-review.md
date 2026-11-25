# Adversarial review of the synthesis

The retention boundary is directionally supported, but the brief is not quantitative enough to call the installer canary “worth considering,” and some experiments are internally inconsistent. The highest unresolved issue is no Eido install/CI baseline combined with no reproducible lock/provenance shape for the shadow install.

## Findings

### 1. High — the canary is not reproducible as specified

**Synthesis location:** lines 9, 29, 111–118; especially “Do not commit `bun.lock`” and “run a disposable Bun 1.4 shadow install.”

**Evidence:** Bun reads `package-lock.json` but writes `bun.lock` (`05-lifecycle-tradeoffs.md:45–53`), and the proposed `bun ci` flow uses that lock (`05:104–109`). The repository treats `package-lock.json` and npm execution as policy (`01:27–28`; `05:9–14`). An uncommitted generated lock cannot prove repeatability or provenance; Node/npm gates only prove one resulting `node_modules` tree executes.

**Correction needed:** Keep npm authority, but persist the exact Bun version, generated lockfile, registry metadata, trust allowlist, and dependency-tree hash as artifacts (or in an isolated experiment branch). State whether comparison uses package-lock migration or frozen `bun.lock`; do not call an uncommitted lock reproducible.

### 2. High — “selected pure scripts” conflicts with Eido’s guard

**Synthesis location:** line 30 and the “selected pure scripts only” row.

**Evidence:** Every supported script enters `npm run ci:runtime`, and the guard checks npm’s user agent/executable (`01:27–28`; `05:9–14`). The stack lane explicitly says the guard fails under Bun. Thus `bun run existing-script` is not a low-risk post-canary seam; it is a policy failure unless the script is bypassed or the guard is changed.

**Correction needed:** Limit the recommendation to new, explicitly unguarded `bun <file>` probes, or name the policy exception and its audit consequences. Do not imply that existing guarded Eido commands can switch runners without policy work.

### 3. High — SQLite candidates are falsely grouped as one replacement

**Synthesis location:** line 37, “Bun `node:sqlite`, `bun:sqlite`, or `Bun.SQL`.”

**Evidence:** The capability lane describes three different contracts: synchronous `bun:sqlite`, promise-based pooled `Bun.SQL`, and the newly exposed `node:sqlite` (`02-bun-1-4-capabilities.md:19`). Only a basic `node:sqlite` create/insert/select probe ran; WAL, full-sync durability, CAS, backup, recovery, and locking remain untested (`03:23`; `04:15`). A `bun:sqlite` Northwind read claim cannot support `node:sqlite` or Eido write behavior.

**Correction needed:** Split the matrix into three candidates and treat only `node:sqlite` as an API-compatibility hypothesis. Mark driver performance and durability as unknown until the same synthetic revision-store fixture runs under the exact packaged process.

### 4. High — installer ROI is gated by an arbitrary percentage, not cost

**Synthesis location:** lines 9, 11, 59, 106, 111, and 115.

**Evidence:** The 50–90% estimate comes from Bun’s T3 fixture, not Eido; Eido absolute times are unmeasured (`03-performance-evidence.md:7,15`). The 15–20% CI-share threshold omits clean installs per developer, CI frequency, team size, and the 3–7/10–20 engineer-day estimates (`05:117–125`). A small gate reduction may repay for frequent CI, while a large clean-install reduction may repay onboarding.

**Correction needed:** Replace the fixed threshold with ROI: measured cold/warm minutes × annual install count and developer/CI value versus maintenance cost. Include npm-cache/CI tuning as a control arm.

### 5. Medium — signing/notarization makes the “reversible installer” canary costlier than necessary

**Synthesis location:** lines 9, 67, and 116–118.

**Evidence:** The canary ships no Bun executable and retains Node/Electron authority, yet asks for signing and notarization comparisons. Signing is an expensive contract (`05:21–24, 99–100`); the product artifact should be unchanged if trees and bundles are equivalent.

**Correction needed:** First compare lock/tree hashes, lifecycle outputs, Vite artifacts, unpacked Electron smoke, Playwright, and audit results. Sign/notarize only if outputs/native artifacts differ or a Bun binary is introduced. This lowers canary cost.

### 6. Medium — several numeric ranges are unsupported or ambiguously expressed

**Synthesis location:** lines 58–78, especially 61, 64–69, 75–78.

**Evidence:** No Eido Bun install, Vite, Vitest, Playwright, Electron, or SQLite benchmark ran (`06:120–124`; `03:3,19–25`). “0–1.5×” SQLite reads is ambiguous and conflicts with “no defensible percentage.” CLI startup, cold dev start, release slowdown, and memory/launch ranges also lack Eido baselines.

**Correction needed:** Use “unknown; measure” for unbenchmarked product ranges, or state the measured denominator and whether the number is latency, throughput, or wall time. Retain only the Amdahl-derived CI range once the install fraction is measured.

### 7. Medium — broad-migration app-install and release effects overstate certainty

**Synthesis location:** lines 58 and 67–69.

**Evidence:** “0–5% slower plus a larger signed artifact” and “5–20% slower due to a shadow lane” assume a specific artifact and serialized lane. A package-manager canary may alter native artifacts/tree size either way; a parallel lane may add cost without release wall time. No package-size or lane timing exists (`03:18–19`).

**Correction needed:** Bound the scope: recommended installer-only app latency is “unchanged if artifact equivalence passes”; release path is “0% unless serialized.” Treat size and certification effects as unknown until artifacts are compared.

### 8. Medium — the replacement map omits material named Vite seams

**Synthesis location:** lines 33, 46, and 49.

**Evidence:** The current inventory names `@vitejs/plugin-react` and the `storagePlugin`, `linkPreviewPlugin`, and `designTokensPlugin` (`01:11,21,30`). The synthesis says “React/Vite plugins” and “custom ... plugins” generically, but does not name these seams in the retain map. Those plugins provide middleware, virtual assets, and token generation; omitting them makes a future bundler comparison look smaller than it is.

**Correction needed:** Add the exact plugin names and their middleware/virtual-module roles to the replacement matrix, alongside `electron-updater`, Electron fuses, and postject already listed.

### 9. Medium — the evidence contains an unresolved Node-version contradiction

**Synthesis location:** line 30 and lines 35–37 (Node/SQLite authority rows).

**Evidence:** The current host authority is Node 24.12.0 (`01:9`), while the lifecycle lane says Electron 43.2.0 embeds Node 24.18.0 (`05:55–56`). Bun 1.4 targets Node 26.3.0 and changes native-addon expectations (`05:36–43`). Host scripts, Electron-embedded Node, and Bun compatibility are distinct version contracts.

**Correction needed:** Resolve and state all three versions in the synthesis; attach SQLite/native evidence to Electron’s embedded Node version, not the host Volta version. This may change rebuild and compatibility risk estimates.

### 10. Medium — the recommendation may be too conservative about a sidecar seam

**Synthesis location:** lines 35, 37, 73–78, and 113–118.

**Evidence:** Bun 1.4 reports `node:sqlite` passing 319 Node tests and the exact binary passed the basic probe (`02:19`; `03:23`). Electron main already owns routing and can delegate to a child; a synthetic Bun CLI/harness could preserve Profile authority while testing startup, streaming, cancellation, and serialization (`04:18–20,32`).

**Correction needed:** Keep the shipped authority unchanged, but make sidecar feasibility an independent conditional track—not a broad runtime migration and not dependent on install share. Measure a concrete CLI/harness workload; proceed only if its gain repays its packaging and cancellation proof cost.

## Bottom line

The “retain Electron/Node/Vite/Vitest/Playwright/SQLite authority” conclusion survives. The “installer canary” conclusion is conditional but currently under-specified: it needs reproducible lock artifacts, an ROI calculation, and staged certification gates. The review does not support replacing the shipped runtime, but it does support relaxing the synthesis from “installer is the only worthwhile seam” to “installer or a separately measured, non-authoritative sidecar may earn a canary.”
