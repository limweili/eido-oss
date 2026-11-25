// The publication gate (#696, #978, ADR 0032).
//
// `Packaged certification` proves an artifact is signed, notarized, stapled,
// and Gatekeeper-accepted. `Desktop release publication` is what carries those
// bytes to users. Everything asserted here exists to stop the second one
// publishing something the first one never blessed.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  ArtifactVerificationError,
  PUBLISHED_PLATFORMS,
  REQUIRED_EVIDENCE_SCHEMA_VERSION,
  verifyCertifiedArtifacts,
} from '../release/verify-certified-artifacts.mjs'
import {
  certificationSetId,
  platformEvidence,
  sourceSha,
} from './fixtures/certification-evidence.mjs'

const workflowPath = new URL('../../.github/workflows/desktop-release.yml', import.meta.url)
const semver = '1.2.3-alpha.1'

/**
 * Lay out a downloaded certification run exactly as the publish job does:
 * one directory per feed key, each holding `package/` and `evidence/`.
 */
async function stageCertifiedRun(
  root,
  { darwinOverrides = {}, win32Overrides = {}, evidenceSemver = semver } = {},
) {
  const written = {}
  for (const { feedKey, platform } of PUBLISHED_PLATFORMS) {
    const overrides = platform === 'darwin' ? darwinOverrides : win32Overrides
    const bodies = platform === 'darwin' ? 'darwin artifact bytes' : 'win32 artifact bytes'
    const bytes = Buffer.from(bodies, 'utf8')

    const base = { ...platformEvidence(platform), semver: evidenceSemver }
    // Keep the recorded digest honest with the bytes actually written, so a
    // test that wants a mismatch has to ask for one.
    const evidence = {
      ...base,
      artifact: {
        ...base.artifact,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.byteLength,
      },
      installedPackageIdentity: { ...base.installedPackageIdentity, semver: evidenceSemver },
      ...overrides,
    }

    let updateBytes
    if (platform === 'darwin' && evidence.updateArtifact) {
      updateBytes = Buffer.from('darwin update archive bytes', 'utf8')
      evidence.updateArtifact = {
        ...evidence.updateArtifact,
        sha256: createHash('sha256').update(updateBytes).digest('hex'),
        sha512: createHash('sha512').update(updateBytes).digest('base64'),
        bytes: updateBytes.byteLength,
      }
    }

    await mkdir(path.join(root, feedKey, 'package'), { recursive: true })
    await mkdir(path.join(root, feedKey, 'evidence'), { recursive: true })
    await writeFile(path.join(root, feedKey, 'package', evidence.artifact.fileName), bytes)
    if (updateBytes) {
      await writeFile(path.join(root, feedKey, 'package', evidence.updateArtifact.fileName), updateBytes)
    }
    await writeFile(
      path.join(root, feedKey, 'evidence', 'platform-evidence.json'),
      JSON.stringify(evidence, null, 2),
      'utf8',
    )
    written[feedKey] = evidence
  }
  return written
}

function verifyStaged(root, overrides = {}) {
  return verifyCertifiedArtifacts({
    certificationSetId,
    semver,
    sourceSha,
    evidencePathFor: ({ feedKey }) => path.join(root, feedKey, 'evidence', 'platform-evidence.json'),
    packageDirectoryFor: ({ feedKey }) => path.join(root, feedKey, 'package'),
    ...overrides,
  })
}

async function withStagedRun(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eido-publish-'))
  try {
    return await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function refusal(promise) {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof ArtifactVerificationError, `expected a verification refusal, got ${error}`)
    return error.code
  }
  assert.fail('publication was allowed when it should have been refused')
}

test('a fully certified run publishes, reporting the certified names and digests', async () => {
  await withStagedRun(async (root) => {
    const staged = await stageCertifiedRun(root)
    const result = await verifyStaged(root)

    assert.equal(result.semver, semver)
    assert.equal(result.certificationSetId, certificationSetId)
    assert.deepEqual(Object.keys(result.platforms).sort(), ['darwin-arm64', 'win32-x64'])
    // The manifest is built from these, so they must be the certified values.
    assert.equal(result.platforms['darwin-arm64'].artifactName, staged['darwin-arm64'].artifact.fileName)
    assert.equal(result.platforms['darwin-arm64'].sha256, staged['darwin-arm64'].artifact.sha256)
    assert.equal(
      result.platforms['darwin-arm64'].updateArtifact.sha512,
      staged['darwin-arm64'].updateArtifact.sha512,
    )
    assert.equal(result.platforms['win32-x64'].artifactName, staged['win32-x64'].artifact.fileName)
  })
})

test('publication is refused when the macOS artifact was not signed with the Developer ID', async () => {
  await withStagedRun(async (root) => {
    // The exact posture an unsigned, ad-hoc build would record. This is the
    // case that made the whole gate necessary: before #696 every release was
    // built this way.
    await stageCertifiedRun(root, {
      darwinOverrides: {
        artifactSigningPosture: {
          status: 'NotSigned',
          publisher: null,
          certificateThumbprint: null,
          timestamp: null,
        },
      },
    })
    assert.equal(await refusal(verifyStaged(root)), 'platform-evidence-invalid')
  })
})

test('publication is refused when the macOS artifact was signed but never notarized or stapled', async () => {
  await withStagedRun(async (root) => {
    const signedButUnstapled = platformEvidence('darwin')
    await stageCertifiedRun(root, {
      darwinOverrides: {
        artifactSigningPosture: {
          ...signedButUnstapled.artifactSigningPosture,
          notarization: 'none',
          gatekeeper: 'rejected',
        },
      },
    })
    assert.equal(await refusal(verifyStaged(root)), 'platform-evidence-invalid')
  })
})

test('publication is refused for schemaVersion 1 evidence, which predates the signing gate', async () => {
  await withStagedRun(async (root) => {
    // v1 packets are legitimate history, but validatePlatformEvidence skips
    // artifactSigningPosture entirely for them. Publishing one would mean
    // publishing an artifact whose signature nothing ever checked.
    await stageCertifiedRun(root, { darwinOverrides: { schemaVersion: 1 } })
    assert.equal(await refusal(verifyStaged(root)), 'platform-evidence-schema-unpublishable')
  })
})

test('publication is refused when the bytes on disk are not the bytes that were certified', async () => {
  await withStagedRun(async (root) => {
    const staged = await stageCertifiedRun(root)
    // The signature was verified against the certified bytes. A different file
    // was never certified, however well-formed it looks.
    await writeFile(
      path.join(root, 'darwin-arm64', 'package', staged['darwin-arm64'].artifact.fileName),
      Buffer.from('substituted artifact bytes', 'utf8'),
    )
    assert.equal(await refusal(verifyStaged(root)), 'certified-artifact-digest-mismatch')
  })
})

test('publication is refused when the certified artifact is missing entirely', async () => {
  await withStagedRun(async (root) => {
    const staged = await stageCertifiedRun(root)
    await rm(path.join(root, 'darwin-arm64', 'package', staged['darwin-arm64'].artifact.fileName))
    assert.equal(await refusal(verifyStaged(root)), 'certified-artifact-missing')
  })
})

test('publication is refused when the evidence belongs to another certification set or commit', async () => {
  const otherCommit = 'b'.repeat(40)
  for (const [field, overrides, expected] of [
    ['set', { certificationSetId: 'eido-cert-v2-99999-1' }, 'platform-evidence-set-mismatch'],
    [
      'commit',
      {
        sourceSha: otherCommit,
        // Kept internally consistent, so the packet is a perfectly valid
        // certification of a different commit rather than a malformed one.
        proofReuse: { ...platformEvidence('darwin').proofReuse, checkedSourceSha: otherCommit },
      },
      'platform-evidence-source-mismatch',
    ],
  ]) {
    await withStagedRun(async (root) => {
      await stageCertifiedRun(root, { darwinOverrides: overrides })
      assert.equal(await refusal(verifyStaged(root)), expected, `${field} was not refused`)
    })
  }
})

test('publication is refused when the evidence certifies a different version than the one being released', async () => {
  await withStagedRun(async (root) => {
    // Internally consistent evidence for 9.9.9, dispatched as a release of
    // 1.2.3-alpha.1. Nothing inside the packet is wrong; it simply certifies a
    // different release, which is exactly the case a digest check alone misses.
    await stageCertifiedRun(root, { evidenceSemver: '9.9.9' })
    assert.equal(await refusal(verifyStaged(root)), 'platform-evidence-semver-mismatch')
  })
})

test('publication is refused when one platform is missing its evidence', async () => {
  await withStagedRun(async (root) => {
    await stageCertifiedRun(root)
    await rm(path.join(root, 'win32-x64', 'evidence', 'platform-evidence.json'))
    assert.equal(await refusal(verifyStaged(root)), 'platform-evidence-unreadable')
  })
})

test('the publish workflow builds nothing and publishes only what certification produced', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  // It must never build: a build here would be an artifact certification never
  // inspected. The only Node it runs are the manifest and verification steps.
  assert.doesNotMatch(workflow, /release:package|electron-builder/)
  assert.doesNotMatch(workflow, /--include\s+["']?\*\.zip/)
  assert.match(workflow, /aws s3 cp "\$RUNNER_TEMP\/release-dist\/\$DARWIN_ZIP"/)

  // The gate runs before anything is uploaded.
  const gateAt = workflow.indexOf('verify-certified-artifacts.mjs')
  const uploadAt = workflow.indexOf('aws s3 cp')
  assert.ok(gateAt > 0, 'the publish workflow must verify certified artifacts')
  assert.ok(uploadAt > gateAt, 'artifacts must be verified before they are uploaded')

  // Signing goes through the signer that cross-checks the compiled public key.
  assert.match(workflow, /sign-update-manifest\.mjs/)
  assert.match(workflow, /EIDO_UPDATE_MANIFEST_SIGNING_KEY/)
  assert.match(workflow, /EIDO_UPDATE_MANIFEST_PUBLIC_KEY_HEX/)

  // The manifest generator must not be handed a key directly: that path signs
  // without verifying against the key shipped inside the app.
  assert.doesNotMatch(workflow, /--key-env/)
  assert.doesNotMatch(workflow, /--key\s/)

  // Downloads must name the real certification artifacts and must not swallow
  // failure. `|| true` here previously turned a missing artifact into a
  // confusing hash error three steps later.
  assert.match(workflow, /eido-packaged-certification-\$\{CERTIFICATION_SET_ID\}-darwin-arm64/)
  assert.match(workflow, /eido-packaged-certification-\$\{CERTIFICATION_SET_ID\}-win32-x64/)
  assert.doesNotMatch(workflow, /\|\| true/)

  // The feed is published last and re-verified as a client would read it.
  assert.match(workflow, /verify-published-feed\.mjs --dir "\$LIVE" --version "\$SEMVER"/)
  assert.match(workflow, /https:\/\/updates\.eido\.so\/latest-mac\.yml/)
  assert.match(workflow, /live latest-mac\.yml differs from the certified release metadata/)
  assert.match(workflow, /live macOS update ZIP differs from the certified bytes/)

  // Releases share the same public feed and download aliases.
  assert.match(workflow, /^  group: desktop-release$/m)
  assert.match(workflow, /^  cancel-in-progress: false$/m)
})

test('the dependency-free publication job does not import undeclared packages', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  // This job intentionally does not run npm ci: it publishes already-certified
  // bytes and every checked-in release script it calls is self-contained. A
  // bare import in inline Node source therefore cannot resolve on a clean
  // runner, even when the package happens to exist in this worktree.
  assert.doesNotMatch(workflow, /npm ci/)
  assert.doesNotMatch(workflow, /\bfrom\s+['"](?!node:|[./])[^'"]+['"]/)
})

test('live macOS publication verifies exact metadata bytes and the certified ZIP identity', async () => {
  const workflow = await readFile(workflowPath, 'utf8')
  const metadataCheckAt = workflow.indexOf(
    'cmp -s "$RUNNER_TEMP/release-dist/latest-mac.yml" "$LIVE/latest-mac.yml"',
  )
  const zipDownloadAt = workflow.indexOf('curl -f -s -S "https://updates.eido.so/$DARWIN_ZIP"')
  assert.ok(metadataCheckAt > 0, 'the live metadata must equal the exact generated bytes')
  assert.ok(zipDownloadAt > metadataCheckAt, 'metadata must verify before its ZIP is downloaded')
  assert.match(workflow, /statSync\(process\.argv\[3\]\)\.size !== expected\.bytes/)
  assert.match(workflow, /createHash\('sha256'\).*\.digest\('hex'\) !== expected\.sha256/)
  assert.match(workflow, /createHash\('sha512'\).*\.digest\('base64'\) !== expected\.sha512/)
})

test('the publish workflow preserves the stable public download addresses', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  for (const alias of ['Eido-latest-arm64.dmg', 'Eido-latest-x64.exe']) {
    assert.ok(
      workflow.includes(`s3://\${R2_BUCKET_NAME}/${alias}`),
      `the publish workflow must republish ${alias}`,
    )
  }

  // The aliases are a human download path only. The manifest keeps naming the
  // versioned artifacts, because a client verifies the artifact it fetches by
  // digest, and a fixed name whose bytes change could never satisfy that.
  const manifestStepAt = workflow.indexOf('generate-update-manifest.mjs')
  const manifestStepEnd = workflow.indexOf('sign-update-manifest.mjs')
  const manifestStep = workflow.slice(manifestStepAt, manifestStepEnd)
  assert.ok(manifestStepAt > 0 && manifestStepEnd > manifestStepAt)
  assert.doesNotMatch(manifestStep, /Eido-latest/)

  // Same ordering discipline as the rest of the upload: every binary, aliases
  // included, is in place before the manifest that advertises the release.
  const lastAliasAt = workflow.lastIndexOf('s3://${R2_BUCKET_NAME}/Eido-latest-x64.exe')
  const manifestUploadAt = workflow.indexOf('s3://${R2_BUCKET_NAME}/eido-update.json"')
  assert.ok(manifestUploadAt > lastAliasAt, 'the manifest must be uploaded after the aliases')

  // A stable name with changing bytes behind Cloudflare's default cached
  // extensions would keep serving the previous release. Without this the
  // failure is silent and only a user sees it.
  assert.match(workflow, /Eido-latest-arm64\.dmg" \\\n\s+--cache-control "no-cache"/)
  assert.match(workflow, /Eido-latest-x64\.exe" \\\n\s+--cache-control "no-cache"/)

  assert.match(workflow, /Verify the stable download addresses serve this release/)
})

test('the publish workflow derives the certification run from the set id rather than trusting a second input', async () => {
  const workflow = await readFile(workflowPath, 'utf8')
  assert.match(workflow, /eido-cert-v2-\(\[0-9\]\{1,20\}\)-\(\[0-9\]\{1,10\}\)/)
  // gh run download must be pinned to that run, not left to pick the newest.
  assert.match(workflow, /gh run download "\$CERTIFICATION_RUN_ID"/)
})

test('the required evidence schema is the one that carries the signing posture', () => {
  // A guard on the constant itself: lowering it would silently reopen the v1
  // path, where the signing posture is never checked.
  assert.equal(REQUIRED_EVIDENCE_SCHEMA_VERSION, 2)
})
