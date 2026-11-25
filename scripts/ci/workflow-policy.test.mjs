import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CERTIFICATION_PROFILE_RUNTIME_PATHS,
  NATIVE_DESKTOP_PROOF_GATE_JOBS,
  NATIVE_DESKTOP_PROOF_WORKFLOW,
  isProfileRuntimePath,
} from '../certification/certification-manifest.mjs'
import { NATIVE_DESKTOP_PROOF_MATRIX, desktopProofMatrix } from './desktop-proof-scope.mjs'
import {
  inspectRequiredGate,
  inspectWorkflow,
  inspectWorkflowSyntax,
  jobSourceByName,
  validateWorkflowDirectory,
  workflowJobs,
  workflowTriggers,
} from './workflow-policy.mjs'

const browserCanaryWorkflow = readFileSync(
  new URL('../../.github/workflows/browser-canary.yml', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n')
const ciWorkflow = readFileSync(
  new URL('../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n')

const desktopProofWorkflow = readFileSync(
  new URL('../../.github/workflows/desktop-proof.yml', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n')
const nativeGatewayProofRunner = readFileSync(
  new URL('../electron/profile-live-gateway-native-proof.mjs', import.meta.url),
  'utf8',
)
const nativeGatewayHelperTest = readFileSync(
  new URL('../electron/profile-live-gateway-helper.test.mjs', import.meta.url),
  'utf8',
)
const nativeGatewayDeploymentTest = readFileSync(
  new URL('../electron/profile-live-gateway-helper-deployment.test.mjs', import.meta.url),
  'utf8',
)
const nativeGatewayServerTest = readFileSync(
  new URL('../../electron/profileLiveGatewayServer.test.ts', import.meta.url),
  'utf8',
)
const maintenanceWorkflow = readFileSync(
  new URL('../../.github/workflows/maintenance.yml', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n')
// The one literal. It is not restated here: restating it is exactly how the
// fingerprint set and the trigger set drifted 68 paths apart.
const desktopProofPaths = CERTIFICATION_PROFILE_RUNTIME_PATHS
function workflowStep(source, name) {
  const marker = `      - name: ${name}\n`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `missing workflow step: ${name}`)
  const next = source.indexOf('\n      - name: ', start + marker.length)
  return source.slice(start, next === -1 ? source.length : next).trimEnd()
}

function workflowJob(source, id) {
  const marker = `  ${id}:\n`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `missing workflow job: ${id}`)
  const remainder = source.slice(start + marker.length)
  const nextJobOffset = remainder.search(/^  [A-Za-z0-9_-]+:\n/m)
  const end = nextJobOffset === -1
    ? source.length
    : start + marker.length + nextJobOffset
  return source.slice(start, end).trimEnd()
}

function workflowPathFilters(source) {
  const lines = source.split('\n')
  const filters = []
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== '    paths:') continue
    const paths = []
    for (index += 1; index < lines.length; index += 1) {
      const match = /^      - '([^']+)'$/.exec(lines[index])
      if (!match) {
        index -= 1
        break
      }
      paths.push(match[1])
    }
    filters.push(paths)
  }
  return filters
}

test('reads block and inline workflow triggers', () => {
  assert.deepEqual(workflowTriggers(`name: CI
on:
  pull_request:
  workflow_dispatch:
jobs: {}
`), ['pull_request', 'workflow_dispatch'])
  assert.deepEqual(workflowTriggers('name: CI\non: [push, workflow_dispatch]\njobs: {}\n'), ['push', 'workflow_dispatch'])
})

test('experimental evidence is manual-only and distinctly named', () => {
  const source = `name: Image rendition candidate evidence
on:
  push:
    branches: [feature]
  workflow_dispatch:
jobs:
  evidence:
    name: Image rendition candidate evidence (non-blocking)
`
  assert.deepEqual(inspectWorkflow(source, 'candidate.yml'), [
    'candidate.yml: experimental workflows must start with "# ci-class: experimental"',
    'candidate.yml: experimental workflows cannot auto-run via push',
    'candidate.yml: every experimental job name must end with " (experimental)"',
  ])
})

test('a manual experimental workflow satisfies policy', () => {
  const source = `# ci-class: experimental
name: Rendering study
on:
  workflow_dispatch:
jobs:
  evidence:
    name: Rendering study (experimental)
`
  assert.deepEqual(inspectWorkflow(source), [])
})

test('baseline evidence is recognized even before an author adds the marker', () => {
  const source = `name: Rich Card baseline evidence
on:
  push:
jobs:
  evidence:
    name: Rich Card baseline evidence (non-blocking)
`
  assert.equal(inspectWorkflow(source).length, 4)
})

test('every experimental job must be explicitly named', () => {
  const source = `# ci-class: experimental
name: Rendering study
on:
  workflow_dispatch:
jobs:
  named:
    name: Named proof (experimental)
  unnamed:
    runs-on: ubuntu-latest
`
  assert.deepEqual(workflowJobs(source), [
    { id: 'named', name: 'Named proof (experimental)' },
    { id: 'unnamed', name: '' },
  ])
  assert.deepEqual(inspectWorkflow(source), [
    'workflow.yml: every experimental job name must end with " (experimental)"',
  ])
})

test('ordinary required and canary workflows are unaffected', () => {
  const source = `name: Browser canary
on:
  pull_request:
  schedule:
jobs:
  browser:
    name: Browser interactions
`
  assert.deepEqual(inspectWorkflow(source), [])
})

test('scheduled maintenance keeps dependency audit automatic and release checks manual-only', () => {
  assert.deepEqual(workflowTriggers(maintenanceWorkflow), ['schedule', 'workflow_dispatch'])

  const dependencyAudit = workflowJob(maintenanceWorkflow, 'dependency-audit')
  const releaseMaintenance = workflowJob(maintenanceWorkflow, 'release-maintenance-checks')

  assert.doesNotMatch(dependencyAudit, /^    if:/m)
  assert.match(
    releaseMaintenance,
    /^    if: github\.event_name == 'workflow_dispatch'$/m,
  )
  assert.match(dependencyAudit, /run: npm audit --audit-level=high/)
  assert.match(releaseMaintenance, /run: node scripts\/release\/maintenance-checks\.mjs run/)
})

test('native desktop proof is exact-head, path-scoped, and retained on supported runners', () => {
  const nativeJob = workflowJobs(desktopProofWorkflow)[1]
  assert.deepEqual(workflowTriggers(desktopProofWorkflow), ['pull_request', 'push', 'workflow_dispatch'])
  assert.deepEqual(workflowJobs(desktopProofWorkflow), [
    { id: 'scope', name: 'Native desktop proof scope' },
    {
      id: 'native',
      name: 'Native desktop proof — ${{ matrix.runner }} (${{ matrix.arch }})',
    },
  ])
  assert.deepEqual(inspectWorkflow(desktopProofWorkflow, 'desktop-proof.yml'), [])
  assert.match(desktopProofWorkflow, /permissions:\n  contents: read\n/)
  // The matrix is built by the scope job, so the legs are asserted there and
  // the workflow only has to consume them.
  assert.match(desktopProofWorkflow, /runs-on: \$\{\{ matrix\.host \}\}\n    timeout-minutes: 20/)
  assert.match(desktopProofWorkflow, /matrix: \$\{\{ fromJSON\(needs\.scope\.outputs\.matrix\) \}\}/)
  assert.doesNotMatch(desktopProofWorkflow, /macos-15|windows-2025/)
  assert.deepEqual(NATIVE_DESKTOP_PROOF_MATRIX, [
    { runner: 'macos-15', platform: 'darwin', arch: 'arm64' },
    { runner: 'windows-2025', platform: 'win32', arch: 'x64' },
  ])
  assert.match(desktopProofWorkflow, /EIDO_DESKTOP_PROOF_TESTED_SHA: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/)
  assert.match(desktopProofWorkflow, /EIDO_DESKTOP_PROOF_HEAD_SHA: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/)
  assert.match(desktopProofWorkflow, /EIDO_DESKTOP_PROOF_BASE_SHA: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.base\.sha \|\| github\.event_name == 'push' && github\.event\.before \|\| '' \}\}/)
  assert.match(desktopProofWorkflow, /ref: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/)
  assert.match(desktopProofWorkflow, /node-version-file: \.github\/node-version/)
  assert.match(desktopProofWorkflow, /run: npm ci --no-audit --no-fund/)
  const liveGatewaySecurity = workflowStep(
    desktopProofWorkflow,
    'Exercise the native Live Gateway security seam',
  )
  assert.match(
    liveGatewaySecurity,
    /run: node scripts\/electron\/profile-live-gateway-native-proof\.mjs/,
  )
  assert.match(
    workflowStep(desktopProofWorkflow, 'Compile the macOS eido command offer'),
    /if: needs\.scope\.outputs\.in_scope == 'true' && matrix\.platform == 'darwin'[\s\S]*run: npx vitest run electron\/eidoCommandInstaller\.test\.ts/,
  )
  assert.match(desktopProofWorkflow, /EIDO_DESKTOP_PROOF_EXPECTED_PLATFORM: \$\{\{ matrix\.platform \}\}/)
  assert.match(desktopProofWorkflow, /EIDO_DESKTOP_PROOF_EXPECTED_ARCH: \$\{\{ matrix\.arch \}\}/)
  assert.match(desktopProofWorkflow, /run: node scripts\/ci\/native-desktop-proof\.mjs/)
  assert.match(desktopProofWorkflow, /run: npm run desktop:smoke/)
  assert.match(
    workflowStep(desktopProofWorkflow, 'Run the fresh unpacked desktop proof'),
    /EIDO_DESKTOP_PROOF_OS_USER_SCOPE: \$\{\{ runner\.environment \}\}/,
  )
  assert.match(
    desktopProofWorkflow,
    /path: \.local\/electron-shell\/proof-evidence\.json/,
  )
  assert.match(desktopProofWorkflow, /if-no-files-found: error\n          retention-days: 3/)

  for (const path of desktopProofPaths) {
    assert.equal(desktopProofWorkflow.match(new RegExp(`- '${path.replaceAll('*', '\\*')}'`, 'g'))?.length, 1, path)
  }

  for (const action of [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
    'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0',
    'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1',
  ]) {
    assert.equal(desktopProofWorkflow.includes(action), true, action)
  }
  for (const signingGuard of [
    '          CSC_LINK: ${{ runner.temp }}/eido-proof-must-ignore-csc.pfx',
    '          CSC_NAME: Eido proof must ignore ambient identity',
    '          CSC_KEY_PASSWORD: must-not-be-used',
    '          WIN_CSC_LINK: ${{ runner.temp }}/eido-proof-must-ignore-win-csc.pfx',
    '          WIN_CSC_KEY_PASSWORD: must-not-be-used',
  ]) {
    assert.equal(desktopProofWorkflow.includes(signingGuard), true, signingGuard)
  }

  const releaseGates = JSON.parse(readFileSync(
    new URL('../../docs/agents/release-gates.json', import.meta.url),
    'utf8',
  ))
  const nativeGate = releaseGates.conditionalGates.find(({ id }) => id === 'native-desktop-proof')
  const expectedChecks = NATIVE_DESKTOP_PROOF_MATRIX.map(({ runner, arch }) => nativeJob.name
    .replace('${{ matrix.runner }}', runner)
    .replace('${{ matrix.arch }}', arch))
  // One literal, three consumers. The fingerprint decides what the gate is
  // for; release-gates.json publishes it to the merge captain; the push filter
  // spends native minutes on it.
  assert.deepEqual(nativeGate.pathPatterns, [...desktopProofPaths])
  assert.deepEqual(workflowPathFilters(desktopProofWorkflow), [[...desktopProofPaths]])
  assert.deepEqual(nativeGate.checks, expectedChecks)
  assert.deepEqual(expectedChecks, [...NATIVE_DESKTOP_PROOF_GATE_JOBS])
  assert.equal(nativeGate.mainWorkflow, NATIVE_DESKTOP_PROOF_WORKFLOW)
  assert.doesNotMatch(JSON.stringify(nativeGate), /\u00e2\u20ac\u201d/)
})

test('native Gateway proof reports progress and keeps compilers out of Vitest hooks', () => {
  assert.match(nativeGatewayProofRunner, /'--reporter=verbose'/)
  assert.match(
    nativeGatewayProofRunner,
    /for \(const proof of NATIVE_VITEST_PROOFS\) \{[\s\S]*await runBoundedNativeBuild\([\s\S]*proof\.file/,
  )
  assert.doesNotMatch(nativeGatewayHelperTest, /spawnSync\('taskkill'/)
  assert.doesNotMatch(
    nativeGatewayHelperTest,
    /Profile Live Gateway Windows native proof build/,
  )
  assert.doesNotMatch(
    nativeGatewayServerTest,
    /Profile Live Gateway server native helper build/,
  )
  for (const nativeBehaviorTest of [
    nativeGatewayHelperTest,
    nativeGatewayDeploymentTest,
    nativeGatewayServerTest,
  ]) {
    assert.doesNotMatch(
      nativeBehaviorTest,
      /(?:spawnSync|execFileSync|buildProfileLiveGatewayHelper)\(/,
    )
  }
})

test('Darwin-only native Gateway scenarios never enter the Windows host proof', () => {
  assert.match(
    nativeGatewayServerTest,
    /const macNativeDesktopIt = it\.runIf\(\s*process\.platform === 'darwin'[\s\S]*?Boolean\(nativeHelperPath\)[\s\S]*?\)/,
  )
  assert.match(
    nativeGatewayServerTest,
    /macNativeDesktopIt\(\s*'withdraws a crashed helper without escalating the optional transport failure'/,
  )
})

test('the one path list is sorted, unique, and equivalent to the fingerprint rule', () => {
  assert.deepEqual([...desktopProofPaths], [...desktopProofPaths].toSorted())
  assert.equal(new Set(desktopProofPaths).size, desktopProofPaths.length)

  // A prefix entry is a superset in the trigger and a filtered rule in the
  // fingerprint. That direction is the safe one: a test-only edit can spend a
  // proof run the fingerprint did not need, but nothing can move the
  // fingerprint without also triggering the proof.
  for (const entry of desktopProofPaths) {
    if (entry.endsWith('/**')) {
      const directory = entry.slice(0, -3)
      assert.equal(isProfileRuntimePath(`${directory}/runtime.ts`), true, entry)
      assert.equal(isProfileRuntimePath(`${directory}/nested/runtime.ts`), true, entry)
      assert.equal(isProfileRuntimePath(`${directory}/runtime.test.ts`), false, entry)
      assert.equal(isProfileRuntimePath(`${directory}/runtime.bench.ts`), false, entry)
      assert.equal(isProfileRuntimePath(`${directory}/runtime.perf.mjs`), false, entry)
      continue
    }
    assert.equal(isProfileRuntimePath(entry), true, entry)
  }
  assert.equal(isProfileRuntimePath('src/canvas/Board.tsx'), false)
  assert.equal(isProfileRuntimePath('docs/agents/packaged-certification.md'), false)
})

test('both native gate checks report a conclusion on every pull request', () => {
  // A required check that does not report leaves a pull request pending
  // forever. The pull_request trigger therefore carries no path filter, and
  // the scope job decides whether the matrix does real work.
  const [beforePush] = desktopProofWorkflow.split('\n  push:\n')
  assert.match(beforePush, /^ {2}pull_request:\n {4}types: \[opened, synchronize, reopened, ready_for_review\]\n/m)
  assert.doesNotMatch(beforePush, /^ {4}paths:$/m)
  assert.match(desktopProofWorkflow, /^ {2}push:\n {4}branches: \[main\]\n {4}paths:$/m)

  const scope = workflowJob(desktopProofWorkflow, 'scope')
  assert.match(scope, /runs-on: ubuntu-24\.04/)
  assert.match(scope, /fetch-depth: 0/)
  assert.match(scope, /run: node scripts\/ci\/desktop-proof-scope\.mjs/)
  assert.match(scope, /in_scope: \$\{\{ steps\.decide\.outputs\.in_scope \}\}/)
  assert.match(scope, /matrix: \$\{\{ steps\.decide\.outputs\.matrix \}\}/)

  // Both legs exist in both states, so both check names always report. Only the
  // host they land on changes.
  for (const inScope of [true, false]) {
    assert.deepEqual(
      desktopProofMatrix(inScope).include.map((leg) => [leg.runner, leg.arch, leg.host]),
      [
        ['macos-15', 'arm64', inScope ? 'macos-15' : 'ubuntu-24.04'],
        ['windows-2025', 'x64', inScope ? 'windows-2025' : 'ubuntu-24.04'],
      ],
    )
  }

  // Out of scope the job still exists, still reports, and does nothing: every
  // step that could cost a native minute is guarded.
  const native = workflowJob(desktopProofWorkflow, 'native')
  assert.match(native, /needs: scope/)
  const [, explainSkippedProof, ...proofSteps] = native.split('\n      - name: ')
  assert.match(explainSkippedProof, /if: needs\.scope\.outputs\.in_scope != 'true'/)
  assert.ok(proofSteps.length > 0)
  for (const step of proofSteps) {
    assert.match(step, /^ {8}if: needs\.scope\.outputs\.in_scope == 'true'/m)
  }
})

test('the browser interaction suite is blocking, always reports, and keeps nightly advisory', () => {
  assert.deepEqual(workflowJobs(browserCanaryWorkflow), [
    { id: 'pr-smoke', name: 'Browser interactions' },
    { id: 'nightly', name: 'Browser nightly ${{ matrix.shard }}/4 (non-blocking)' },
  ])
  assert.deepEqual(workflowTriggers(browserCanaryWorkflow), ['pull_request', 'schedule', 'workflow_dispatch'])
  // No path filter, so the check reports on every pull request and can be
  // required. Advisory framing is gone from the pull-request job only.
  assert.deepEqual(workflowPathFilters(browserCanaryWorkflow), [])
  const prSmoke = workflowJob(browserCanaryWorkflow, 'pr-smoke')
  assert.doesNotMatch(prSmoke, /non-blocking/)
  assert.match(prSmoke, /fetch-depth: 0/)
  assert.match(prSmoke, /run: node scripts\/ci\/marketing-site-scope\.mjs/)
  assert.match(
    workflowStep(browserCanaryWorkflow, 'Report why app interactions are not needed'),
    /if: steps\.scope\.outcome == 'success' && steps\.scope\.outputs\.marketing_only == 'true'/,
  )
  for (const stepName of [
    'Install locked dependencies',
    'Install Chromium',
    'Verify app startup before interactions',
    'Run focused PR smoke',
  ]) {
    assert.match(
      workflowStep(browserCanaryWorkflow, stepName),
      /if: steps\.scope\.outcome != 'success' \|\| steps\.scope\.outputs\.marketing_only != 'true'/,
      stepName,
    )
  }
  assert.match(prSmoke, /run: npm run test:browser:smoke/)
  assert.match(prSmoke, /run: npm run test:browser:production/)
  assert.match(workflowJob(browserCanaryWorkflow, 'nightly'), /\(non-blocking\)/)
})

test('the required workflow always reports one aggregate around the selected lane', () => {
  assert.deepEqual(workflowTriggers(ciWorkflow), ['pull_request', 'push', 'workflow_dispatch'])
  assert.deepEqual(workflowJobs(ciWorkflow), [
    { id: 'scope', name: 'Required gate scope' },
    { id: 'site', name: 'Marketing site required lane' },
    { id: 'full', name: 'Full app required lane' },
    { id: 'required', name: 'Required gate' },
  ])
  assert.deepEqual(workflowPathFilters(ciWorkflow), [])

  const scope = workflowJob(ciWorkflow, 'scope')
  assert.match(scope, /fetch-depth: 0/)
  assert.match(scope, /run: node scripts\/ci\/marketing-site-scope\.mjs/)
  assert.match(
    workflowStep(ciWorkflow, 'Check the marketing site'),
    /run: node --test scripts\/ci\/site-static\.test\.mjs/,
  )
  assert.match(
    workflowStep(ciWorkflow, 'Run the canonical required gate'),
    /run: npm run ci:required/,
  )
  assert.match(
    workflowStep(ciWorkflow, 'Preserve green-main release candidate'),
    /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/,
  )
  assert.match(workflowJob(ciWorkflow, 'required'), /if: \$\{\{ always\(\) \}\}/)
})

test('Required lanes stay database-free and report one aggregate verdict', () => {
  assert.deepEqual(workflowJobs(ciWorkflow), [
    { id: 'scope', name: 'Required gate scope' },
    { id: 'site', name: 'Marketing site required lane' },
    { id: 'full', name: 'Full app required lane' },
    { id: 'required', name: 'Required gate' },
  ])

  const scope = workflowJob(ciWorkflow, 'scope')
  const site = workflowJob(ciWorkflow, 'site')
  const full = workflowJob(ciWorkflow, 'full')
  const required = workflowJob(ciWorkflow, 'required')

  for (const databaseFreeJob of [scope, site, full]) {
    assert.doesNotMatch(databaseFreeJob, /services:|postgres:17|EIDO_DISPOSABLE_POSTGRES_URL|EIDO_REQUIRE_POSTGRES_CANARIES/)
  }
  assert.match(site, /run: node --test scripts\/ci\/site-static\.test\.mjs/)
  assert.match(full, /run: npm run ci:required/)
  assert.match(required, /needs: \[scope, site, full\]/)
  assert.match(required, /if: \$\{\{ always\(\) \}\}/)
  assert.match(required, /- name: Enforce selected required lane/)
})

test('scope classifier step failures stay diagnostic and fail open to full CI', () => {
  const requiredClassifier = workflowStep(ciWorkflow, 'Select the proportionate CI lane')
  assert.match(requiredClassifier, /continue-on-error: true/)
  assert.match(
    workflowJob(ciWorkflow, 'scope'),
    /classifier_outcome: \$\{\{ steps\.scope\.outcome \}\}/,
  )
  assert.match(
    workflowStep(ciWorkflow, 'Report scope-classifier fallback'),
    /if: \$\{\{ always\(\) && steps\.scope\.outcome == 'failure' \}\}[\s\S]*::warning::[\s\S]*GITHUB_STEP_SUMMARY/,
  )
  assert.match(
    workflowJob(ciWorkflow, 'site'),
    /if: \$\{\{ needs\.scope\.result == 'success' && needs\.scope\.outputs\.classifier_outcome == 'success' && needs\.scope\.outputs\.marketing_only == 'true' \}\}/,
  )
  assert.match(
    workflowJob(ciWorkflow, 'full'),
    /if: \$\{\{ always\(\) && \(needs\.scope\.result != 'success' \|\| needs\.scope\.outputs\.classifier_outcome != 'success' \|\| needs\.scope\.outputs\.marketing_only != 'true'\) \}\}/,
  )

  const browserClassifier = workflowStep(browserCanaryWorkflow, 'Select the proportionate CI lane')
  assert.match(browserClassifier, /continue-on-error: true/)
  assert.match(
    workflowStep(browserCanaryWorkflow, 'Report scope-classifier fallback'),
    /if: \$\{\{ always\(\) && steps\.scope\.outcome == 'failure' \}\}[\s\S]*::warning::[\s\S]*GITHUB_STEP_SUMMARY/,
  )
  for (const stepName of [
    'Install locked dependencies',
    'Install Chromium',
    'Verify app startup before interactions',
    'Run focused PR smoke',
  ]) {
    assert.match(
      workflowStep(browserCanaryWorkflow, stepName),
      /if: steps\.scope\.outcome != 'success' \|\| steps\.scope\.outputs\.marketing_only != 'true'/,
      stepName,
    )
  }
  assert.match(
    workflowStep(browserCanaryWorkflow, 'Run production interaction regression'),
    /\(steps\.scope\.outcome != 'success' \|\| steps\.scope\.outputs\.marketing_only != 'true'\)/,
  )
})
const requiredWorkflow = readFileSync(
  new URL('../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n')

test('the shipped required workflow preserves the branch-protected aggregate', () => {
  assert.deepEqual(inspectRequiredGate(requiredWorkflow), [])
})

test('marking a required step continue-on-error fails policy', () => {
  const tolerant = requiredWorkflow.replace(
    /^(\s*)- name: Run the canonical required gate$/m,
    '$1- name: Run the canonical required gate\n$1  continue-on-error: true',
  )
  const issues = inspectRequiredGate(tolerant)
  assert.equal(issues.length, 1)
  assert.match(issues[0], /continue-on-error/)
})

test('the full-app required lane must retain its required name', () => {
  const elsewhere = requiredWorkflow
    .replace(/^ {4}name: Full app required lane$/m, '    name: Some other job')
  const issues = inspectRequiredGate(elsewhere)
  assert.equal(issues.length, 1)
  assert.match(issues[0], /no job is named "Full app required lane"/)
})

test('switching the required aggregate off with a condition fails policy', () => {
  const conditional = requiredWorkflow.replace(
    /^ {4}if: \$\{\{ always\(\) \}\}$/m,
    '    if: false',
  )
  const issues = inspectRequiredGate(conditional)
  assert.equal(issues.length, 1)
  assert.match(issues[0], /Required gate aggregate must use/)
})

test('one job\'s text never leaks into another job\'s check', () => {
  const job = jobSourceByName(requiredWorkflow, 'Full app required lane')
  assert.ok(job.includes('run: npm run ci:required'))
  assert.ok(!job.includes('jobs:'))
  assert.equal(jobSourceByName(requiredWorkflow, 'Nothing named this'), undefined)
})

test('the workflow directory scan actually applies the required-gate checks', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'eido-workflow-policy-'))
  writeFileSync(join(directory, 'ci.yml'), requiredWorkflow)
  assert.deepEqual(await validateWorkflowDirectory(directory), [])

  writeFileSync(
    join(directory, 'ci.yml'),
    requiredWorkflow.replace(/^ {4}name: Full app required lane$/m, '    name: Renamed lane'),
  )
  const issues = await validateWorkflowDirectory(directory)
  assert.equal(issues.length, 1)
  assert.match(issues[0], /no job is named "Full app required lane"/)
})

test('a workflow that YAML cannot parse is caught here, not by a check that never reports', async () => {
  // This is not hypothetical. An unquoted `run: echo "... work: $REASON"` made
  // the whole desktop-proof file unparseable. GitHub created a run named after
  // the file path, built no jobs, produced no annotation, and both required
  // native checks simply never appeared on the pull request.
  const broken = [
    'name: Example',
    'jobs:',
    '  one:',
    '    steps:',
    '      - name: Say why',
    '        run: echo "passes without native work: $SCOPE_REASON"',
  ].join('\n')
  assert.deepEqual(inspectWorkflowSyntax(broken, 'broken.yml'), [
    'broken.yml:6: plain scalar value contains ": ", which makes the file unparseable. '
      + 'Quote it or use a block scalar.',
  ])

  // The three ways to write the same line correctly are all accepted, and so
  // is every workflow in the repository.
  const fine = [
    'name: Example',
    'jobs:',
    '  one:',
    '    steps:',
    '      - name: Native desktop proof — ${{ matrix.runner }} (${{ matrix.arch }})',
    '        if: needs.scope.outputs.in_scope != \'true\'',
    '        run: |',
    '          echo "passes without native work: $SCOPE_REASON"',
    '          # a comment: with a colon',
    "        working-directory: 'a: b'",
    '        shell: bash',
  ].join('\n')
  assert.deepEqual(inspectWorkflowSyntax(fine, 'fine.yml'), [])

  // And the gate that runs on every pull request actually applies it. Checking
  // only that the repository is currently clean would pass even if the gate
  // never looked.
  const directory = await mkdtemp(path.join(os.tmpdir(), 'eido-workflow-policy-'))
  try {
    await writeFile(path.join(directory, 'broken.yml'), broken, 'utf8')
    await writeFile(path.join(directory, 'fine.yml'), fine, 'utf8')
    const issues = await validateWorkflowDirectory(directory)
    assert.equal(issues.length, 1, issues.join('\n'))
    assert.match(issues[0], /broken\.yml:6: plain scalar value contains/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  assert.deepEqual(await validateWorkflowDirectory('.github/workflows'), [])
})
