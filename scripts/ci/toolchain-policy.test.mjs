import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import test from 'node:test'

import {
  detectRuntimeToolchain,
  inspectDeclaredToolchain,
  inspectRepositoryToolchain,
  inspectLockedNodeEngines,
  inspectRuntimeToolchain,
  runToolchainPolicy,
} from './toolchain-policy.mjs'

const currentManifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const currentDeclaration = inspectDeclaredToolchain(currentManifest)
assert.deepEqual(currentDeclaration.issues, [])
const currentToolchain = currentDeclaration.toolchain
const node24 = '24.0.0'
const node26 = '26.9.0'
const npm11 = '11.0.0'

function supportedEngines(nodeRange = currentToolchain.nodeEngine, npmRange = currentToolchain.npmEngine) {
  return {
    engines: { node: nodeRange, npm: npmRange },
    devEngines: {
      runtime: { name: 'node', version: nodeRange, onFail: 'warn' },
      packageManager: { name: 'npm', version: npmRange, onFail: 'warn' },
    },
  }
}

test('Node 24 and Node 26.9+ work with npm 11 without a version manager pin', () => {
  assert.equal(currentManifest.volta, undefined)
  assert.equal(currentManifest.packageManager, undefined)
  for (const nodeVersion of [node24, '24.21.0', node26, '26.13.1']) {
    assert.deepEqual(inspectRuntimeToolchain({ nodeVersion, npmVersion: npm11 }, currentToolchain), [])
    assert.deepEqual(inspectRuntimeToolchain({ nodeVersion, npmVersion: '11.17.0' }, currentToolchain), [])
  }
})

test('unsupported runtime versions produce fixes for both tools', () => {
  for (const nodeVersion of ['22.23.1', '25.0.0', '26.5.0', '27.0.0']) {
    assert.deepEqual(inspectRuntimeToolchain(
      { nodeVersion, npmVersion: '10.9.8' }, currentToolchain,
    ), [
      `Node.js ${nodeVersion} does not satisfy Eido's supported range ${currentToolchain.nodeEngine}. Switch Node.js versions and rerun the command.`,
      `npm 10.9.8 does not satisfy Eido's supported range ${currentToolchain.npmEngine}. Switch npm versions and rerun the command.`,
    ])
  }
})

test('an npm entrypoint reaches Eido remediation for an incompatible Node version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eido-toolchain-entrypoint-'))
  try {
    const script = 'scripts/ci/toolchain-policy.mjs'
    await mkdir(join(root, 'scripts', 'ci'), { recursive: true })
    await copyFile(new URL('./toolchain-policy.mjs', import.meta.url), join(root, script))
    await writeFile(join(root, 'package.json'), JSON.stringify({
      ...supportedEngines('>=99 <100'),
      scripts: { 'ci:runtime': `node ${script} --runtime` },
    }))

    const windows = process.platform === 'win32'
    const result = spawnSync(windows ? 'npm.cmd' : 'npm', ['run', 'ci:runtime', '--silent'], {
      cwd: root,
      encoding: 'utf8',
      shell: windows,
      env: {
        ...process.env,
        PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
      },
    })
    assert.ifError(result.error)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Node\.js .* does not satisfy Eido's supported range >=99 <100/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function makeToolchainFixture({ ciNode = '24', nodeEngine, npmEngine } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eido-toolchain-'))
  const declaration = supportedEngines(nodeEngine, npmEngine)
  await mkdir(join(root, '.github', 'workflows'), { recursive: true })
  await writeFile(join(root, '.github', 'node-version'), `${ciNode}\n`)
  await writeFile(join(root, 'package.json'), JSON.stringify({
    ...declaration,
    scripts: {
      preinstall: 'node scripts/ci/toolchain-policy.mjs --runtime',
      'ci:runtime': 'node scripts/ci/toolchain-policy.mjs --runtime',
      'ci:toolchain': 'node scripts/ci/toolchain-policy.mjs --runtime --repository',
      'ci:required': 'npm run ci:toolchain && node scripts/ci/required.mjs',
      typecheck: 'npm run ci:runtime --silent && tsc --noEmit',
    },
  }))
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({
    packages: { '': { engines: declaration.engines } },
  }))
  await writeFile(join(root, '.github', 'workflows', 'ci.yml'), `name: CI
jobs:
  required:
    steps:
      - uses: actions/setup-node@immutable
        with:
          node-version-file: .github/node-version
      - run: npm run ci:required
`)
  return root
}

test('malformed and prerelease versions fail closed', () => {
  assert.deepEqual(inspectRuntimeToolchain(
    { nodeVersion: '26.0.0-rc.1', npmVersion: undefined }, currentToolchain,
  ), [
    `Unable to determine a stable Node.js version. Install a version that satisfies ${currentToolchain.nodeEngine}.`,
    `Unable to determine a stable npm version. Install a version that satisfies ${currentToolchain.npmEngine}.`,
  ])
})

test('a non-npm lifecycle cannot be mistaken for the supported package manager', () => {
  const detected = detectRuntimeToolchain({
    env: { npm_config_user_agent: `yarn/4.9.2 npm/? node/v${node24} win32 x64` },
    nodeVersion: node24,
  })
  assert.deepEqual(detected, { nodeVersion: node24, npmVersion: undefined })
  assert.deepEqual(inspectRuntimeToolchain(detected, currentToolchain), [
    `Unable to determine a stable npm version. Install a version that satisfies ${currentToolchain.npmEngine}.`,
  ])
})

test('direct Windows policy checks execute the npm command shim through the shell', () => {
  const calls = []
  const detected = detectRuntimeToolchain({
    env: {},
    nodeVersion: node24,
    platform: 'win32',
    spawn(command, options) {
      calls.push({ command, options })
      return { status: 0, stdout: `${npm11}\n` }
    },
  })
  assert.deepEqual(detected, { nodeVersion: node24, npmVersion: npm11 })
  assert.deepEqual(calls, [{
    command: 'npm.cmd --version',
    options: { encoding: 'utf8', shell: true },
  }])
})

test('CI selects a supported major independently of the contributor runtime', async () => {
  const root = await makeToolchainFixture({ ciNode: '26' })
  try {
    assert.deepEqual(await runToolchainPolicy({
      args: ['--runtime', '--repository'], root,
      runtime: { nodeVersion: node24, npmVersion: npm11 },
    }), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an unsupported CI Node major fails the repository check', async () => {
  const root = await makeToolchainFixture({ ciNode: '25' })
  try {
    const issues = await inspectRepositoryToolchain(root)
    assert.ok(issues.includes('.github/node-version: Node.js 25 must satisfy engines.node in package.json.'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the lockfile and CI version file stay coherent with toolchain policy', async () => {
  const root = await makeToolchainFixture()
  try {
    const lockPath = join(root, 'package-lock.json')
    const lock = JSON.parse(await readFile(lockPath, 'utf8'))
    lock.packages[''].engines.npm = '>=10 <12'
    await writeFile(lockPath, JSON.stringify(lock))

    const workflowPath = join(root, '.github', 'workflows', 'ci.yml')
    const workflow = await readFile(workflowPath, 'utf8')
    await writeFile(workflowPath, workflow.replace('node-version-file: .github/node-version', 'node-version: 24.13.0'))

    assert.deepEqual(await inspectRepositoryToolchain(root), [
      'package-lock.json: root engines must match package.json.',
      '.github/workflows/ci.yml: every setup-node step must use node-version-file: .github/node-version.',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the package declaration rejects malformed ranges and cross-field drift', () => {
  const manifest = supportedEngines('>=24 ||', '>=11 <12')
  manifest.devEngines.packageManager.version = '>=10 <12'
  const declaration = inspectDeclaredToolchain(manifest)
  assert.deepEqual(declaration.issues, [
    'package.json: engines.node must declare a valid Node version range.',
    'package.json: devEngines.packageManager must mirror engines.npm with onFail set to warn so the Eido runtime guard can provide remediation.',
  ])
  assert.equal(declaration.toolchain, undefined)
})

test('install and canonical CI entrypoints cannot bypass the toolchain policy', async () => {
  const root = await makeToolchainFixture()
  try {
    const path = join(root, 'package.json')
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    manifest.scripts['ci:required'] = 'node scripts/ci/required.mjs'
    await writeFile(path, JSON.stringify(manifest))
    assert.deepEqual(await inspectRepositoryToolchain(root), [
      'package.json: ci:required must enforce ci:toolchain before the canonical required runner.',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ordinary and newly added package scripts cannot bypass the runtime guard', async () => {
  const root = await makeToolchainFixture()
  try {
    const path = join(root, 'package.json')
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    manifest.scripts.typecheck = 'tsc --noEmit'
    manifest.scripts.lint = 'eslint .'
    await writeFile(path, JSON.stringify(manifest))
    assert.deepEqual(await inspectRepositoryToolchain(root), [
      'package.json: script "typecheck" must begin with npm run ci:runtime --silent.',
      'package.json: script "lint" must begin with npm run ci:runtime --silent.',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('workflows use the npm bundled with the CI version of Node', async () => {
  const root = await makeToolchainFixture()
  try {
    const path = join(root, '.github', 'workflows', 'ci.yml')
    const source = await readFile(path, 'utf8')
    await writeFile(path, source.replace(
      '      - run: npm run ci:required',
      '      - run: npm install --global npm@11.6.2\n      - run: npm run ci:required',
    ))
    assert.deepEqual(await inspectRepositoryToolchain(root), [
      '.github/workflows/ci.yml: use npm bundled with the CI version of Node.js.',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('both supported Node majors satisfy every locked dependency engine', async () => {
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
  assert.deepEqual(inspectLockedNodeEngines(lock, node24), [])
  assert.deepEqual(inspectLockedNodeEngines(lock, node26), [])
  assert.ok(inspectLockedNodeEngines(lock, '22.12.0').includes(
    `<root> requires Node ${currentToolchain.nodeEngine}, which rejects 22.12.0.`,
  ))
})

test('the policy entrypoint fails closed for a mismatched runtime and unknown modes', async () => {
  assert.deepEqual(await runToolchainPolicy({
    args: ['--runtime'], runtime: { nodeVersion: node26, npmVersion: npm11 },
  }), [])
  const failures = await runToolchainPolicy({
    args: ['--runtime'], runtime: { nodeVersion: '25.0.0', npmVersion: '12.0.0' },
  })
  assert.match(failures[0], /^Node\.js 25\.0\.0 does not satisfy/)
  assert.match(failures[1], /^npm 12\.0\.0 does not satisfy/)
  assert.deepEqual(await runToolchainPolicy({ args: ['--unknown'] }), [
    'Unknown toolchain policy mode: --unknown.',
  ])
})
