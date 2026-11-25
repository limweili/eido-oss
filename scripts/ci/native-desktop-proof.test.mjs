import assert from 'node:assert/strict'
import test from 'node:test'

import { readNativeProofIdentity } from './native-desktop-proof.mjs'

const testedSha = 'a'.repeat(40)
const baseSha = 'b'.repeat(40)

function declaredEnvironment(overrides = {}) {
  return {
    EIDO_DESKTOP_PROOF_TESTED_SHA: testedSha,
    EIDO_DESKTOP_PROOF_HEAD_SHA: testedSha,
    EIDO_DESKTOP_PROOF_BASE_SHA: baseSha,
    EIDO_DESKTOP_PROOF_EXPECTED_PLATFORM: 'darwin',
    EIDO_DESKTOP_PROOF_EXPECTED_ARCH: 'arm64',
    ...overrides,
  }
}

test('native proof identity binds a full exact head to the declared platform and architecture', () => {
  assert.deepEqual(readNativeProofIdentity({
    env: declaredEnvironment(),
    platform: 'darwin',
    arch: 'arm64',
    revision: testedSha,
    requireDeclared: true,
  }), {
    testedSha,
    headSha: testedSha,
    baseSha,
  })
})

test('native proof identity fails closed for missing or mismatched workflow declarations', () => {
  const options = { platform: 'darwin', arch: 'arm64', revision: testedSha, requireDeclared: true }

  assert.throws(
    () => readNativeProofIdentity({ ...options, env: declaredEnvironment({ EIDO_DESKTOP_PROOF_TESTED_SHA: '' }) }),
    /declare its tested SHA/,
  )
  assert.throws(
    () => readNativeProofIdentity({ ...options, env: declaredEnvironment({ EIDO_DESKTOP_PROOF_TESTED_SHA: 'c'.repeat(40) }) }),
    /Tested SHA .* did not match/,
  )
  assert.throws(
    () => readNativeProofIdentity({ ...options, env: declaredEnvironment({ EIDO_DESKTOP_PROOF_HEAD_SHA: 'c'.repeat(40) }) }),
    /was not exact head/,
  )
  assert.throws(
    () => readNativeProofIdentity({ ...options, env: declaredEnvironment({ EIDO_DESKTOP_PROOF_BASE_SHA: 'not-a-sha' }) }),
    /Base evidence identity was not a full SHA/,
  )
  assert.throws(
    () => readNativeProofIdentity({ ...options, env: declaredEnvironment({ EIDO_DESKTOP_PROOF_EXPECTED_PLATFORM: 'win32' }) }),
    /platform darwin did not match win32/,
  )
  assert.throws(
    () => readNativeProofIdentity({ ...options, env: declaredEnvironment({ EIDO_DESKTOP_PROOF_EXPECTED_ARCH: 'x64' }) }),
    /architecture arm64 did not match x64/,
  )
})
