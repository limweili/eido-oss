import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { formatDuration, REQUIRED_STEPS, runRequiredCi } from './required.mjs'

test('the required gate has one canonical ordered contract', () => {
  assert.deepEqual(
    REQUIRED_STEPS.map(({ args }) => args.join(' ')),
    [
      'ci --no-audit --no-fund',
      'audit --omit=dev --audit-level=high --fetch-timeout=60000 --fetch-retries=3',
      'run test:ci-tools',
      'run ci:design-system',
      'run ci:workflow-policy',
      'run typecheck:outside-build',
      'run build',
      'run check:bundle',
      'test',
    ],
  )
})

test('the release gate audits installed production dependencies at high severity', () => {
  const auditStep = REQUIRED_STEPS.find(({ name }) => name === 'Audit production dependencies')
  assert.deepEqual(
    auditStep?.args,
    ['audit', '--omit=dev', '--audit-level=high', '--fetch-timeout=60000', '--fetch-retries=3'],
  )
  assert.equal(auditStep?.attempts, 3)
})

test('the required typecheck step reaches every TypeScript project, Electron included', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  )
  const typecheck = manifest.scripts.typecheck

  // `run build` compiles the root project and never the
  // Electron or tooling projects. The outside-build pass keeps those proofs
  // required without compiling the renderer twice.
  for (const project of [
    'tsc --noEmit',
    'tsc -p tsconfig.electron.json --noEmit',
    'tsc -p tsconfig.tools.json --noEmit',
  ]) {
    assert.ok(
      typecheck.includes(project),
      `npm run typecheck must compile ${project}; a project it does not name is a project no gate checks`,
    )
  }

  assert.ok(
    REQUIRED_STEPS.some(({ args }) => args.join(' ') === 'run typecheck:outside-build'),
    'the required gate must run the outside-build typecheck itself, or widening the script changes nothing that CI enforces',
  )
})

test('a step with requireEnv gets it merged into the spawned environment', () => {
  const envs = []
  runRequiredCi({
    steps: [
      { name: 'Plain step', args: ['run', 'plain'] },
      {
        name: 'Environment-specific step',
        args: ['run', 'proof:independent'],
        requireEnv: { EIDO_REQUIRED_PROOF: '1' },
      },
    ],
    env: { npm_execpath: '/npm', EIDO_REQUIRED_PROOF: '0' },
    spawn(_command, _args, options) {
      envs.push(options.env)
      return { status: 0 }
    },
    report() {},
  })

  assert.deepEqual(envs[0], { npm_execpath: '/npm', EIDO_REQUIRED_PROOF: '0' })
  assert.deepEqual(
    envs[1],
    { npm_execpath: '/npm', EIDO_REQUIRED_PROOF: '1' },
    'requireEnv must override a caller-supplied value, not merely default it',
  )
})

test('an unrelated failure stops dependent steps but still runs independent proof', () => {
  const ran = []
  const passed = runRequiredCi({
    steps: [
      { name: 'Bundle budget', args: ['run', 'check:bundle'] },
      { name: 'Fast suite', args: ['test'] },
      { name: 'Independent proof', args: ['run', 'proof:independent'], independent: true },
    ],
    env: { npm_execpath: '/npm' },
    spawn(_command, args) {
      ran.push(args.join(' '))
      return { status: args.includes('check:bundle') ? 1 : 0 }
    },
    report() {},
  })

  assert.equal(passed, false, 'an independent step passing never excuses the earlier failure')
  assert.deepEqual(ran, ['/npm run check:bundle', '/npm run proof:independent'])
})

test('a failing independent step still fails the gate when everything else passes', () => {
  const passed = runRequiredCi({
    steps: [
      { name: 'Fast suite', args: ['test'] },
      { name: 'Independent proof', args: ['run', 'proof:independent'], independent: true },
    ],
    env: { npm_execpath: '/npm' },
    spawn(_command, args) {
      return { status: args.includes('proof:independent') ? 1 : 0 }
    },
    report() {},
  })

  assert.equal(passed, false)
})

test('a failed install abandons everything, including independent steps', () => {
  const ran = []
  const passed = runRequiredCi({
    steps: [
      { name: 'Install', args: ['ci'], foundation: true },
      { name: 'Independent proof', args: ['run', 'proof:independent'], independent: true },
    ],
    env: { npm_execpath: '/npm' },
    spawn(_command, args) {
      ran.push(args.join(' '))
      return { status: 1 }
    },
    report() {},
  })

  assert.equal(passed, false)
  assert.deepEqual(ran, ['/npm ci'], 'nothing can run without its dependencies')
})

test('a step nobody ran is reported as NOT RUN rather than left out', () => {
  const lines = []
  runRequiredCi({
    steps: [
      { name: 'Bundle budget', args: ['run', 'check:bundle'] },
      { name: 'Fast suite', args: ['test'] },
    ],
    env: { npm_execpath: '/npm' },
    spawn(_command, args) {
      return { status: args.includes('check:bundle') ? 1 : 0 }
    },
    report(line) {
      lines.push(line)
    },
  })

  assert.ok(lines.includes('NOT RUN Fast suite'))
})

test('durations are stable and human-readable', () => {
  assert.equal(formatDuration(1234), '1.2s')
})

test('the required runner invokes the lifecycle npm CLI through the current Node executable', () => {
  const calls = []
  const env = { npm_execpath: 'C:\\npm\\npm-cli.js' }
  const passed = runRequiredCi({
    steps: [{ name: 'Probe npm', args: ['--version'] }],
    env,
    execPath: 'C:\\node\\node.exe',
    spawn(command, args, options) {
      calls.push({ command, args, options })
      return { status: 0 }
    },
    report() {},
  })

  assert.equal(passed, true)
  assert.deepEqual(calls, [{
    command: 'C:\\node\\node.exe',
    args: ['C:\\npm\\npm-cli.js', '--version'],
    options: { env, stdio: 'inherit' },
  }])
})

test('the required runner fails clearly without npm lifecycle metadata', () => {
  const errors = []
  let spawnCalled = false
  const passed = runRequiredCi({
    steps: [{ name: 'Probe npm', args: ['--version'] }],
    env: {},
    spawn() {
      spawnCalled = true
      return { status: 0 }
    },
    report() {},
    reportError(message) {
      errors.push(message)
    },
  })

  assert.equal(passed, false)
  assert.equal(spawnCalled, false)
  assert.deepEqual(errors, [
    'Required CI must run inside the pinned npm lifecycle; npm_execpath is missing.',
  ])
})

test('the required runner reports process-creation failures', () => {
  const errors = []
  const passed = runRequiredCi({
    steps: [{ name: 'Install locked dependencies', args: ['ci'] }],
    env: { npm_execpath: 'C:\\npm\\npm-cli.js' },
    spawn() {
      return { status: 0, error: new Error('spawn EINVAL') }
    },
    report() {},
    reportError(message) {
      errors.push(message)
    },
  })

  assert.equal(passed, false)
  assert.deepEqual(errors, [
    'Unable to start npm for Install locked dependencies: spawn EINVAL',
  ])
})

test('a step with attempts retries on failure and passes once an attempt succeeds', () => {
  const lines = []
  const ran = []
  let auditSpawns = 0
  const passed = runRequiredCi({
    steps: [
      { name: 'Audit production dependencies', args: ['audit'], attempts: 3 },
      { name: 'Subsequent step', args: ['run', 'subsequent'] },
    ],
    env: { npm_execpath: '/npm' },
    spawn(_command, args) {
      ran.push(args.join(' '))
      if (args.includes('audit')) {
        auditSpawns++
        return { status: auditSpawns < 3 ? 1 : 0 }
      }
      return { status: 0 }
    },
    report(line) {
      lines.push(line)
    },
  })

  assert.equal(passed, true)
  assert.equal(auditSpawns, 3)
  assert.deepEqual(ran, [
    '/npm audit',
    '/npm audit',
    '/npm audit',
    '/npm run subsequent',
  ])
  assert.deepEqual(
    lines.filter((line) => line.startsWith('RETRY')),
    [
      'RETRY Audit production dependencies (attempt 2 of 3)',
      'RETRY Audit production dependencies (attempt 3 of 3)',
    ],
  )
  assert.ok(lines.some((line) => line.startsWith('PASS Audit production dependencies')))
  assert.ok(lines.some((line) => line.startsWith('PASS Subsequent step')))
})

test('a step failing every attempt yields FAIL and blocks later non-independent steps', () => {
  const lines = []
  const ran = []
  let auditSpawns = 0
  const passed = runRequiredCi({
    steps: [
      { name: 'Audit production dependencies', args: ['audit'], attempts: 3 },
      { name: 'Dependent step', args: ['run', 'dependent'] },
      { name: 'PostgreSQL canaries', args: ['run', 'test:postgres-canaries'], independent: true },
    ],
    env: { npm_execpath: '/npm' },
    spawn(_command, args) {
      ran.push(args.join(' '))
      if (args.includes('audit')) {
        auditSpawns++
        return { status: 1 }
      }
      return { status: 0 }
    },
    report(line) {
      lines.push(line)
    },
  })

  assert.equal(passed, false)
  assert.equal(auditSpawns, 3)
  assert.deepEqual(ran, [
    '/npm audit',
    '/npm audit',
    '/npm audit',
    '/npm run test:postgres-canaries',
  ])
  assert.deepEqual(
    lines.filter((line) => line.startsWith('RETRY')),
    [
      'RETRY Audit production dependencies (attempt 2 of 3)',
      'RETRY Audit production dependencies (attempt 3 of 3)',
    ],
  )
  assert.ok(lines.some((line) => line.startsWith('FAIL Audit production dependencies')))
  assert.ok(lines.includes('NOT RUN Dependent step'))
})
