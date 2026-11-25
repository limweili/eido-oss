import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

const modulePath = '.agents/skills/merge-captain/scripts'

function commandOnPath(command) {
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((value) => value.toLowerCase())
    : ['']
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(directory.replace(/^"|"$/g, ''), `${command}${extension}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

function cachedToolCandidates(command) {
  const cache = resolve('.local/toolchains')
  try {
    return readdirSync(cache, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${command}-`))
      .sort((left, right) => right.name.localeCompare(left.name))
      .flatMap((entry) => [
        join(cache, entry.name, process.platform === 'win32' ? `${command}.exe` : command),
        join(cache, entry.name, command),
      ])
  } catch {
    return []
  }
}

function requireTestTool(command, override, extraCandidates = []) {
  const selected = [
    process.env[override],
    commandOnPath(command),
    ...cachedToolCandidates(command),
    ...extraCandidates,
  ].find((candidate) => candidate && existsSync(candidate))
  assert.ok(
    selected,
    `${command} is required for Merge Captain tests; put it on PATH or set ${override} to its executable.`,
  )
  return resolve(selected)
}

const jqCommand = requireTestTool('jq', 'EIDO_TEST_JQ')
const bashCommand = requireTestTool('bash', 'EIDO_TEST_BASH', process.platform === 'win32' ? [
  process.env.ProgramFiles && join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
  process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
] : [])

function withTestTools(environment = process.env) {
  return {
    ...environment,
    PATH: [environment.PATH ?? '', dirname(jqCommand), dirname(bashCommand)]
      .filter(Boolean)
      .join(delimiter),
  }
}

function spawnBash(args, options = {}) {
  return spawnSync(bashCommand, args, {
    ...options,
    env: withTestTools(options.env),
  })
}

const localConditionalPolicyEnv = {
  MERGE_CAPTAIN_RELEASE_GATES_FILE: resolve('docs/agents/release-gates.json'),
  MERGE_CAPTAIN_ALLOW_LOCAL_POLICY_FOR_TESTS: '1',
  MERGE_CAPTAIN_PR_FILES_FROM_VIEW_FOR_TESTS: '1',
}

function classify(checks) {
  const result = spawnSync(
    jqCommand,
    ['-c', '-L', modulePath, 'include "checks-classifier"; {required: classify_checks, canary: classify_nonblocking_checks, experimental: classify_experimental_checks, genuine: has_genuine_required_failure}'],
    { encoding: 'utf8', input: JSON.stringify(checks) },
  )
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function classifyNamed(checks, names) {
  const result = spawnSync(
    jqCommand,
    [
      '-c',
      '-L',
      modulePath,
      '--argjson',
      'names',
      JSON.stringify(names),
      'include "checks-classifier"; {state: classify_named_checks($names), genuine: has_genuine_named_check_failure($names)}',
    ],
    { encoding: 'utf8', input: JSON.stringify(checks) },
  )
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

const nativeDesktopChecks = [
  'Native desktop proof — macos-15 (arm64)',
  'Native desktop proof — windows-2025 (x64)',
]

test('cancelled provider proof stays absent but is not a genuine test failure', () => {
  assert.deepEqual(classify([{ name: 'Required gate', status: 'COMPLETED', conclusion: 'CANCELLED' }]), {
    required: 'CANCELLED',
    canary: 'NONE',
    experimental: 'NONE',
    genuine: false,
  })
})

test('cancelled optional checks remain visible without becoming test failures', () => {
  assert.deepEqual(classify([
    { name: 'Required gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'Browser nightly 1/4 (non-blocking)', status: 'COMPLETED', conclusion: 'CANCELLED' },
    { name: 'Rendering study (experimental)', status: 'COMPLETED', conclusion: 'CANCELLED' },
  ]), {
    required: 'PASS',
    canary: 'CANCELLED',
    experimental: 'CANCELLED',
    genuine: false,
  })
})

test('a newer rerun supersedes cancelled and failed attempts with the same check name', () => {
  assert.deepEqual(classify([
    { name: 'Required gate', startedAt: '2026-07-15T00:00:00Z', status: 'COMPLETED', conclusion: 'CANCELLED' },
    { name: 'Required gate', startedAt: '2026-07-15T00:01:00Z', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'Browser nightly 1/4 (non-blocking)', startedAt: '2026-07-15T00:00:00Z', status: 'COMPLETED', conclusion: 'FAILURE' },
    { name: 'Browser nightly 1/4 (non-blocking)', startedAt: '2026-07-15T00:01:00Z', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ]), {
    required: 'PASS',
    canary: 'PASS',
    experimental: 'NONE',
    genuine: false,
  })
})

test('a newer required failure supersedes an older success', () => {
  assert.deepEqual(classify([
    { name: 'Required gate', startedAt: '2026-07-15T00:00:00Z', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'Required gate', startedAt: '2026-07-15T00:01:00Z', status: 'COMPLETED', conclusion: 'FAILURE' },
  ]), {
    required: 'FAIL',
    canary: 'NONE',
    experimental: 'NONE',
    genuine: true,
  })
})

test('a real required failure can never be compensated', () => {
  assert.deepEqual(classify([{ name: 'Required gate', status: 'COMPLETED', conclusion: 'FAILURE' }]), {
    required: 'FAIL',
    canary: 'NONE',
    experimental: 'NONE',
    genuine: true,
  })
})

test('native desktop proof is required rather than canary or experimental evidence', () => {
  assert.deepEqual(classify([
    { name: 'Required gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'Native desktop proof — macos-15 (arm64)', status: 'COMPLETED', conclusion: 'FAILURE' },
    { name: 'Native desktop proof — windows-2025 (x64)', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ]), {
    required: 'FAIL',
    canary: 'NONE',
    experimental: 'NONE',
    genuine: true,
  })
})

test('a conditional gate stays absent until every exact check exists, then preserves live state', () => {
  assert.deepEqual(classifyNamed([], nativeDesktopChecks), { state: 'NONE', genuine: false })
  assert.deepEqual(classifyNamed([
    { name: nativeDesktopChecks[0], status: 'COMPLETED', conclusion: 'SUCCESS' },
  ], nativeDesktopChecks), { state: 'PENDING', genuine: false })
  assert.deepEqual(classifyNamed([
    { name: nativeDesktopChecks[0], status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: nativeDesktopChecks[1], status: 'IN_PROGRESS', conclusion: null },
  ], nativeDesktopChecks), { state: 'PENDING', genuine: false })
  assert.deepEqual(classifyNamed([
    { name: nativeDesktopChecks[0], status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: nativeDesktopChecks[1], status: 'COMPLETED', conclusion: 'NEUTRAL' },
  ], nativeDesktopChecks), { state: 'PENDING', genuine: false })
  assert.deepEqual(classifyNamed([
    { name: nativeDesktopChecks[0], status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: nativeDesktopChecks[1], status: 'COMPLETED', conclusion: 'SKIPPED' },
  ], nativeDesktopChecks), { state: 'PENDING', genuine: false })
  assert.deepEqual(classifyNamed([
    { name: nativeDesktopChecks[0], status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: nativeDesktopChecks[1], status: 'COMPLETED', conclusion: 'CANCELLED' },
  ], nativeDesktopChecks), { state: 'CANCELLED', genuine: false })
  assert.deepEqual(classifyNamed([
    { name: nativeDesktopChecks[0], status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: nativeDesktopChecks[1], status: 'COMPLETED', conclusion: 'SUCCESS' },
  ], nativeDesktopChecks), { state: 'PASS', genuine: false })
})

test('a known required failure wins while another required check is pending', () => {
  assert.deepEqual(classify([
    { name: 'Required tests', status: 'COMPLETED', conclusion: 'FAILURE' },
    { name: 'Required build', status: 'IN_PROGRESS', conclusion: null },
  ]), {
    required: 'FAIL',
    canary: 'NONE',
    experimental: 'NONE',
    genuine: true,
  })
})

test('the browser interaction suite is required proof now, not a canary', () => {
  // The job lost its " (non-blocking)" suffix when it was promoted, so the
  // classifier must count it in the merge verdict. The nightly shards keep the
  // suffix and stay advisory.
  assert.deepEqual(classify([
    { name: 'Required gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'Browser interactions', status: 'COMPLETED', conclusion: 'FAILURE' },
    { name: 'Browser nightly 1/4 (non-blocking)', status: 'COMPLETED', conclusion: 'FAILURE' },
  ]), {
    required: 'FAIL',
    canary: 'FAIL',
    experimental: 'NONE',
    genuine: true,
  })
})

test('a named canary remains red without poisoning required proof', () => {
  assert.deepEqual(classify([
    { name: 'Required gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'Browser nightly 1/4 (non-blocking)', status: 'COMPLETED', conclusion: 'FAILURE' },
  ]), {
    required: 'PASS',
    canary: 'FAIL',
    experimental: 'NONE',
    genuine: false,
  })
})

test('experimental evidence is visible without poisoning required proof', () => {
  assert.deepEqual(classify([
    { name: 'Required gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'Image rendition evidence (experimental)', status: 'COMPLETED', conclusion: 'FAILURE' },
  ]), {
    required: 'PASS',
    canary: 'NONE',
    experimental: 'FAIL',
    genuine: false,
  })
})

test('main proof rejects abbreviated SHAs before querying the provider', () => {
  const result = spawnBash(
    ['.agents/skills/merge-captain/scripts/main-ci-wait.sh', 'deadbeef'],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 2)
  assert.match(result.stdout, /full-length/)

  const uppercase = spawnBash(
    ['.agents/skills/merge-captain/scripts/main-ci-wait.sh', 'A'.repeat(40)],
    { encoding: 'utf8' },
  )
  assert.equal(uppercase.status, 2)
  assert.match(uppercase.stdout, /lowercase hexadecimal/)
})

test('main proof is read-only by default and reruns cancellation only when authorized', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eido-fake-gh-'))
  const gh = join(directory, 'gh')
  const log = join(directory, 'mutations.log')
  const sha = 'e'.repeat(40)
  await writeFile(gh, `#!/usr/bin/env bash
if [ "$1" = "run" ] && [ "$2" = "list" ]; then
  printf '%s' "$RUN_JSON"
elif [ "$1" = "run" ] && [ "$2" = "rerun" ]; then
  printf 'rerun\\n' >> "$GH_LOG"
elif [ "$1" = "api" ]; then
  printf '[{"parents":[{"sha":"dddddddddddddddddddddddddddddddddddddddd"}],"files":[{"filename":"docs/codebase/TESTING.md","status":"modified"}]}]'
else
  exit 1
fi
`)
  await chmod(gh, 0o755)

  const runs = [{
    databaseId: 77,
    headSha: sha,
    status: 'completed',
    conclusion: 'cancelled',
    url: 'https://example.test/run/77',
    workflowName: 'CI',
    event: 'push',
  }]
  const env = {
    ...process.env,
    ...localConditionalPolicyEnv,
    PATH: `${directory}${delimiter}${process.env.PATH}`,
    RUN_JSON: JSON.stringify(runs),
    GH_LOG: log,
  }
  const readOnly = spawnBash(
    ['.agents/skills/merge-captain/scripts/main-ci-wait.sh', sha, '--timeout', '0'],
    { encoding: 'utf8', env },
  )
  const authorized = spawnBash(
    ['.agents/skills/merge-captain/scripts/main-ci-wait.sh', sha, '--timeout', '0', '--rerun-cancelled'],
    { encoding: 'utf8', env },
  )
  const mutations = await readFile(log, 'utf8')
  await rm(directory, { recursive: true, force: true })

  assert.equal(readOnly.status, 2, `${readOnly.stdout}\n${readOnly.stderr}`)
  assert.match(readOnly.stdout, /ABSENT: main run/)
  assert.equal(authorized.status, 2, `${authorized.stdout}\n${authorized.stderr}`)
  assert.match(authorized.stdout, /one authorized rerun/)
  assert.equal(mutations, 'rerun\n')
})

test('provider-bound PR policy survives stale checkout, policy deletion, and rename-out', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eido-stale-merge-captain-'))
  const gh = join(directory, 'gh')
  const sha = '9'.repeat(40)
  await writeFile(gh, `#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s' "$PR_JSON"
elif [ "$1" = "api" ]; then
  case "$*" in
    *"/pulls/88/files?per_page=100"*) printf '%s' "$PR_FILES_JSON" ;;
    *"release-profile.md?ref=8888888888888888888888888888888888888888"*)
      printf '<!-- merge-captain:conditional-gates=docs/agents/release-gates.json -->\\n' ;;
    *"release-profile.md?ref=9999999999999999999999999999999999999999"*)
      printf '# policy marker removed at head\\n' ;;
    *"release-gates.json?ref=8888888888888888888888888888888888888888"*)
      printf '%s' "$POLICY_JSON" ;;
    *) printf '0\\n' ;;
  esac
else
  exit 1
fi
`)
  await chmod(gh, 0o755)

  const pr = {
    number: 88,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
    statusCheckRollup: [{ name: 'Required gate', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    baseRefName: 'main',
    baseRefOid: '8'.repeat(40),
    headRefName: 'desktop-change',
    headRefOid: sha,
    url: 'https://example.test/pr/88',
    changedFiles: 1,
    files: [{ path: 'docs/moved-electron-main.ts' }],
  }
  const gateEnv = {
    ...process.env,
    PATH: `${directory}${delimiter}${process.env.PATH}`,
    POLICY_JSON: await readFile(resolve('docs/agents/release-gates.json'), 'utf8'),
    PR_FILES_JSON: JSON.stringify([[
      {
        filename: 'docs/moved-electron-main.ts',
        status: 'renamed',
        previous_filename: 'electron/main.ts',
      },
    ]]),
    PR_JSON: JSON.stringify(pr),
  }
  const result = spawnBash(
    [resolve('.agents/skills/merge-captain/scripts/pr-gate.sh'), '88'],
    {
      cwd: directory,
      encoding: 'utf8',
      env: gateEnv,
    },
  )
  const ambientProfileOverride = spawnBash(
    [resolve('.agents/skills/merge-captain/scripts/pr-gate.sh'), '88'],
    {
      cwd: directory,
      encoding: 'utf8',
      env: { ...gateEnv, MERGE_CAPTAIN_RELEASE_PROFILE: 'README.md' },
    },
  )
  await rm(directory, { recursive: true, force: true })

  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /native-desktop-proof.*absent/i)
  assert.equal(ambientProfileOverride.status, 2, `${ambientProfileOverride.stdout}\n${ambientProfileOverride.stderr}`)
  assert.match(ambientProfileOverride.stdout, /conditional gate policy.*invalid.*unreadable/i)
})

test('provider PR file inventory fails closed at the documented 3000-file cap', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eido-pr-file-cap-'))
  const gh = join(directory, 'gh')
  const sha = '3'.repeat(40)
  await writeFile(gh, `#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s' "$PR_JSON"
elif [ "$1" = "api" ]; then
  case "$*" in
    *"/pulls/89/files?per_page=100"*)
      jq -nc '[[range(0; 3000) | {filename:("docs/" + (.|tostring) + ".md"), status:"modified"}]]' ;;
    *) printf '0\\n' ;;
  esac
else
  exit 1
fi
`)
  await chmod(gh, 0o755)
  const result = spawnBash(
    ['.agents/skills/merge-captain/scripts/pr-gate.sh', '89'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        PR_JSON: JSON.stringify({
          number: 89,
          state: 'OPEN',
          isDraft: false,
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'CLEAN',
          reviewDecision: 'APPROVED',
          statusCheckRollup: [{ name: 'Required gate', status: 'COMPLETED', conclusion: 'SUCCESS' }],
          baseRefName: 'main',
          baseRefOid: '2'.repeat(40),
          headRefName: 'huge-change',
          headRefOid: sha,
          url: 'https://example.test/pr/89',
          changedFiles: 3000,
          files: [],
        }),
      },
    },
  )
  await rm(directory, { recursive: true, force: true })

  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /3000-file API cap/i)
})

test('PR gate discards mixed provider proof when the head or checks move during its read', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eido-pr-snapshot-race-'))
  const gh = join(directory, 'gh')
  const viewCount = join(directory, 'view-count')
  await writeFile(gh, `#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  count=$(cat "$GH_VIEW_COUNT" 2>/dev/null || printf '0')
  if [ "$count" = "0" ]; then
    printf '%s' "$PR_JSON"
  else
    printf '%s' "$FRESH_PR_JSON"
  fi
  printf '%s' "$((count + 1))" > "$GH_VIEW_COUNT"
elif [ "$1" = "api" ]; then
  case "$*" in
    *"/pulls/90/files?per_page=100"*)
      printf '[[{"filename":"docs/codebase/TESTING.md","status":"modified"}]]' ;;
    *"/compare/"*) printf '0\n' ;;
    *) exit 1 ;;
  esac
else
  exit 1
fi
`)
  await chmod(gh, 0o755)

  const successfulCheck = {
    name: 'Required gate',
    startedAt: '2026-07-18T00:00:00Z',
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
  }
  const initial = {
    number: 90,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
    statusCheckRollup: [successfulCheck],
    baseRefName: 'main',
    baseRefOid: '4'.repeat(40),
    headRefName: 'moving-change',
    headRefOid: '5'.repeat(40),
    url: 'https://example.test/pr/90',
    changedFiles: 1,
    files: [{ path: 'docs/codebase/TESTING.md' }],
  }
  const runGate = (fresh) => spawnBash(
      ['.agents/skills/merge-captain/scripts/pr-gate.sh', '90'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          ...localConditionalPolicyEnv,
          MERGE_CAPTAIN_PR_FILES_FROM_VIEW_FOR_TESTS: '',
          PATH: `${directory}${delimiter}${process.env.PATH}`,
          GH_VIEW_COUNT: viewCount,
          PR_JSON: JSON.stringify(initial),
          FRESH_PR_JSON: JSON.stringify(fresh),
        },
      },
    )
  await writeFile(viewCount, '0')
  const headMoved = runGate({ ...initial, headRefOid: '6'.repeat(40) })
  await writeFile(viewCount, '0')
  const checksMoved = runGate({
    ...initial,
    statusCheckRollup: [
      successfulCheck,
      {
        name: 'Required gate',
        startedAt: '2026-07-18T00:01:00Z',
        status: 'IN_PROGRESS',
        conclusion: null,
      },
    ],
  })
  await writeFile(viewCount, '0')
  const reviewMoved = runGate({ ...initial, reviewDecision: 'CHANGES_REQUESTED' })
  await rm(directory, { recursive: true, force: true })

  for (const result of [headMoved, checksMoved, reviewMoved]) {
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /snapshot.*changed during gate read/i)
    assert.match(result.stdout, /freshness.*not computed/i)
  }
})

test('an unused compensation assertion cannot explain an unstable provider state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eido-fake-gh-'))
  const gh = join(directory, 'gh')
  await writeFile(gh, `#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s' "$PR_JSON"
elif [ "$1" = "api" ]; then
  printf '0\n'
else
  exit 1
fi
`)
  await chmod(gh, 0o755)

  const sha = 'a'.repeat(40)
  const pr = {
    number: 1,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'UNSTABLE',
    reviewDecision: 'APPROVED',
    statusCheckRollup: [{ name: 'Required gate', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    baseRefName: 'main',
    baseRefOid: '0'.repeat(40),
    headRefName: 'feature',
    headRefOid: sha,
    url: 'https://example.test/pr/1',
    changedFiles: 0,
    files: [],
  }
  const result = spawnBash(
    ['.agents/skills/merge-captain/scripts/pr-gate.sh', '1', '--provider-ci-compensated', sha],
    { encoding: 'utf8', env: { ...process.env, ...localConditionalPolicyEnv, PATH: `${directory}${delimiter}${process.env.PATH}`, PR_JSON: JSON.stringify(pr) } },
  )
  await rm(directory, { recursive: true, force: true })

  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /UNSTABLE despite green required proof and no accepted canary/)
})

test('Merge Captain waits on cancelled required CI unless exact-head compensation exists', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eido-fake-gh-'))
  const gh = join(directory, 'gh')
  await writeFile(gh, `#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s' "$PR_JSON"
elif [ "$1" = "api" ]; then
  printf '0\n'
else
  exit 1
fi
`)
  await chmod(gh, 0o755)

  const sha = 'c'.repeat(40)
  const pr = {
    number: 3,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'UNSTABLE',
    reviewDecision: 'APPROVED',
    statusCheckRollup: [{ name: 'Required gate', status: 'COMPLETED', conclusion: 'CANCELLED' }],
    baseRefName: 'main',
    baseRefOid: '0'.repeat(40),
    headRefName: 'feature',
    headRefOid: sha,
    url: 'https://example.test/pr/3',
    changedFiles: 0,
    files: [],
  }
  const env = { ...process.env, ...localConditionalPolicyEnv, PATH: `${directory}${delimiter}${process.env.PATH}`, PR_JSON: JSON.stringify(pr) }
  const absent = spawnBash(
    ['.agents/skills/merge-captain/scripts/pr-gate.sh', '3'],
    { encoding: 'utf8', env },
  )
  const compensated = spawnBash(
    ['.agents/skills/merge-captain/scripts/pr-gate.sh', '3', '--provider-ci-compensated', sha],
    { encoding: 'utf8', env },
  )
  await rm(directory, { recursive: true, force: true })

  assert.equal(absent.status, 2, `${absent.stdout}\n${absent.stderr}`)
  assert.match(absent.stdout, /required run cancelled/)
  assert.equal(compensated.status, 0, `${compensated.stdout}\n${compensated.stderr}`)
  assert.match(compensated.stdout, /canonical full mirror asserted/)
})

test('desktop-path PRs require both native hosts and host proof cannot be compensated', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eido-fake-gh-'))
  const gh = join(directory, 'gh')
  await writeFile(gh, `#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s' "$PR_JSON"
elif [ "$1" = "api" ]; then
  printf '0\n'
else
  exit 1
fi
`)
  await chmod(gh, 0o755)

  const sha = 'e'.repeat(40)
  const base = {
    number: 5,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
    baseRefName: 'main',
    baseRefOid: '0'.repeat(40),
    headRefName: 'feature',
    headRefOid: sha,
    url: 'https://example.test/pr/5',
    changedFiles: 1,
    files: [{ path: 'electron/main.ts' }],
  }
  const runGate = (statusCheckRollup, arguments_ = []) => spawnBash(
    ['.agents/skills/merge-captain/scripts/pr-gate.sh', '5', ...arguments_],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...localConditionalPolicyEnv,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        PR_JSON: JSON.stringify({ ...base, statusCheckRollup }),
      },
    },
  )

  const requiredGreen = { name: 'Required gate', status: 'COMPLETED', conclusion: 'SUCCESS' }
  const absent = runGate([requiredGreen])
  const pending = runGate([
    requiredGreen,
    { name: nativeDesktopChecks[0], status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: nativeDesktopChecks[1], status: 'IN_PROGRESS', conclusion: null },
  ])
  const cancelled = runGate([
    requiredGreen,
    { name: nativeDesktopChecks[0], status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: nativeDesktopChecks[1], status: 'COMPLETED', conclusion: 'CANCELLED' },
  ])
  const compensated = runGate([
    { name: 'Required gate', status: 'COMPLETED', conclusion: 'CANCELLED' },
  ], ['--provider-ci-compensated', sha])
  const complete = runGate([
    requiredGreen,
    ...nativeDesktopChecks.map((name) => ({ name, status: 'COMPLETED', conclusion: 'SUCCESS' })),
  ])
  await rm(directory, { recursive: true, force: true })

  assert.equal(absent.status, 2, `${absent.stdout}\n${absent.stderr}`)
  assert.match(absent.stdout, /native-desktop-proof.*absent/i)
  assert.equal(pending.status, 2, `${pending.stdout}\n${pending.stderr}`)
  assert.match(pending.stdout, /native-desktop-proof.*pending/i)
  assert.equal(cancelled.status, 2, `${cancelled.stdout}\n${cancelled.stderr}`)
  assert.match(cancelled.stdout, /native-desktop-proof.*cancelled/i)
  assert.equal(compensated.status, 2, `${compensated.stdout}\n${compensated.stderr}`)
  assert.match(compensated.stdout, /native-desktop-proof.*cannot be compensated/i)
  assert.equal(complete.status, 0, `${complete.stdout}\n${complete.stderr}`)
})

test('non-desktop PR paths do not invent a native host requirement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eido-fake-gh-'))
  const gh = join(directory, 'gh')
  await writeFile(gh, `#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s' "$PR_JSON"
elif [ "$1" = "api" ]; then
  printf '0\n'
else
  exit 1
fi
`)
  await chmod(gh, 0o755)

  const sha = 'f'.repeat(40)
  const pr = {
    number: 6,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
    statusCheckRollup: [{ name: 'Required gate', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    baseRefName: 'main',
    baseRefOid: '0'.repeat(40),
    headRefName: 'docs-only',
    headRefOid: sha,
    url: 'https://example.test/pr/6',
    changedFiles: 1,
    files: [{ path: 'docs/codebase/TESTING.md' }],
  }
  const result = spawnBash(
    ['.agents/skills/merge-captain/scripts/pr-gate.sh', '6'],
    { encoding: 'utf8', env: { ...process.env, ...localConditionalPolicyEnv, PATH: `${directory}${delimiter}${process.env.PATH}`, PR_JSON: JSON.stringify(pr) } },
  )
  await rm(directory, { recursive: true, force: true })

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})

test('declared conditional policy deletion and truncated PR file inventory fail closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eido-fake-gh-'))
  const gh = join(directory, 'gh')
  await writeFile(gh, `#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s' "$PR_JSON"
elif [ "$1" = "api" ]; then
  printf '0\n'
else
  exit 1
fi
`)
  await chmod(gh, 0o755)

  const sha = '2'.repeat(40)
  const base = {
    number: 7,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
    statusCheckRollup: [{ name: 'Required gate', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    baseRefName: 'main',
    baseRefOid: '0'.repeat(40),
    headRefName: 'feature',
    headRefOid: sha,
    url: 'https://example.test/pr/7',
    changedFiles: 1,
    files: [{ path: 'electron/main.ts' }],
  }
  const runGate = (pr, extraEnv = {}) => spawnBash(
    ['.agents/skills/merge-captain/scripts/pr-gate.sh', '7'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...localConditionalPolicyEnv,
        ...extraEnv,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        PR_JSON: JSON.stringify(pr),
      },
    },
  )
  const duplicateChecksPolicy = join(directory, 'duplicate-checks-release-gates.json')
  const policy = JSON.parse(await readFile(resolve('docs/agents/release-gates.json'), 'utf8'))
  policy.conditionalGates[0].checks = [nativeDesktopChecks[0], nativeDesktopChecks[0]]
  await writeFile(duplicateChecksPolicy, `${JSON.stringify(policy)}\n`)
  const deleted = runGate(base, {
    MERGE_CAPTAIN_RELEASE_GATES_FILE: join(directory, 'deleted-release-gates.json'),
  })
  const duplicateChecks = runGate(base, {
    MERGE_CAPTAIN_RELEASE_GATES_FILE: duplicateChecksPolicy,
  })
  const unauthorizedLocalPolicy = runGate(base, {
    MERGE_CAPTAIN_ALLOW_LOCAL_POLICY_FOR_TESTS: '',
  })
  const truncated = runGate({ ...base, changedFiles: 2 })
  const invalidDeclaredCount = runGate({ ...base, changedFiles: '1' })
  const unknownStatus = runGate({
    ...base,
    files: [{ path: 'electron/main.ts', status: 'future-rename-like-status' }],
  })
  const duplicatePaths = runGate({
    ...base,
    changedFiles: 2,
    files: [{ path: 'electron/main.ts' }, { path: 'electron/main.ts' }],
    statusCheckRollup: [
      { name: 'Required gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
      ...nativeDesktopChecks.map((name) => ({ name, status: 'COMPLETED', conclusion: 'SUCCESS' })),
    ],
  })
  const invalidBaseIdentity = runGate({ ...base, baseRefOid: 'not-a-full-oid' })
  const invalidHeadIdentity = runGate({ ...base, headRefOid: 'A'.repeat(40) })
  await rm(directory, { recursive: true, force: true })

  assert.equal(deleted.status, 2, `${deleted.stdout}\n${deleted.stderr}`)
  assert.match(deleted.stdout, /conditional gate policy.*missing/i)
  assert.equal(duplicateChecks.status, 2, `${duplicateChecks.stdout}\n${duplicateChecks.stderr}`)
  assert.match(duplicateChecks.stdout, /conditional gate policy.*invalid/i)
  assert.equal(unauthorizedLocalPolicy.status, 2, `${unauthorizedLocalPolicy.stdout}\n${unauthorizedLocalPolicy.stderr}`)
  assert.match(unauthorizedLocalPolicy.stdout, /conditional gate policy.*invalid.*unreadable/i)
  assert.equal(truncated.status, 2, `${truncated.stdout}\n${truncated.stderr}`)
  assert.match(truncated.stdout, /file inventory.*incomplete/i)
  assert.equal(invalidDeclaredCount.status, 2, `${invalidDeclaredCount.stdout}\n${invalidDeclaredCount.stderr}`)
  assert.match(invalidDeclaredCount.stdout, /changed-file count.*invalid/i)
  assert.equal(unknownStatus.status, 2, `${unknownStatus.stdout}\n${unknownStatus.stderr}`)
  assert.match(unknownStatus.stdout, /file inventory.*invalid current\/previous path/i)
  assert.equal(duplicatePaths.status, 2, `${duplicatePaths.stdout}\n${duplicatePaths.stderr}`)
  assert.match(duplicatePaths.stdout, /file inventory.*duplicate current paths/i)
  assert.equal(invalidBaseIdentity.status, 2, `${invalidBaseIdentity.stdout}\n${invalidBaseIdentity.stderr}`)
  assert.match(invalidBaseIdentity.stdout, /valid full lowercase PR base identity/i)
  assert.equal(invalidHeadIdentity.status, 2, `${invalidHeadIdentity.stdout}\n${invalidHeadIdentity.stderr}`)
  assert.match(invalidHeadIdentity.stdout, /valid full lowercase PR head identity/i)
})

test('exact-main wait requires every matching conditional workflow job at the pushed SHA', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eido-fake-gh-'))
  const gh = join(directory, 'gh')
  const date = join(directory, 'date')
  const sleep = join(directory, 'sleep')
  const log = join(directory, 'gh.log')
  await writeFile(gh, `#!/usr/bin/env bash
printf '%s\n' "$*" >> "$GH_LOG"
if [ "$1" = "api" ]; then
  printf '%s' "$COMMIT_PAGES_JSON"
elif [ "$1" = "run" ] && [ "$2" = "list" ]; then
  case "$*" in
    *"Native desktop proof"*) printf '%s' "$NATIVE_RUNS_JSON" ;;
    *) printf '%s' "$CI_RUNS_JSON" ;;
  esac
elif [ "$1" = "run" ] && [ "$2" = "view" ]; then
  if [ -n "\${NATIVE_JOBS_FIRST_JSON:-}" ] && [ ! -f "$NATIVE_VIEWED" ]; then
    : > "$NATIVE_VIEWED"
    printf '%s' "$NATIVE_JOBS_FIRST_JSON"
  else
    printf '%s' "$NATIVE_JOBS_JSON"
  fi
elif [ "$1" = "run" ] && [ "$2" = "rerun" ]; then
  exit 0
else
  exit 1
fi
`)
  await writeFile(date, `#!/usr/bin/env bash
value=$(cat "$DATE_COUNT" 2>/dev/null || printf '0')
printf '%s\n' "$value"
printf '%s' "$((value + 1))" > "$DATE_COUNT"
`)
  await writeFile(sleep, '#!/usr/bin/env bash\nexit 0\n')
  await Promise.all([chmod(gh, 0o755), chmod(date, 0o755), chmod(sleep, 0o755)])

  const sha = '1'.repeat(40)
  const successfulRun = (id, workflowName) => ({
    databaseId: id,
    headSha: sha,
    status: 'completed',
    conclusion: 'success',
    url: `https://example.test/runs/${id}`,
    workflowName,
    event: 'push',
  })
  const baseEnv = {
    ...process.env,
    ...localConditionalPolicyEnv,
    PATH: `${directory}${delimiter}${process.env.PATH}`,
    GH_LOG: log.replaceAll('\\', '/'),
    MERGE_CAPTAIN_POLL_INTERVAL_SECONDS: '0',
    DATE_COUNT: join(directory, 'date.count').replaceAll('\\', '/'),
    NATIVE_VIEWED: join(directory, 'native.viewed').replaceAll('\\', '/'),
    COMMIT_PAGES_JSON: JSON.stringify([
      { parents: [{ sha: '4'.repeat(40) }], files: [{ filename: 'docs/codebase/TESTING.md', status: 'modified' }] },
      { files: [{ filename: 'electron/main.ts', status: 'modified' }] },
    ]),
    CI_RUNS_JSON: JSON.stringify([successfulRun(100, 'CI')]),
    NATIVE_RUNS_JSON: JSON.stringify([successfulRun(200, 'Native desktop proof')]),
  }
  const missingHost = spawnBash(
    ['.agents/skills/merge-captain/scripts/main-ci-wait.sh', sha, '--timeout', '0'],
    {
      encoding: 'utf8',
      env: {
        ...baseEnv,
        NATIVE_JOBS_JSON: JSON.stringify({
          jobs: [{ name: nativeDesktopChecks[0], status: 'completed', conclusion: 'success' }],
        }),
      },
    },
  )
  const complete = spawnBash(
    ['.agents/skills/merge-captain/scripts/main-ci-wait.sh', sha, '--timeout', '0'],
    {
      encoding: 'utf8',
      env: {
        ...baseEnv,
        NATIVE_JOBS_JSON: JSON.stringify({
          jobs: nativeDesktopChecks.map((name) => ({ name, status: 'completed', conclusion: 'success' })),
        }),
      },
    },
  )
  await writeFile(baseEnv.DATE_COUNT, '0')
  await rm(baseEnv.NATIVE_VIEWED, { force: true })
  const eventuallyComplete = spawnBash(
    ['.agents/skills/merge-captain/scripts/main-ci-wait.sh', sha, '--timeout', '300'],
    {
      encoding: 'utf8',
      env: {
        ...baseEnv,
        NATIVE_JOBS_FIRST_JSON: JSON.stringify({
          jobs: [{ name: nativeDesktopChecks[0], status: 'completed', conclusion: 'success' }],
        }),
        NATIVE_JOBS_JSON: JSON.stringify({
          jobs: nativeDesktopChecks.map((name) => ({ name, status: 'completed', conclusion: 'success' })),
        }),
      },
    },
  )
  const calls = await readFile(log, 'utf8')
  await rm(directory, { recursive: true, force: true })

  assert.equal(missingHost.status, 2, `${missingHost.stdout}\n${missingHost.stderr}`)
  assert.match(missingHost.stdout, /native-desktop-proof.*missing/i)
  assert.equal(complete.status, 0, `${complete.stdout}\n${complete.stderr}`)
  assert.equal(eventuallyComplete.status, 0, `${eventuallyComplete.stdout}\n${eventuallyComplete.stderr}`)
  assert.match(eventuallyComplete.stdout, /missing or pending[\s\S]*every required job succeeded/i)
  assert.match(calls, /run list .*Native desktop proof/)
  assert.match(calls, /run view 200 --json jobs/)
  assert.match(calls, /api --paginate --slurp repos\/\{owner\}\/\{repo\}\/commits\/1111111111111111111111111111111111111111\?per_page=100/)
})

test('exact-main policy survives head deletion and conditional cancellation is read-only by default', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eido-provider-policy-'))
  const gh = join(directory, 'gh')
  const log = join(directory, 'gh.log')
  const sha = '7'.repeat(40)
  const parent = '6'.repeat(40)
  await writeFile(gh, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$GH_LOG"
if [ "$1" = "api" ]; then
  case "$*" in
    *"/commits/$EXACT_SHA?per_page=100"*) printf '%s' "$COMMIT_PAGES_JSON" ;;
    *"release-profile.md?ref=$PARENT_SHA"*)
      printf '<!-- merge-captain:conditional-gates=docs/agents/release-gates.json -->\\n' ;;
    *"release-profile.md?ref=$EXACT_SHA"*) printf '# policy marker removed at head\\n' ;;
    *"release-gates.json?ref=$PARENT_SHA"*) printf '%s' "$POLICY_JSON" ;;
    *) exit 1 ;;
  esac
elif [ "$1" = "run" ] && [ "$2" = "list" ]; then
  case "$*" in
    *"Native desktop proof"*) printf '%s' "$NATIVE_RUNS_JSON" ;;
    *) printf '%s' "$CI_RUNS_JSON" ;;
  esac
elif [ "$1" = "run" ] && [ "$2" = "rerun" ]; then
  printf 'mutation:%s\\n' "$3" >> "$GH_LOG"
else
  exit 1
fi
`)
  await chmod(gh, 0o755)

  const successfulRun = {
    databaseId: 300,
    headSha: sha,
    status: 'completed',
    conclusion: 'success',
    url: 'https://example.test/runs/300',
    workflowName: 'CI',
    event: 'push',
  }
  const cancelledNativeRun = {
    databaseId: 301,
    headSha: sha,
    status: 'completed',
    conclusion: 'cancelled',
    url: 'https://example.test/runs/301',
    workflowName: 'Native desktop proof',
    event: 'push',
  }
  const env = {
    ...process.env,
    PATH: `${directory}${delimiter}${process.env.PATH}`,
    GH_LOG: log,
    EXACT_SHA: sha,
    PARENT_SHA: parent,
    COMMIT_PAGES_JSON: JSON.stringify([{
      parents: [{ sha: parent }],
      files: [{
        filename: 'docs/moved-electron-main.ts',
        status: 'renamed',
        previous_filename: 'electron/main.ts',
      }],
    }]),
    POLICY_JSON: await readFile(resolve('docs/agents/release-gates.json'), 'utf8'),
    CI_RUNS_JSON: JSON.stringify([successfulRun]),
    NATIVE_RUNS_JSON: JSON.stringify([cancelledNativeRun]),
  }
  const readOnly = spawnBash(
    ['.agents/skills/merge-captain/scripts/main-ci-wait.sh', sha, '--timeout', '0'],
    { encoding: 'utf8', env },
  )
  const skipped = spawnBash(
    ['.agents/skills/merge-captain/scripts/main-ci-wait.sh', sha, '--timeout', '0'],
    {
      encoding: 'utf8',
      env: {
        ...env,
        NATIVE_RUNS_JSON: JSON.stringify([{ ...cancelledNativeRun, conclusion: 'skipped' }]),
      },
    },
  )
  const authorized = spawnBash(
    ['.agents/skills/merge-captain/scripts/main-ci-wait.sh', sha, '--timeout', '0', '--rerun-cancelled'],
    { encoding: 'utf8', env },
  )
  const calls = await readFile(log, 'utf8')
  await rm(directory, { recursive: true, force: true })

  assert.equal(readOnly.status, 2, `${readOnly.stdout}\n${readOnly.stderr}`)
  assert.match(readOnly.stdout, /native-desktop-proof.*cancelled/i)
  assert.equal(skipped.status, 2, `${skipped.stdout}\n${skipped.stderr}`)
  assert.match(skipped.stdout, /concluded 'skipped'.*proof is absent/i)
  assert.doesNotMatch(skipped.stdout, /RED:/)
  assert.equal(authorized.status, 2, `${authorized.stdout}\n${authorized.stderr}`)
  assert.match(authorized.stdout, /one authorized rerun/i)
  assert.equal(calls.match(/^mutation:301$/gm)?.length, 1, calls)
  assert.match(calls, new RegExp(`release-profile\\.md\\?ref=${parent}`))
  assert.match(calls, new RegExp(`release-profile\\.md\\?ref=${sha}`))
})

test('exact-main changed-path inventory fails closed when malformed or at the provider cap', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eido-commit-inventory-'))
  const gh = join(directory, 'gh')
  const sha = '5'.repeat(40)
  await writeFile(gh, `#!/usr/bin/env bash
if [ "$1" = "api" ]; then
  case "$INVENTORY_MODE" in
    malformed) printf '[{"files":null}]' ;;
    missing-parent) printf '[{"files":[{"filename":"electron/main.ts","status":"modified"}]}]' ;;
    invalid-path) printf '[{"parents":[{"sha":"4444444444444444444444444444444444444444"}],"files":[{"filename":null,"status":"modified"}]}]' ;;
    unknown-status) printf '[{"parents":[{"sha":"4444444444444444444444444444444444444444"}],"files":[{"filename":"electron/main.ts","status":"future-rename-like-status"}]}]' ;;
    duplicate) printf '[{"parents":[{"sha":"4444444444444444444444444444444444444444"}],"files":[{"filename":"electron/main.ts","status":"modified"}]},{"files":[{"filename":"electron/main.ts","status":"modified"}]}]' ;;
    *) jq -nc '[{parents:[{sha:"4444444444444444444444444444444444444444"}],files:[range(0; 3000) | {filename:("docs/" + (.|tostring) + ".md"),status:"modified"}]}]' ;;
  esac
else
  exit 1
fi
`)
  await chmod(gh, 0o755)
  const run = (mode) => spawnBash(
    ['.agents/skills/merge-captain/scripts/main-ci-wait.sh', sha, '--timeout', '0'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...localConditionalPolicyEnv,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        INVENTORY_MODE: mode,
      },
    },
  )

  const malformed = run('malformed')
  const missingParent = run('missing-parent')
  const invalidPath = run('invalid-path')
  const unknownStatus = run('unknown-status')
  const duplicate = run('duplicate')
  const capped = run('capped')
  await rm(directory, { recursive: true, force: true })

  assert.equal(malformed.status, 2, `${malformed.stdout}\n${malformed.stderr}`)
  assert.match(malformed.stdout, /changed-path inventory.*malformed or incomplete/i)
  assert.equal(missingParent.status, 2, `${missingParent.stdout}\n${missingParent.stderr}`)
  assert.match(missingParent.stdout, /no valid full first-parent identity/i)
  assert.equal(invalidPath.status, 2, `${invalidPath.stdout}\n${invalidPath.stderr}`)
  assert.match(invalidPath.stdout, /changed-path inventory.*malformed or incomplete/i)
  assert.equal(unknownStatus.status, 2, `${unknownStatus.stdout}\n${unknownStatus.stderr}`)
  assert.match(unknownStatus.stdout, /changed-path inventory.*malformed or incomplete/i)
  assert.equal(duplicate.status, 2, `${duplicate.stdout}\n${duplicate.stderr}`)
  assert.match(duplicate.stdout, /duplicate changed filenames.*ambiguous/i)
  assert.equal(capped.status, 2, `${capped.stdout}\n${capped.stderr}`)
  assert.match(capped.stdout, /3000-file commit API cap/i)
})

test('Merge Captain fails closed when the check classifier cannot be read', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eido-fake-gh-'))
  const gh = join(directory, 'gh')
  const jq = join(directory, 'jq')
  const realJq = jqCommand
  await writeFile(gh, `#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s' "$PR_JSON"
elif [ "$1" = "api" ]; then
  printf '0\n'
else
  exit 1
fi
`)
  await writeFile(jq, `#!/usr/bin/env bash
for argument in "$@"; do
  case "$argument" in
    *classify_checks*|*classify_nonblocking_checks*|*classify_experimental_checks*) exit 9 ;;
  esac
done
exec ${JSON.stringify(realJq)} "$@"
`)
  await Promise.all([chmod(gh, 0o755), chmod(jq, 0o755)])

  const sha = 'd'.repeat(40)
  const pr = {
    number: 4,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
    statusCheckRollup: [{ name: 'Required gate', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    baseRefName: 'main',
    baseRefOid: '0'.repeat(40),
    headRefName: 'feature',
    headRefOid: sha,
    url: 'https://example.test/pr/4',
    changedFiles: 0,
    files: [],
  }
  const result = spawnBash(
    ['.agents/skills/merge-captain/scripts/pr-gate.sh', '4'],
    { encoding: 'utf8', env: { ...process.env, ...localConditionalPolicyEnv, PATH: `${directory}${delimiter}${process.env.PATH}`, PR_JSON: JSON.stringify(pr) } },
  )
  await rm(directory, { recursive: true, force: true })

  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /could not be classified safely/)
  assert.match(result.stdout, /VERDICT: WAIT/)
})

test('Merge Captain keeps optional signals and risk-selected review from overblocking', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eido-fake-gh-'))
  const gh = join(directory, 'gh')
  await writeFile(gh, `#!/usr/bin/env bash
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s' "$PR_JSON"
elif [ "$1" = "api" ]; then
  printf '0\n'
else
  exit 1
fi
`)
  await chmod(gh, 0o755)

  const sha = 'b'.repeat(40)
  const pr = {
    number: 2,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'UNSTABLE',
    reviewDecision: '',
    statusCheckRollup: [
      { name: 'Required gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'Rendering study (experimental)', status: 'COMPLETED', conclusion: 'FAILURE' },
    ],
    baseRefName: 'main',
    baseRefOid: '0'.repeat(40),
    headRefName: 'feature',
    headRefOid: sha,
    url: 'https://example.test/pr/2',
    changedFiles: 0,
    files: [],
  }
  const pendingCanary = {
    ...pr,
    statusCheckRollup: [
      ...pr.statusCheckRollup,
      { name: 'Browser nightly 1/4 (non-blocking)', status: 'IN_PROGRESS', conclusion: null },
    ],
  }
  const pendingResult = spawnBash(
    ['.agents/skills/merge-captain/scripts/pr-gate.sh', '2'],
    { encoding: 'utf8', env: { ...process.env, ...localConditionalPolicyEnv, PATH: `${directory}${delimiter}${process.env.PATH}`, PR_JSON: JSON.stringify(pendingCanary) } },
  )
  const result = spawnBash(
    ['.agents/skills/merge-captain/scripts/pr-gate.sh', '2'],
    { encoding: 'utf8', env: { ...process.env, ...localConditionalPolicyEnv, PATH: `${directory}${delimiter}${process.env.PATH}`, PR_JSON: JSON.stringify(pr) } },
  )
  const requiredReviewResult = spawnBash(
    ['.agents/skills/merge-captain/scripts/pr-gate.sh', '2', '--review-required'],
    { encoding: 'utf8', env: { ...process.env, ...localConditionalPolicyEnv, PATH: `${directory}${delimiter}${process.env.PATH}`, PR_JSON: JSON.stringify(pr) } },
  )
  await rm(directory, { recursive: true, force: true })

  assert.equal(pendingResult.status, 0, `${pendingResult.stdout}\n${pendingResult.stderr}`)
  assert.match(pendingResult.stdout, /pending optional canary/)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /experimental evidence is red/)
  assert.match(result.stdout, /VERDICT: GO/)
  assert.equal(requiredReviewResult.status, 2, `${requiredReviewResult.stdout}\n${requiredReviewResult.stderr}`)
  assert.match(requiredReviewResult.stdout, /review is required for this change/)
})
