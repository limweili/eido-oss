import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

import { createReleaseCandidateBody } from './promote-release.mjs'
import {
  loadPublicReleasePolicy,
  loadPublicReleaseTemplate,
} from './public-release-repository.mjs'
import { readReleaseToolchain } from './release-planning.mjs'

const root = resolve(import.meta.dirname, '..', '..')
const promotionCli = resolve(import.meta.dirname, 'promote-release.mjs')
const policyPath = join(root, 'release/public-repository/policy.json')
const defaultTranscript = join(
  root,
  'release/planning/promotion-proof-transcript.txt',
)
const sha256 = (content) => createHash('sha256').update(content).digest('hex')
const json = (value) => `${JSON.stringify(value, null, 2)}\n`

function requireProof(condition, message) {
  if (!condition) throw new Error(message)
}

function makeTarget(version, sourceSha, toolchain) {
  const assets = ['darwin-arm64', 'win32-x64'].map((platform) => ({
    platform,
    name: `Eido-${version}-${platform}${platform === 'darwin-arm64' ? '.dmg' : '.exe'}`,
    content: Buffer.from(`Eido promotion proof\n${version}\n${platform}\n`),
  }))
  return {
    assets,
    target: {
      version,
      sourceSha,
      evidenceKind: 'release-target',
      status: 'promotable',
      promotable: true,
      toolchain,
      platformEvidence: assets.map((asset) => ({
        platform: asset.platform,
        sourceSha,
        evidenceKind: 'sealed-candidate',
        digest: `sha256:${sha256(asset.content)}`,
      })),
    },
  }
}

async function byteSnapshot(directory) {
  const entries = []
  async function visit(path) {
    for (const name of (await readdir(path)).sort()) {
      const absolute = join(path, name)
      const metadata = await lstat(absolute)
      const snapshotPath = relative(directory, absolute)
      if (metadata.isDirectory()) {
        entries.push([`${snapshotPath}/`, 'directory'])
        await visit(absolute)
      } else if (metadata.isSymbolicLink()) {
        entries.push([snapshotPath, 'symlink', await readlink(absolute)])
      } else {
        const content = await readFile(absolute)
        entries.push([snapshotPath, 'file', content.length, sha256(content)])
      }
    }
  }
  await visit(directory)
  return Buffer.from(json(entries))
}

function transcript({ commands, finishedAt, notes, startedAt, summary }) {
  const output = [
    'Eido release promotion proof transcript',
    `startedAt: ${startedAt}`,
    `finishedAt: ${finishedAt}`,
    '',
    'NOTES',
    ...notes.map((note) => `- ${note}`),
    '',
  ]
  commands.forEach((entry, index) => output.push(
    `COMMAND ${index + 1}`,
    `argv: ${[entry.command, ...entry.args.map((argument) => JSON.stringify(argument))].join(' ')}`,
    `exitCode: ${entry.exitCode}`,
    'stdout:',
    entry.stdout || '(empty)',
    'stderr:',
    entry.stderr || '(empty)',
    '',
  ))
  output.push(
    'SUMMARY',
    ...summary.map(({ detail, leg, status }) => `${status}: ${leg} — ${detail}`),
    '',
  )
  return output.join('\n')
}

async function provePromotion() {
  const commands = []
  const notes = []
  const summary = []
  const startedAt = new Date().toISOString()
  const temp = await mkdtemp(join(tmpdir(), 'eido-promotion-proof-'))
  const proofId = `${startedAt.replace(/[-:.TZ]/g, '')}-${randomBytes(3).toString('hex')}`
  let backend
  let failure
  let pendingGithubRepository

  function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
      cwd: options.cwd ?? root,
      encoding: 'utf8',
      input: options.input,
      maxBuffer: 20 * 1024 * 1024,
    })
    const captured = {
      command,
      args,
      exitCode: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? result.error?.message ?? '',
    }
    commands.push(captured)
    if (!options.allowFailure && captured.exitCode !== 0) {
      throw new Error(
        `${command} failed (${captured.exitCode}): ${captured.stderr.trim() || captured.stdout.trim()}`,
      )
    }
    return captured
  }

  function gh(args) {
    return run('gh', args).stdout.trim()
  }

  async function deletePendingGithubRepository(allowNotFound = false) {
    if (!pendingGithubRepository) return
    const repository = pendingGithubRepository
    const result = run(
      'gh',
      ['api', '--method', 'DELETE', `repos/${repository}`],
      { allowFailure: true },
    )
    if (result.exitCode === 0 || (
      allowNotFound && /HTTP 404/.test(`${result.stdout}\n${result.stderr}`)
    )) {
      pendingGithubRepository = undefined
      if (result.exitCode === 0) {
        notes.push(`Deleted disposable GitHub repository ${repository}.`)
      }
      return
    }
    throw new Error(`Failed to delete disposable GitHub repository ${repository}.`)
  }

  try {
    const policy = await loadPublicReleasePolicy()
    const toolchain = readReleaseToolchain(
      JSON.parse(await readFile(join(root, 'package.json'))),
    )
    requireProof(toolchain.issues.length === 0, 'Package toolchain evidence is invalid.')
    const sourceSha = run('git', ['rev-parse', 'HEAD']).stdout.trim()
    const stamp = Date.now()
    const versions = [`680.0.0-proof.${stamp}`, `680.0.1-proof.${stamp}`]
    const targets = versions.map(
      (version) => makeTarget(version, sourceSha, toolchain.toolchain),
    )
    const manifestPath = join(temp, 'manifest.json')
    await writeFile(manifestPath, json({
      schemaVersion: 1,
      manifestKind: 'release-planning',
      platforms: ['darwin-arm64', 'win32-x64'],
      targets: targets.map(({ target }) => target),
      externalDependencies: [{
        id: 'profile-agent-packaged-certification',
        parentIssue: { number: 520, url: 'https://github.com/limweili/eido/issues/520' },
        issue: { number: 528, url: 'https://github.com/limweili/eido/issues/528' },
        state: 'resolved',
        targetSha: sourceSha,
        certificationSetId: 'promotion-proof',
        evidence: [{
          kind: 'certification-manifest',
          digest: `sha256:${sha256('promotion-proof-certification')}`,
        }],
      }],
    }))

    const seed = join(temp, 'seed')
    run('git', ['init', '--initial-branch=main', seed])
    run('git', ['config', 'user.name', 'Eido Promotion Proof'], { cwd: seed })
    run('git', ['config', 'user.email', 'promotion-proof@invalid.example'], { cwd: seed })
    for (const file of await loadPublicReleaseTemplate(policy)) {
      const destination = join(seed, file.path)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, file.content)
    }
    run('git', ['add', '.'], { cwd: seed })
    run('git', ['commit', '-m', policy.template.commitMessage], { cwd: seed })

    async function prepareLocal(reason) {
      notes.push(`GitHub backend unavailable: ${reason}`)
      const bare = join(temp, 'target.git')
      const repository = `proof/eido-promotion-${proofId}`
      run('git', ['init', '--bare', '--initial-branch=main', bare])
      run('git', ['--git-dir', bare, 'config', 'eido.repositoryIdentity', repository])
      run('git', ['remote', 'remove', 'origin'], { cwd: seed, allowFailure: true })
      run('git', ['remote', 'add', 'origin', bare], { cwd: seed })
      run('git', ['push', 'origin', 'main'], { cwd: seed })
      for (const { assets, target } of targets) {
        run('git', ['switch', '--detach', 'main'], { cwd: seed })
        const releaseRoot = join(seed, '.eido-release')
        await mkdir(join(releaseRoot, 'assets'), { recursive: true })
        await writeFile(join(releaseRoot, 'release.json'), json({
          tagName: `v${target.version}`,
          name: `Eido ${target.version}`,
          body: createReleaseCandidateBody(target, 'Disposable promotion proof candidate.'),
        }))
        for (const asset of assets) {
          await writeFile(join(releaseRoot, 'assets', asset.name), asset.content)
        }
        run('git', ['add', '.eido-release'], { cwd: seed })
        run('git', ['commit', '-m', `chore: seed candidate v${target.version}`], { cwd: seed })
        run('git', ['push', 'origin', `HEAD:refs/eido/candidates/v${target.version}`], { cwd: seed })
      }
      backend = {
        kind: 'local-bare',
        repository,
        cliArgs: ['--local-bare', bare],
        snapshot: () => byteSnapshot(bare),
        cleanup: () => rm(temp, { recursive: true, force: true }),
      }
    }

    async function prepareGithub() {
      const owner = JSON.parse(gh(['api', 'user'])).login
      const repository = `${owner}/eido-promotion-proof-${proofId}`.toLowerCase()
      pendingGithubRepository = repository
      run('gh', [
        'repo', 'create', repository,
        '--public',
        '--description', 'Disposable Eido release promotion proof; safe to delete.',
        '--source', '.',
        '--remote', 'origin',
        '--push',
      ], { cwd: seed })
      for (const { assets, target } of targets) {
        const assetPaths = []
        for (const asset of assets) {
          const path = join(temp, asset.name)
          await writeFile(path, asset.content)
          assetPaths.push(path)
        }
        run('gh', [
          'release', 'create', `v${target.version}`, ...assetPaths,
          '--repo', repository,
          '--target', 'main',
          '--title', `Eido ${target.version}`,
          '--notes', createReleaseCandidateBody(target, 'Disposable promotion proof candidate.'),
          '--draft', '--prerelease',
        ])
      }
      backend = {
        kind: 'github',
        repository,
        cliArgs: [],
        snapshot: async () => Buffer.from([
          gh(['api', `repos/${repository}`]),
          gh(['api', `repos/${repository}/git/trees/main?recursive=1`]),
          gh(['api', `repos/${repository}/releases?per_page=100`, '--paginate', '--slurp']),
        ].join('\n')),
        cleanup: async () => {
          try {
            await deletePendingGithubRepository()
          } catch {
            await deletePendingGithubRepository()
          }
          await rm(temp, { recursive: true, force: true })
        },
      }
    }

    const auth = run('gh', ['auth', 'status'], { allowFailure: true })
    const authText = `${auth.stdout}\n${auth.stderr}`
    const hasRepo = /Token scopes:.*['"]repo['"]/.test(authText)
    const hasDelete = /Token scopes:.*['"]delete_repo['"]/.test(authText)
    if (auth.exitCode !== 0 || !hasRepo || !hasDelete) {
      await prepareLocal(
        auth.exitCode === 0
          ? `authenticated scopes cannot guarantee create-and-cleanup (repo=${hasRepo}, delete_repo=${hasDelete}).`
          : 'gh authentication is unavailable.',
      )
    } else {
      try {
        await prepareGithub()
      } catch (error) {
        await deletePendingGithubRepository(true)
        await prepareLocal(`GitHub setup failed safely: ${error.message}`)
      }
    }
    notes.push(`Proof backend: ${backend.kind}; target: ${backend.repository}.`)

    function promotion(action, version) {
      const result = run(process.execPath, [
        promotionCli,
        action,
        '--repository', backend.repository,
        ...(action === 'promote' ? ['--confirm', backend.repository] : []),
        '--version', version,
        '--manifest', manifestPath,
        '--policy', policyPath,
        '--proof',
        '--json',
        ...backend.cliArgs,
      ], { allowFailure: true })
      return { ...result, output: JSON.parse(result.stdout) }
    }

    const promoted = promotion('promote', versions[0])
    requireProof(promoted.exitCode === 0 && promoted.output.verdict === 'PROMOTED', 'Promotion failed.')
    const verified = promotion('verify', versions[0])
    requireProof(
      verified.exitCode === 0 && verified.output.verdict === 'PASS'
        && verified.output.release?.draft === false
        && verified.output.release?.prerelease === false,
      'Independent final verification failed.',
    )
    summary.push({
      status: 'PASS',
      leg: 'candidate-to-final promotion',
      detail: 'PROMOTED with exit 0; independent verify observed final/non-prerelease state.',
    })

    const beforeRepromotion = await backend.snapshot()
    const repromotion = promotion('promote', versions[0])
    const afterRepromotion = await backend.snapshot()
    requireProof(
      repromotion.exitCode === 1
        && repromotion.output.reason === 'release-already-final'
        && beforeRepromotion.equals(afterRepromotion),
      'Re-promotion refusal or immutability proof failed.',
    )
    summary.push({
      status: 'PASS',
      leg: 'immutable re-promotion refusal',
      detail: `BLOCK release-already-final with exit 1; before/after state SHA-256 ${sha256(beforeRepromotion)} matched byte-for-byte.`,
    })

    const beforeAbort = await backend.snapshot()
    const aborted = promotion('abort', versions[1])
    const afterAbort = await backend.snapshot()
    requireProof(
      aborted.exitCode === 0 && aborted.output.verdict === 'ABORTED'
        && aborted.output.repositoryMutation === 'none'
        && beforeAbort.equals(afterAbort),
      'Abort result or no-mutation proof failed.',
    )
    summary.push({
      status: 'PASS',
      leg: 'candidate abort',
      detail: `ABORTED with repositoryMutation none and exit 0; before/after state SHA-256 ${sha256(beforeAbort)} matched byte-for-byte.`,
    })
  } catch (error) {
    failure = error
    summary.push({ status: 'FAIL', leg: 'proof run', detail: error.message })
  } finally {
    try {
      if (backend) await backend.cleanup()
      else {
        await deletePendingGithubRepository(true)
        await rm(temp, { recursive: true, force: true })
      }
      notes.push(`Removed disposable proof root ${temp}.`)
      summary.push({ status: 'PASS', leg: 'cleanup', detail: 'Disposable target removed.' })
    } catch (error) {
      failure ??= error
      summary.push({ status: 'FAIL', leg: 'cleanup', detail: error.message })
    }
    await writeFile(defaultTranscript, transcript({
      commands,
      finishedAt: new Date().toISOString(),
      notes,
      startedAt,
      summary,
    }))
  }
  if (failure) throw failure
  return backend.kind
}

try {
  console.log(`PASS: ${await provePromotion()} promotion proof`)
  console.log(`Transcript: ${defaultTranscript}`)
} catch (error) {
  console.error(`FAIL: ${error.message}`)
  console.error(`Transcript: ${defaultTranscript}`)
  process.exitCode = 1
}
