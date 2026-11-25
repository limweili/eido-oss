// The one description of a valid packaged-certification evidence packet.
//
// Two suites need it: the certification suite, which proves the authority
// accepts and rejects the right packets, and the publication suite, which
// proves an uncertified or mismatched packet can never reach users. Keeping one
// copy means a change to the certification contract breaks both at once, which
// is the point -- a second, drifting copy would let the publication gate go on
// asserting against a shape certification no longer produces.

import {
  CERTIFICATION_CONTRACT_VERSIONS,
  CERTIFICATION_PACKAGE_IDENTITY,
  CERTIFICATION_PROOF_PATH_SET,
  CERTIFICATION_REUSED_PROOF,
  NATIVE_DESKTOP_PROOF_GATE_JOBS,
  NATIVE_DESKTOP_PROOF_WORKFLOW,
} from '../../certification/certification-manifest.mjs'

export const sourceSha = 'a'.repeat(40)
export const provedSourceSha = 'b'.repeat(40)
export const provedTreeSha256 = 'c'.repeat(64)

// One live-resolved proof revalidation, shaped exactly as
// scripts/certification/proof-revalidation.mjs writes it.
export const resolvedProofRevalidation = Object.freeze({
  schemaVersion: 2,
  pathSet: CERTIFICATION_PROOF_PATH_SET,
  revalidatedSourceSha: provedSourceSha,
  treeSha256: provedTreeSha256,
  evidence: {
    kind: 'native-desktop-proof-workflow-run',
    workflow: NATIVE_DESKTOP_PROOF_WORKFLOW,
    repository: 'limweili/eido',
    runId: 32322268004,
    runAttempt: 1,
    runUrl: 'https://github.com/limweili/eido/actions/runs/32322268004',
    event: 'push',
    branch: 'main',
    conclusion: 'success',
    headSha: provedSourceSha,
    jobs: NATIVE_DESKTOP_PROOF_GATE_JOBS.map((name, index) => ({
      id: 96286638283 + index,
      name,
      conclusion: 'success',
    })),
  },
})
export const certificationSetId = 'eido-cert-v2-12345-1'
export const digest = (character) => character.repeat(64)
export const expectedTeamId = 'A1B2C3D4E5'
export const expectedAuthority = `Developer ID Application: Wei Li Lim (${expectedTeamId})`
export const developerIdPosture = (cdHash) => ({
  status: 'developer-id',
  authority: expectedAuthority,
  teamIdentifier: expectedTeamId,
  cdHash,
  hardenedRuntime: 'enabled',
  secureTimestamp: true,
})

export function platformEvidence(platform, overrides = {}) {
  const mac = platform === 'darwin'
  return {
    schemaVersion: 2,
    certificationSetId,
    sourceSha,
    semver: '1.2.3-alpha.1',
    platform,
    arch: mac ? 'arm64' : 'x64',
    target: mac ? 'dmg' : 'nsis',
    packageIdentity: CERTIFICATION_PACKAGE_IDENTITY,
    artifact: {
      fileName: mac ? 'Eido-1.2.3-alpha.1-arm64.dmg' : 'Eido-Setup-1.2.3-alpha.1-x64.exe',
      sha256: mac ? digest('1') : digest('2'),
      bytes: mac ? 101 : 202,
    },
    ...(mac
      ? {
          updateArtifact: {
            fileName: 'Eido-1.2.3-alpha.1-arm64.zip',
            sha256: digest('8'),
            sha512: Buffer.alloc(64, 8).toString('base64'),
            bytes: 99,
            payloadEvidence: {
              appTreeSha256: digest('3'),
              matchesManualArtifact: true,
              signingVerified: true,
              nestedSigningVerified: true,
              packageIdentityVerified: true,
              notarizationStaple: 'validated',
              gatekeeper: 'accepted-notarized-developer-id',
            },
          },
        }
      : {}),
    artifactSigningPosture: mac
      ? {
          status: 'developer-id',
          format: 'dmg',
          identifier: 'dev.eido.app.dmg',
          authority: expectedAuthority,
          teamIdentifier: expectedTeamId,
          cdHash: '9123456789abcdef0123456789abcdef01234567',
          secureTimestamp: true,
          notarization: 'stapled',
          gatekeeper: 'accepted-notarized-developer-id',
        }
      : {
          status: 'NotSigned',
          publisher: null,
          certificateThumbprint: null,
          timestamp: null,
        },
    installedInventory: {
      sha256: mac ? digest('3') : digest('4'),
      entries: mac ? 31 : 29,
    },
    signingPosture: mac
      ? developerIdPosture('0123456789abcdef0123456789abcdef01234567')
      : {
          status: 'NotSigned',
          publisher: null,
          certificateThumbprint: null,
          timestamp: null,
        },
    nestedSigningPostures: mac
      ? [
          {
            path: 'Contents/Resources/bin/eido',
            signingPosture: developerIdPosture('1123456789abcdef0123456789abcdef01234567'),
          },
          {
            path: 'Contents/Resources/bin/eido-profile-live-gateway-helper',
            signingPosture: developerIdPosture('2123456789abcdef0123456789abcdef01234567'),
          },
          {
            path: 'Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt',
            signingPosture: developerIdPosture('3123456789abcdef0123456789abcdef01234567'),
          },
        ]
      : [
          'eido-profile-mcp.exe',
          'resources/bin/eido.exe',
          'resources/bin/eido-profile-live-gateway-helper.exe',
        ].map((path_) => ({
          path: path_,
          signingPosture: {
            status: 'NotSigned',
            publisher: null,
            certificateThumbprint: null,
            timestamp: null,
          },
        })),
    installedPackageIdentity: {
      appId: 'dev.eido.app',
      productName: 'Eido',
      semver: '1.2.3-alpha.1',
      executable: mac ? 'Eido' : 'Eido.exe',
      architecture: mac ? 'arm64' : 'x64',
      metadataSource: mac ? 'bundle-plist-and-mach-o' : 'asar-and-pe-version-resource',
    },
    executionIdentity: {
      hostedEnvironment: 'github-hosted',
      runnerOs: mac ? 'macOS' : 'Windows',
      runnerArch: mac ? 'ARM64' : 'X64',
      runnerName: mac ? 'GitHub Actions 100' : 'GitHub Actions 200',
      imageOs: mac ? 'macos15' : 'win25',
      imageVersion: '20260720.1',
      node: '24.12.0',
      npm: '11.6.2',
    },
    proofReuse: {
      schemaVersion: 2,
      policyVersion: 2,
      pathSet: resolvedProofRevalidation.pathSet,
      providerSourceSha: CERTIFICATION_REUSED_PROOF.darwin.sourceSha,
      revalidatedSourceSha: resolvedProofRevalidation.revalidatedSourceSha,
      checkedSourceSha: sourceSha,
      treeSha256: resolvedProofRevalidation.treeSha256,
      relevantPathsUnchanged: true,
      evidence: structuredClone(resolvedProofRevalidation.evidence),
    },
    listenerEvidence: {
      transientDriverClosed: true,
      installedAgentTransport: 'owner-only-local-ipc-plus-stdio',
      reusedProofSha256: CERTIFICATION_REUSED_PROOF[platform].sha256,
    },
    contractVersions: CERTIFICATION_CONTRACT_VERSIONS,
    installedJourney: {
      guiEditRestart: true,
      offlineRelaunch: true,
      cliBound: true,
      liveCliBound: true,
      agentSurfaceV3Bound: true,
      spatialBound: true,
      changeTrailBound: true,
      agentRunsLiveOnlyBound: true,
      mcpBound: true,
      uninstall: true,
      reinstall: true,
      firstReleaseMigration: 'not-applicable',
    },
    negativeInventory: {
      leanAllowlist: true,
      noVectorSurface: true,
      noUnexpectedListener: true,
      noSourceMaps: true,
      noCredentials: true,
      noPrivateSource: true,
      noInternalDocumentation: true,
      noTestsFixturesOrTooling: true,
    },
    reusedProofReferences: [
      CERTIFICATION_REUSED_PROOF[platform],
    ],
    evidenceSha256: mac ? digest('6') : digest('7'),
    ...overrides,
  }
}
