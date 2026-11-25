import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RUNTIME_POLICY_COMMAND = 'node scripts/ci/toolchain-policy.mjs --runtime'
const REPOSITORY_POLICY_COMMAND = `${RUNTIME_POLICY_COMMAND} --repository`
const REQUIRED_POLICY_COMMAND = 'npm run ci:toolchain && node scripts/ci/required.mjs'
const RUNTIME_GUARD_PREFIX = 'npm run ci:runtime --silent && '
const POLICY_ENTRYPOINTS = new Set(['preinstall', 'ci:runtime', 'ci:toolchain', 'ci:required'])
const CI_NODE_VERSION_FILE = '.github/node-version'

function parseVersion(value) {
  const match = String(value ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:\+[\w.-]+)?$/)
  return match ? match.slice(1).map(Number) : undefined
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function parseRangeVersion(value) {
  const parts = value.replace(/^v/, '').split('.')
  if (parts.length > 3 || parts.some((part) => !/^(?:\d+|[xX*])$/.test(part))) return undefined
  const wildcard = parts.findIndex((part) => /^[xX*]$/.test(part))
  const precision = wildcard === -1 ? parts.length : wildcard
  const numbers = parts.slice(0, precision).map(Number)
  while (numbers.length < 3) numbers.push(0)
  return { numbers, precision }
}

function parseRange(range) {
  if (typeof range !== 'string') return undefined
  const alternatives = range.split('||').map((alternative) => alternative.trim()
    .replace(/(>=|<=|>|<|=|\^)\s+/g, '$1').split(/\s+/).map((constraint) => {
      const comparator = constraint.match(/^(>=|<=|>|<|=|\^)?(.+)$/)
      if (!comparator) return undefined
      const bound = parseRangeVersion(comparator[2])
      return bound && { operator: comparator[1] ?? '', ...bound }
    }))
  return alternatives.every((constraints) => constraints.every(Boolean)) ? alternatives : undefined
}

function satisfiesConstraint(version, { operator, numbers, precision }) {
  const comparison = compareVersions(version, numbers)

  if (operator === '^') {
    const upper = [...numbers]
    if (upper[0] > 0) {
      upper[0] += 1
      upper[1] = 0
      upper[2] = 0
    } else if (upper[1] > 0) {
      upper[1] += 1
      upper[2] = 0
    } else {
      upper[2] += 1
    }
    return comparison >= 0 && compareVersions(version, upper) < 0
  }

  if (operator === '>=') return comparison >= 0
  if (operator === '>') return comparison > 0
  if (operator === '<=') return comparison <= 0
  if (operator === '<') return comparison < 0
  if (operator === '=') return comparison === 0

  if (precision === 0) return true
  if (precision === 3) return comparison === 0
  const upper = [...numbers]
  upper[precision - 1] += 1
  for (let index = precision; index < upper.length; index += 1) upper[index] = 0
  return comparison >= 0 && compareVersions(version, upper) < 0
}

function satisfiesRange(version, range) {
  return parseRange(range)?.some((constraints) => constraints.every((constraint) =>
    satisfiesConstraint(version, constraint),
  )) ?? false
}

export function inspectDeclaredToolchain(manifest) {
  const issues = []
  const runtime = manifest?.devEngines?.runtime
  const packageManager = manifest?.devEngines?.packageManager
  const nodeEngine = manifest?.engines?.node
  const npmEngine = manifest?.engines?.npm

  if (!parseRange(nodeEngine)) {
    issues.push('package.json: engines.node must declare a valid Node version range.')
  }
  if (!parseRange(npmEngine)) {
    issues.push('package.json: engines.npm must declare a valid npm version range.')
  }
  if (
    runtime?.name !== 'node'
    || runtime?.version !== nodeEngine
    || runtime?.onFail !== 'warn'
  ) {
    issues.push('package.json: devEngines.runtime must mirror engines.node with onFail set to warn so the Eido runtime guard can provide remediation.')
  }
  if (
    packageManager?.name !== 'npm'
    || packageManager?.version !== npmEngine
    || packageManager?.onFail !== 'warn'
  ) {
    issues.push('package.json: devEngines.packageManager must mirror engines.npm with onFail set to warn so the Eido runtime guard can provide remediation.')
  }
  return {
    issues,
    toolchain: issues.length === 0 ? Object.freeze({ nodeEngine, npmEngine }) : undefined,
  }
}

export function inspectLockedNodeEngines(lock, nodeVersion) {
  const version = parseVersion(nodeVersion)
  if (!version) return [`Unable to inspect lockfile engines with invalid Node version ${nodeVersion}.`]

  const issues = []
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    const range = entry.engines?.node
    if (range && !satisfiesRange(version, range)) {
      issues.push(`${path || '<root>'} requires Node ${range}, which rejects ${nodeVersion}.`)
    }
  }
  return issues
}

export function inspectRuntimeToolchain({ nodeVersion, npmVersion }, toolchain = {}) {
  const issues = []
  const parsedNode = parseVersion(nodeVersion)
  const parsedNpm = parseVersion(npmVersion)

  if (!parsedNode) {
    issues.push(`Unable to determine a stable Node.js version. Install a version that satisfies ${toolchain.nodeEngine}.`)
  } else if (!satisfiesRange(parsedNode, toolchain.nodeEngine)) {
    issues.push(`Node.js ${nodeVersion} does not satisfy Eido's supported range ${toolchain.nodeEngine}. Switch Node.js versions and rerun the command.`)
  }
  if (!parsedNpm) {
    issues.push(`Unable to determine a stable npm version. Install a version that satisfies ${toolchain.npmEngine}.`)
  } else if (!satisfiesRange(parsedNpm, toolchain.npmEngine)) {
    issues.push(`npm ${npmVersion} does not satisfy Eido's supported range ${toolchain.npmEngine}. Switch npm versions and rerun the command.`)
  }

  return issues
}

function workflowJobs(source) {
  const lines = source.split(/\r?\n/)
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line))
  if (jobsIndex === -1) return []

  const starts = []
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index]) && !/^\s*#/.test(lines[index])) break
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) starts.push(index)
  }

  return starts.map((start, index) => lines.slice(start, starts[index + 1] ?? lines.length).join('\n'))
}

function inspectWorkflow(source, path) {
  const issues = []
  for (const job of workflowJobs(source)) {
    const setupCount = (job.match(/actions\/setup-node@/g) ?? []).length
    const usesNode = /\b(?:npm|npx)\s/.test(job)
    if (usesNode && setupCount === 0) {
      issues.push(`${path}: every npm or npx job must set up the supported Node runtime.`)
      continue
    }
    if (setupCount === 0) continue

    const versionFileCount = (job.match(/^\s+node-version-file:\s*['"]?\.github\/node-version['"]?\s*$/gm) ?? []).length
    if (versionFileCount !== setupCount || /^\s+node-version:\s*/m.test(job)) {
      issues.push(`${path}: every setup-node step must use node-version-file: ${CI_NODE_VERSION_FILE}.`)
    }

    if (/npm\s+install\s+(?:--global|-g)\s+npm@/i.test(job)) {
      issues.push(`${path}: use npm bundled with the CI version of Node.js.`)
    }
  }
  return issues
}

async function readWorkflows(root) {
  const directory = join(root, '.github', 'workflows')
  const entries = await readdir(directory, { withFileTypes: true })
  const workflows = []
  for (const entry of entries) {
    if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue
    workflows.push({
      name: entry.name,
      source: await readFile(join(directory, entry.name), 'utf8'),
    })
  }
  return workflows
}

async function inspectRepositorySurfaces(root, manifest, toolchain) {
  const issues = []
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))

  if (manifest.scripts?.preinstall !== RUNTIME_POLICY_COMMAND) {
    issues.push('package.json: preinstall must fail closed through the runtime toolchain policy.')
  }
  if (manifest.scripts?.['ci:runtime'] !== RUNTIME_POLICY_COMMAND) {
    issues.push('package.json: ci:runtime must remain the direct runtime policy entrypoint.')
  }
  if (manifest.scripts?.['ci:toolchain'] !== REPOSITORY_POLICY_COMMAND) {
    issues.push('package.json: ci:toolchain must validate the runtime and repository policy.')
  }
  if (manifest.scripts?.['ci:required'] !== REQUIRED_POLICY_COMMAND) {
    issues.push('package.json: ci:required must enforce ci:toolchain before the canonical required runner.')
  }
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (POLICY_ENTRYPOINTS.has(name)) continue
    if (typeof command !== 'string' || !command.startsWith(RUNTIME_GUARD_PREFIX)) {
      issues.push(`package.json: script "${name}" must begin with npm run ci:runtime --silent.`)
    }
  }

  const lockEngines = lock.packages?.['']?.engines
  if (
    toolchain
    && (lockEngines?.node !== toolchain.nodeEngine || lockEngines?.npm !== toolchain.npmEngine)
  ) {
    issues.push('package-lock.json: root engines must match package.json.')
  }
  const ciMajor = (await readFile(join(root, CI_NODE_VERSION_FILE), 'utf8')).trim()
  if (!/^[1-9]\d*$/.test(ciMajor)) {
    issues.push(`${CI_NODE_VERSION_FILE}: declare a Node.js major version for CI.`)
  } else if (toolchain) {
    const latestInCiMajor = [Number(ciMajor), Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
    if (!satisfiesRange(latestInCiMajor, toolchain.nodeEngine)) {
      issues.push(`${CI_NODE_VERSION_FILE}: Node.js ${ciMajor} must satisfy engines.node in package.json.`)
    }
    if (satisfiesRange(parseVersion(process.versions.node), toolchain.nodeEngine)) {
      issues.push(...inspectLockedNodeEngines(lock, process.versions.node))
    }
  }

  const workflowDirectory = join(root, '.github', 'workflows')
  const workflows = await readWorkflows(root)
  for (const { name, source } of workflows) {
    issues.push(...inspectWorkflow(source, `.github/workflows/${name}`))
  }

  const ciSource = await readFile(join(workflowDirectory, 'ci.yml'), 'utf8')
  if ((ciSource.match(/run:\s*npm run ci:required\s*$/gm) ?? []).length !== 1) {
    issues.push('.github/workflows/ci.yml: npm run ci:required must remain the one canonical gate invocation.')
  }

  return issues
}

export async function inspectRepositoryToolchain(root = process.cwd()) {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const declared = inspectDeclaredToolchain(manifest)
  return [
    ...declared.issues,
    ...await inspectRepositorySurfaces(root, manifest, declared.toolchain),
  ]
}

export function detectRuntimeToolchain({
  env = process.env,
  nodeVersion = process.versions.node,
  platform = process.platform,
  spawn = spawnSync,
} = {}) {
  const userAgent = env.npm_config_user_agent
  const npmFromUserAgent = userAgent?.match(/^npm\/([^\s]+)/)?.[1]
  if (userAgent) {
    return { nodeVersion, npmVersion: npmFromUserAgent }
  }

  const npm = platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = platform === 'win32'
    ? spawn(`${npm} --version`, { encoding: 'utf8', shell: true })
    : spawn(npm, ['--version'], { encoding: 'utf8', shell: false })
  return {
    nodeVersion,
    npmVersion: result.status === 0 ? result.stdout.trim() : undefined,
  }
}

export async function runToolchainPolicy({
  args = process.argv.slice(2),
  root = process.cwd(),
  runtime,
} = {}) {
  const supported = new Set(['--runtime', '--repository'])
  const unknown = args.find((argument) => !supported.has(argument))
  if (unknown) return [`Unknown toolchain policy mode: ${unknown}.`]
  if (args.length === 0) return ['Choose at least one toolchain policy mode: --runtime or --repository.']

  const issues = []
  try {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const declared = inspectDeclaredToolchain(manifest)
    issues.push(...declared.issues)
    if (args.includes('--runtime') && declared.toolchain) {
      issues.push(...inspectRuntimeToolchain(runtime ?? detectRuntimeToolchain(), declared.toolchain))
    }
    if (args.includes('--repository')) {
      issues.push(...await inspectRepositorySurfaces(root, manifest, declared.toolchain))
    }
  } catch (error) {
    issues.push(`Toolchain policy inspection failed: ${error.message}`)
  }
  return issues
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isCli) {
  const issues = await runToolchainPolicy()
  if (issues.length > 0) {
    console.error('Toolchain policy failed:')
    for (const issue of issues) console.error(`- ${issue}`)
    process.exitCode = 1
  } else {
    console.log('Toolchain policy passed.')
  }
}
