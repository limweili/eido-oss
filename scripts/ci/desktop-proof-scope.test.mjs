import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { computeProfileRuntimeFingerprint } from '../certification/certification-manifest.mjs'
import { decideDesktopProofScope } from './desktop-proof-scope.mjs'

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..')
const base = 'b'.repeat(40)
const head = 'c'.repeat(40)
const mergeBase = () => base

test('a pull request that leaves the packaged runtime tree alone does no native work', () => {
  const decision = decideDesktopProofScope({
    eventName: 'pull_request',
    baseSha: base,
    headSha: head,
    mergeBase,
    computeFingerprint: () => 'a'.repeat(64),
  })

  assert.equal(decision.inScope, false)
  assert.match(decision.reason, /packaged runtime tree is unchanged/)
})

test('a pull request that moves the packaged runtime tree runs the native matrix', () => {
  const decision = decideDesktopProofScope({
    eventName: 'pull_request',
    baseSha: base,
    headSha: head,
    mergeBase,
    computeFingerprint: (sha) => (sha === head ? 'd'.repeat(64) : 'a'.repeat(64)),
  })

  assert.equal(decision.inScope, true)
  assert.match(decision.reason, /packaged runtime tree moved/)
})

test('the decision compares the merge base, not the moving tip of main', () => {
  // Main advancing under an unrebased pull request must not drag that pull
  // request into a native run it did not cause. The push run on main covers
  // main's own change.
  let compared
  const decision = decideDesktopProofScope({
    eventName: 'pull_request',
    baseSha: base,
    headSha: head,
    mergeBase: (left, right) => {
      compared = [left, right]
      return 'e'.repeat(40)
    },
    computeFingerprint: () => 'a'.repeat(64),
  })

  assert.deepEqual(compared, [base, head])
  assert.equal(decision.inScope, false)
  assert.match(decision.reason, new RegExp(`unchanged from ${'e'.repeat(8)}`))
})

test('anything that is not a pull request always does the real work', () => {
  for (const eventName of ['push', 'workflow_dispatch']) {
    // Given a comparison it could narrow, it still must not: a push to main is
    // already path-filtered and a manual dispatch is deliberate, and both are
    // what later proof-reuse resolution looks for.
    const decision = decideDesktopProofScope({
      eventName,
      baseSha: base,
      headSha: head,
      mergeBase,
      computeFingerprint: () => assert.fail('a non-pull-request event must not be narrowed'),
    })
    assert.equal(decision.inScope, true, eventName)
    assert.equal(decision.reason, `${eventName} always runs the native proof`)
  }
})

test('an unreadable comparison fails open into the real proof, never out of it', () => {
  for (const broken of [
    { baseSha: '', headSha: head },
    { baseSha: base, headSha: 'not-a-sha' },
  ]) {
    assert.equal(decideDesktopProofScope({ eventName: 'pull_request', ...broken }).inScope, true)
  }
  assert.equal(
    decideDesktopProofScope({
      eventName: 'pull_request',
      baseSha: base,
      headSha: head,
      mergeBase: () => '',
    }).inScope,
    true,
  )
})

test('the decision reads the same fingerprint the certification harness enforces', () => {
  // One rule, not two. If this drifted into a private copy of the path list,
  // the gate could skip a change that certification would later refuse.
  const source = readFileSync(new URL('./desktop-proof-scope.mjs', import.meta.url), 'utf8')
  assert.match(source, /import \{ computeProfileRuntimeFingerprint \} from '\.\.\/certification\/certification-manifest\.mjs'/)
  assert.doesNotMatch(source, /pathPatterns|\.github\/workflows/)

  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim()
  const decision = decideDesktopProofScope({
    eventName: 'pull_request',
    baseSha: headSha,
    headSha,
    cwd: repositoryRoot,
    mergeBase: () => headSha,
  })
  assert.equal(decision.inScope, false)
  assert.equal(decision.fingerprint, computeProfileRuntimeFingerprint('HEAD', { cwd: repositoryRoot }))
})
