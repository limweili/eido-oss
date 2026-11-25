import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertForwardHotfixVersion,
  compareReleaseSnapshots,
  formatIncidentHotfixTranscript,
} from '../release/prove-incident-hotfix.mjs'

test('forward hotfix versions must be valid SemVer and strictly greater', () => {
  assert.doesNotThrow(() => assertForwardHotfixVersion('1.2.9', '1.2.10'))
  assert.doesNotThrow(() => assertForwardHotfixVersion('1.2.3-rc.1', '1.2.3'))
  assert.throws(
    () => assertForwardHotfixVersion('1.2.3', '1.2.3'),
    /strictly greater/,
  )
  assert.throws(
    () => assertForwardHotfixVersion('1.2.3', '1.2.2'),
    /strictly greater/,
  )
  assert.throws(
    () => assertForwardHotfixVersion('not-semver', '1.2.3'),
    /valid SemVer/,
  )
})

test('release snapshot comparison proves byte identity independently', () => {
  const before = Buffer.from('tag=v1.2.3\nasset=unchanged bytes\n')
  const same = compareReleaseSnapshots(before, Buffer.from(before))
  const changed = compareReleaseSnapshots(before, Buffer.from('tag=v1.2.3\nasset=changed\n'))

  assert.equal(same.unchanged, true)
  assert.equal(same.beforeSha256, same.afterSha256)
  assert.equal(changed.unchanged, false)
  assert.notEqual(changed.beforeSha256, changed.afterSha256)
})

test('incident transcript records notes, commands, and verdict legs', () => {
  const output = formatIncidentHotfixTranscript({
    startedAt: '2026-07-22T00:00:00.000Z',
    finishedAt: '2026-07-22T00:01:00.000Z',
    notes: ['Synthetic friend report flagged a defect in v1.2.3.'],
    commands: [{
      command: 'node',
      args: ['scripts/release/promote-release.mjs', 'promote', '--version', '1.2.4'],
      exitCode: 0,
      stdout: '{"verdict":"PROMOTED"}\n',
      stderr: '',
    }],
    summary: [{
      status: 'PASS',
      leg: 'forward hotfix',
      detail: 'v1.2.4 published alongside v1.2.3.',
    }],
  })

  assert.match(output, /^Eido release incident hotfix proof transcript/m)
  assert.match(output, /Synthetic friend report flagged a defect/)
  assert.match(output, /COMMAND 1/)
  assert.match(output, /argv: node "scripts\/release\/promote-release\.mjs" "promote" "--version" "1\.2\.4"/)
  assert.match(output, /PASS: forward hotfix — v1\.2\.4 published alongside v1\.2\.3\./)
})
