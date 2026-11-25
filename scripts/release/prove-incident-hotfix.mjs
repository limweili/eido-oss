import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import { createReleaseCandidateBody } from './promote-release.mjs'
import {
  loadPublicReleasePolicy,
  loadPublicReleaseTemplate,
} from './public-release-repository.mjs'
import {
  CERTIFICATION_DEPENDENCY_ID,
  LOCKED_RELEASE_PLATFORMS,
  readReleaseToolchain,
} from './release-planning.mjs'

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/
const sha256 = (content) => createHash('sha256').update(content).digest('hex')
const json = (value) => `${JSON.stringify(value, null, 2)}\n`
const root = resolve(import.meta.dirname, '..', '..')
const planningCli = resolve(import.meta.dirname, 'release-planning.mjs')
const promotionCli = resolve(import.meta.dirname, 'promote-release.mjs')
const policyPath = join(root, 'release/public-repository/policy.json')
const defaultTranscript = join(
  root,
  'release/planning/incident-hotfix-proof-transcript.txt',
)

function requireProof(condition, message) {
  if (!condition) throw new Error(message)
}

function makeTarget(version, sourceSha) {
  const assets = LOCKED_RELEASE_PLATFORMS.map((platform) => ({
    platform,
    name: `Eido-${version}-${platform}${platform === 'darwin-arm64' ? '.dmg' : '.exe'}`,
    content: Buffer.from(`Eido incident hotfix proof\n${version}\n${platform}\n`),
  }))
  return {
    version,
    sourceSha,
    assets,
    platformEvidence: assets.map((asset) => ({
      platform: asset.platform,
      sourceSha,
      evidenceKind: 'sealed-candidate',
      digest: `sha256:${sha256(asset.content)}`,
    })),
  }
}

function releaseTargetFromManifest(manifest, version) {
  const target = manifest.targets.find((candidate) => candidate.version === version)
  requireProof(target, `Planning manifest omitted ${version}.`)
  return target
}

function parseSemver(version) {
  const match = typeof version === 'string' ? semverPattern.exec(version) : null
  if (!match) throw new Error(`${version} is not valid SemVer.`)
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split('.') ?? [],
  }
}

function comparePrerelease(left, right) {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? 0 : left.length === 0 ? 1 : -1
  }
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1
    if (right[index] === undefined) return 1
    if (left[index] === right[index]) continue
    const leftNumeric = /^\d+$/.test(left[index])
    const rightNumeric = /^\d+$/.test(right[index])
    if (leftNumeric && rightNumeric) return Number(left[index]) - Number(right[index])
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return left[index].localeCompare(right[index])
  }
  return 0
}

function compareSemver(leftVersion, rightVersion) {
  const left = parseSemver(leftVersion)
  const right = parseSemver(rightVersion)
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] - right.core[index]
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

export function assertForwardHotfixVersion(initialVersion, hotfixVersion) {
  parseSemver(initialVersion)
  parseSemver(hotfixVersion)
  if (compareSemver(hotfixVersion, initialVersion) <= 0) {
    throw new Error(`Forward hotfix ${hotfixVersion} must be strictly greater than ${initialVersion}.`)
  }
}

export function compareReleaseSnapshots(before, after) {
  const beforeBytes = Buffer.from(before)
  const afterBytes = Buffer.from(after)
  const beforeSha256 = sha256(beforeBytes)
  const afterSha256 = sha256(afterBytes)
  return {
    unchanged: beforeBytes.equals(afterBytes),
    beforeSha256,
    afterSha256,
  }
}

export function formatIncidentHotfixTranscript({
  commands,
  finishedAt,
  notes,
  startedAt,
  summary,
}) {
  const output = [
    'Eido release incident hotfix proof transcript',
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

function canonicalReleaseSnapshot({ assets, metadataBytes, tagName, tagOid }) {
  return Buffer.from(json({
    tagName,
    tagOid,
    metadata: {
      size: metadataBytes.length,
      sha256: sha256(metadataBytes),
    },
    assets: assets
      .map(({ bytes, name }) => ({
        name,
        size: bytes.length,
        sha256: sha256(bytes),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  }))
}

export async function proveIncidentHotfix() {
  const commands = []
  const notes = []
  const summary = []
  const startedAt = new Date().toISOString()
  const temp = await mkdtemp(join(tmpdir(), 'eido-incident-hotfix-proof-'))
  const proofId = `${startedAt.replace(/[-:.TZ]/g, '')}-${randomBytes(3).toString('hex')}`
  let backend
  let failure
  let pendingGithubRepository

  function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
      cwd: options.cwd ?? root,
      encoding: options.binary ? undefined : 'utf8',
      input: options.input,
      maxBuffer: 20 * 1024 * 1024,
    })
    const rawStdout = result.stdout ?? (options.binary ? Buffer.alloc(0) : '')
    const rawStderr = result.stderr ?? (options.binary ? Buffer.alloc(0) : '')
    const binaryStdout = Buffer.isBuffer(rawStdout) ? rawStdout : Buffer.from(rawStdout)
    const binaryStderr = Buffer.isBuffer(rawStderr) ? rawStderr : Buffer.from(rawStderr)
    const captured = {
      command,
      args,
      exitCode: result.status ?? 1,
      stdout: options.binary
        ? `<binary length=${binaryStdout.length} sha256=${sha256(binaryStdout)}>`
        : rawStdout,
      stderr: options.binary
        ? (binaryStderr.length > 0 ? binaryStderr.toString('utf8') : '')
        : (rawStderr || result.error?.message || ''),
    }
    commands.push(captured)
    if (!options.allowFailure && captured.exitCode !== 0) {
      throw new Error(
        `${command} failed (${captured.exitCode}): ${captured.stderr.trim() || captured.stdout.trim()}`,
      )
    }
    return { ...captured, rawStdout: binaryStdout }
  }

  function gh(args, options = {}) {
    const result = run('gh', args, options)
    return options.binary ? result.rawStdout : result.stdout.trim()
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
    const versions = [`686.0.0-proof.${stamp}`, `686.0.1-proof.${stamp}`]
    assertForwardHotfixVersion(versions[0], versions[1])
    const targets = versions.map((version) => makeTarget(version, sourceSha))
    const manifestPath = join(temp, 'manifest.json')
    await writeFile(manifestPath, json({
      schemaVersion: 1,
      manifestKind: 'release-planning',
      platforms: [...LOCKED_RELEASE_PLATFORMS],
      targets: [],
      externalDependencies: [{
        id: CERTIFICATION_DEPENDENCY_ID,
        parentIssue: { number: 520, url: 'https://github.com/limweili/eido/issues/520' },
        issue: { number: 528, url: 'https://github.com/limweili/eido/issues/528' },
        state: 'resolved',
        targetSha: sourceSha,
        certificationSetId: 'incident-hotfix-proof',
        evidence: [{
          kind: 'certification-manifest',
          digest: `sha256:${sha256('incident-hotfix-proof-certification')}`,
        }],
      }],
    }))

    const seed = join(temp, 'seed')
    run('git', ['init', '--initial-branch=main', seed])
    run('git', ['config', 'user.name', 'Eido Incident Hotfix Proof'], { cwd: seed })
    run('git', ['config', 'user.email', 'incident-hotfix-proof@invalid.example'], { cwd: seed })
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
      const repository = `proof/eido-incident-hotfix-${proofId}`
      run('git', ['init', '--bare', '--initial-branch=main', bare])
      run('git', ['--git-dir', bare, 'config', 'eido.repositoryIdentity', repository])
      run('git', ['remote', 'remove', 'origin'], { cwd: seed, allowFailure: true })
      run('git', ['remote', 'add', 'origin', bare], { cwd: seed })
      run('git', ['push', 'origin', 'main'], { cwd: seed })
      backend = {
        kind: 'local-bare',
        repository,
        cliArgs: ['--local-bare', bare],
        async seedCandidate(target, releaseTarget) {
          run('git', ['switch', '--detach', 'main'], { cwd: seed })
          const releaseRoot = join(seed, '.eido-release')
          await mkdir(join(releaseRoot, 'assets'), { recursive: true })
          await writeFile(join(releaseRoot, 'release.json'), json({
            tagName: `v${target.version}`,
            name: `Eido ${target.version}`,
            body: createReleaseCandidateBody(
              releaseTarget,
              'Disposable forward-hotfix incident drill candidate.',
            ),
          }))
          for (const asset of target.assets) {
            await writeFile(join(releaseRoot, 'assets', asset.name), asset.content)
          }
          run('git', ['add', '.eido-release'], { cwd: seed })
          run('git', ['commit', '-m', `chore: seed candidate v${target.version}`], { cwd: seed })
          run('git', ['push', 'origin', `HEAD:refs/eido/candidates/v${target.version}`], { cwd: seed })
        },
        async snapshot(target) {
          const tagName = `v${target.version}`
          const tagRef = `refs/tags/${tagName}`
          const tagOid = run('git', ['--git-dir', bare, 'rev-parse', tagRef]).stdout.trim()
          const metadata = run(
            'git',
            ['--git-dir', bare, 'show', `${tagRef}:.eido-release/release.json`],
            { binary: true },
          ).rawStdout
          const assets = target.assets.map((asset) => ({
            name: asset.name,
            bytes: run(
              'git',
              ['--git-dir', bare, 'show', `${tagRef}:.eido-release/assets/${asset.name}`],
              { binary: true },
            ).rawStdout,
          }))
          return canonicalReleaseSnapshot({
            assets,
            metadataBytes: metadata,
            tagName,
            tagOid,
          })
        },
        cleanup: () => rm(temp, { recursive: true, force: true }),
      }
    }

    async function prepareGithub() {
      const owner = JSON.parse(gh(['api', 'user'])).login
      const repository = `${owner}/eido-incident-hotfix-proof-${proofId}`.toLowerCase()
      pendingGithubRepository = repository
      run('gh', [
        'repo', 'create', repository,
        '--public',
        '--description', 'Disposable Eido forward-hotfix incident proof; safe to delete.',
        '--source', '.',
        '--remote', 'origin',
        '--push',
      ], { cwd: seed })
      backend = {
        kind: 'github',
        repository,
        cliArgs: [],
        async seedCandidate(target, releaseTarget) {
          const assetPaths = []
          for (const asset of target.assets) {
            const path = join(temp, asset.name)
            await writeFile(path, asset.content)
            assetPaths.push(path)
          }
          run('gh', [
            'release', 'create', `v${target.version}`, ...assetPaths,
            '--repo', repository,
            '--target', 'main',
            '--title', `Eido ${target.version}`,
            '--notes', createReleaseCandidateBody(
              releaseTarget,
              'Disposable forward-hotfix incident drill candidate.',
            ),
            '--draft', '--prerelease',
          ])
        },
        async snapshot(target) {
          const tagName = `v${target.version}`
          const tag = JSON.parse(gh(['api', `repos/${repository}/git/ref/tags/${tagName}`]))
          const release = JSON.parse(gh(['api', `repos/${repository}/releases/tags/${tagName}`]))
          const assets = target.assets.map((asset) => {
            const evidence = release.assets.find((candidate) => candidate.name === asset.name)
            requireProof(evidence, `Release snapshot omitted ${asset.name}.`)
            return {
              name: asset.name,
              bytes: gh([
                'api', `repos/${repository}/releases/assets/${evidence.id}`,
                '-H', 'Accept: application/octet-stream',
              ], { binary: true }),
            }
          })
          return canonicalReleaseSnapshot({
            assets,
            metadataBytes: Buffer.from(json({
              tagName: release.tag_name,
              draft: release.draft,
              prerelease: release.prerelease,
              body: release.body,
            })),
            tagName,
            tagOid: tag.object?.sha,
          })
        },
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

    function planning(action, args) {
      const result = run(process.execPath, [
        planningCli,
        action,
        ...args,
        '--manifest', manifestPath,
      ], { allowFailure: true })
      requireProof(result.exitCode === 0, `Release planning ${action} failed.`)
      const output = JSON.parse(result.stdout)
      requireProof(output.manifest, `Release planning ${action} returned no manifest.`)
      return output
    }

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

    async function planSealAndPromote(target) {
      const evidencePath = join(temp, `platform-evidence-${target.version}.json`)
      await writeFile(evidencePath, json(target.platformEvidence))
      let output = planning('declare', [
        '--version', target.version,
        '--source-sha', target.sourceSha,
        '--platform-evidence', evidencePath,
      ])
      await writeFile(manifestPath, json(output.manifest))
      output = planning('transition', [
        '--version', target.version,
        '--status', 'candidate',
      ])
      await writeFile(manifestPath, json(output.manifest))
      output = planning('transition', [
        '--version', target.version,
        '--status', 'promotable',
      ])
      await writeFile(manifestPath, json(output.manifest))
      const releaseTarget = releaseTargetFromManifest(output.manifest, target.version)
      await backend.seedCandidate(target, releaseTarget)
      const promoted = promotion('promote', target.version)
      requireProof(
        promoted.exitCode === 0 && promoted.output.verdict === 'PROMOTED',
        `Promotion failed for ${target.version}.`,
      )
      const verified = promotion('verify', target.version)
      requireProof(
        verified.exitCode === 0 && verified.output.verdict === 'PASS',
        `Independent final verification failed for ${target.version}.`,
      )
    }

    await planSealAndPromote(targets[0])
    summary.push({
      status: 'PASS',
      leg: 'initial release',
      detail: `Plan → Seal-equivalent → Promote published v${versions[0]} as final.`,
    })

    notes.push(
      `Synthetic incident: a friend report flagged a startup defect in published v${versions[0]}; the release bytes remained final and immutable.`,
    )
    const beforeHotfix = await backend.snapshot(targets[0])
    await planSealAndPromote(targets[1])
    const originalAfterHotfixVerify = promotion('verify', versions[0])
    requireProof(
      originalAfterHotfixVerify.exitCode === 0
        && originalAfterHotfixVerify.output.verdict === 'PASS',
      'Original release no longer verified after hotfix publication.',
    )
    summary.push({
      status: 'PASS',
      leg: 'forward hotfix',
      detail: `Strictly greater v${versions[1]} completed its own Plan → Seal-equivalent → Promote path alongside v${versions[0]}.`,
    })

    const afterHotfix = await backend.snapshot(targets[0])
    const coexistence = compareReleaseSnapshots(beforeHotfix, afterHotfix)
    requireProof(coexistence.unchanged, 'Original release changed during hotfix publication.')
    summary.push({
      status: 'PASS',
      leg: 'original release immutability',
      detail: `v${versions[0]} tag, metadata, digests, and re-fetched asset bytes remained byte-for-byte unchanged at SHA-256 ${coexistence.beforeSha256}.`,
    })

    const abort = promotion('abort', versions[0])
    requireProof(
      abort.exitCode === 1
        && abort.output.verdict === 'BLOCK'
        && abort.output.reason === 'final-release-is-immutable',
      'Rollback/abort refusal did not return final-release-is-immutable.',
    )
    const afterAbort = await backend.snapshot(targets[0])
    const refusal = compareReleaseSnapshots(beforeHotfix, afterAbort)
    requireProof(refusal.unchanged, 'Abort refusal mutated the original final release.')
    summary.push({
      status: 'PASS',
      leg: 'rollback refusal',
      detail: `Abort of final v${versions[0]} returned BLOCK final-release-is-immutable with exit 1; snapshot SHA-256 ${refusal.afterSha256} remained unchanged.`,
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
    await writeFile(defaultTranscript, formatIncidentHotfixTranscript({
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

const isCli = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isCli) {
  try {
    console.log(`PASS: ${await proveIncidentHotfix()} forward-hotfix incident proof`)
    console.log(`Transcript: ${defaultTranscript}`)
  } catch (error) {
    console.error(`FAIL: ${error.message}`)
    console.error(`Transcript: ${defaultTranscript}`)
    process.exitCode = 1
  }
}
