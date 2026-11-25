import assert from 'node:assert/strict'
import test from 'node:test'

import {
  deriveFounderSetupCoach,
  formatFounderSetupCoach,
  inspectFounderSetup,
  macosSecretNames,
  macosVariableNames,
} from '../release-signing/founder-setup-coach.mjs'

const openIssueBody = `## Acceptance criteria

- [ ] First requirement
- [ ] Second requirement
`

const completeIssueBody = openIssueBody.replaceAll('[ ]', '[x]')

function snapshot({ environment, manifest, appleIssue, windowsIssue } = {}) {
  return {
    observedAt: '2026-07-22T00:00:00.000Z',
    apple: {
      issue: appleIssue ?? {
        state: 'OPEN',
        body: openIssueBody,
        url: 'https://github.com/limweili/eido/issues/677',
      },
      environment: environment ?? { status: 'absent' },
    },
    windows: {
      issue: windowsIssue ?? {
        state: 'OPEN',
        body: openIssueBody,
        url: 'https://github.com/limweili/eido/issues/678',
      },
      manifest: manifest ?? {
        identityContract: {
          bindingStatus: 'provider-unselected',
          providerClass: null,
          expectedPublisher: null,
          expectedCertificateThumbprintSha256: null,
          trustedTimestampRequired: true,
        },
      },
    },
  }
}

test('unknown external account facts become explicit founder questions without gating Alpha', () => {
  const report = deriveFounderSetupCoach(snapshot())

  assert.equal(report.posture.alphaGate, false)
  assert.match(report.posture.statement, /gates none of the unsigned Friends Alpha/)
  assert.equal(report.apple.status, 'founder-answer-required')
  assert.match(report.apple.nextAction, /answer .*not enrolled.*credentials ready/)
  assert.match(report.apple.evidence.at(-1), /no account state was inferred/)
  assert.equal(report.windows.status, 'founder-answer-required')
  assert.match(report.windows.currentStep, /not the state of private provider conversations/)
  assert.match(report.windows.nextAction, /answer requests not sent.*SSL\.com selected/)
})

test('a fresh not-started answer produces bounded actions with honest cost and lead-time language', () => {
  const report = deriveFounderSetupCoach(snapshot(), {
    appleStage: 'not-enrolled',
    windowsStage: 'not-sent',
  })

  assert.equal(report.apple.status, 'enrollment-needed')
  assert.match(report.apple.cost, /USD 99\/year/)
  assert.match(report.apple.leadTime, /Unknown/)
  assert.match(report.apple.nextAction, /Apple Developer Program enrollment/)

  assert.equal(report.windows.status, 'quote-request-needed')
  assert.match(report.windows.cost, /written quote required/i)
  assert.match(report.windows.cost, /USD 996/)
  assert.match(report.windows.cost, /USD 129\/year/)
  assert.match(report.windows.leadTime, /Unknown/)
  assert.match(report.windows.nextAction, /unchanged to both providers/)
})

test('live environment and manifest bindings hand technical proof back to the owning smoke docs', () => {
  const report = deriveFounderSetupCoach(snapshot({
    environment: {
      status: 'present',
      secretNames: macosSecretNames,
      variableNames: macosVariableNames,
    },
    manifest: {
      identityContract: {
        bindingStatus: 'bound',
        providerClass: 'digicert-keylocker',
        expectedPublisher: 'CN=Eido Pty Ltd, O=Eido Pty Ltd, C=AU',
        expectedCertificateThumbprintSha256: 'A'.repeat(64),
        trustedTimestampRequired: true,
      },
    },
  }))

  assert.equal(report.apple.status, 'ready-for-credentialed-smoke')
  assert.match(report.apple.nextAction, /follow macos-signing-smoke\.md/)
  assert.equal(report.windows.status, 'provider-bound-agent-handoff')
  assert.match(report.windows.nextAction, /workflow is allowed only after binding/)
  assert.doesNotMatch(report.windows.nextAction, /Founder: configure/)
})

test('formatted output states all four coaching fields for each flow', () => {
  const output = formatFounderSetupCoach(deriveFounderSetupCoach(snapshot()))

  assert.match(output, /Apple Developer enrollment/)
  assert.match(output, /Windows Authenticode onboarding/)
  assert.equal((output.match(/Prerequisites:/g) ?? []).length, 2)
  assert.equal((output.match(/Cost:/g) ?? []).length, 2)
  assert.equal((output.match(/Lead time:/g) ?? []).length, 2)
  assert.equal((output.match(/Exact next action:/g) ?? []).length, 2)
})

test('a completed issue with missing live configuration is an agent conflict, not repeated founder work', () => {
  const closed = { state: 'CLOSED', body: openIssueBody, url: 'https://example.test/issue' }
  const report = deriveFounderSetupCoach(snapshot({ appleIssue: closed, windowsIssue: closed }))

  assert.equal(report.apple.status, 'live-contract-conflict')
  assert.match(report.apple.nextAction, /Agent: reconcile/)
  assert.doesNotMatch(report.apple.nextAction, /Founder:/)
  assert.equal(report.windows.status, 'live-contract-conflict')
  assert.match(report.windows.nextAction, /Agent: reconcile/)
  assert.doesNotMatch(report.windows.nextAction, /Founder:/)
})

test('secret and variable names must exist in their authoritative namespaces', () => {
  const report = deriveFounderSetupCoach(snapshot({
    environment: {
      status: 'present',
      secretNames: [...macosSecretNames, ...macosVariableNames],
      variableNames: [],
    },
  }), { appleStage: 'credentials-ready' })

  assert.equal(report.apple.status, 'environment-provisioning-needed')
  for (const name of macosVariableNames) assert.match(report.apple.nextAction, new RegExp(name))
})

test('DigiCert can advance without waiting for the bounded SSL.com fallback', () => {
  const report = deriveFounderSetupCoach(snapshot(), { windowsStage: 'awaiting-responses' })

  assert.match(report.windows.currentStep, /DigiCert answer/)
  assert.match(report.windows.nextAction, /can advance without waiting for SSL\.com/)
})

test('a missing manifest is reported without losing the Apple live read', async () => {
  const gh = async (arguments_) => {
    if (arguments_[0] === 'api') return { environments: [] }
    return {
      state: 'OPEN',
      body: openIssueBody,
      url: `https://example.test/issues/${arguments_[2]}`,
    }
  }
  const live = await inspectFounderSetup({ repositoryRoot: '/definitely-missing-eido-root', gh })
  const report = deriveFounderSetupCoach(live)

  assert.equal(report.apple.status, 'founder-answer-required')
  assert.equal(report.windows.status, 'live-evidence-unavailable')
  assert.match(report.windows.evidence[1], /unavailable/)
})

test('completion requires closed issues and checked acceptance criteria', () => {
  const closedComplete = { state: 'CLOSED', body: completeIssueBody, url: 'https://example.test/issue' }
  const report = deriveFounderSetupCoach(snapshot({
    appleIssue: closedComplete,
    windowsIssue: closedComplete,
    environment: {
      status: 'present',
      secretNames: macosSecretNames,
      variableNames: macosVariableNames,
    },
    manifest: {
      identityContract: {
        bindingStatus: 'bound',
        providerClass: 'digicert-keylocker',
        expectedPublisher: 'CN=Eido Pty Ltd, O=Eido Pty Ltd, C=AU',
        expectedCertificateThumbprintSha256: 'A'.repeat(64),
        trustedTimestampRequired: true,
      },
    },
  }))

  assert.equal(report.apple.status, 'complete')
  assert.equal(report.windows.status, 'complete')
})
