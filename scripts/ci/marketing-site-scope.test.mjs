import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyMarketingSiteChanges,
  decideMarketingSiteScope,
} from './marketing-site-scope.mjs'

const base = 'b'.repeat(40)
const head = 'c'.repeat(40)

test('a change entirely inside site uses the marketing-only lane', () => {
  assert.deepEqual(
    classifyMarketingSiteChanges([
      'site/index.html',
      'site/assets/site.css',
      'site/assets/fonts/open-sans.woff2',
    ]),
    {
      marketingOnly: true,
      reason: 'all 3 changed paths are inside site/',
      changedPathCount: 3,
    },
  )
})

test('mixed, release, and empty changes use the full app lane', () => {
  assert.equal(
    classifyMarketingSiteChanges(['site/index.html', 'src/App.tsx']).marketingOnly,
    false,
  )
  assert.equal(
    classifyMarketingSiteChanges(['.github/workflows/desktop-release.yml']).marketingOnly,
    false,
  )
  assert.equal(
    classifyMarketingSiteChanges(['electron/updateEndpoints.ts']).marketingOnly,
    false,
  )
  assert.deepEqual(classifyMarketingSiteChanges([]), {
    marketingOnly: false,
    reason: 'no changed paths were found',
    changedPathCount: 0,
  })
})

test('pull requests classify the branch changes from their merge base', () => {
  let compared
  const decision = decideMarketingSiteScope({
    eventName: 'pull_request',
    baseSha: base,
    headSha: head,
    mergeBase: (left, right) => {
      assert.deepEqual([left, right], [base, head])
      return 'd'.repeat(40)
    },
    changedPathsBetween: (left, right) => {
      compared = [left, right]
      return ['site/privacy.html']
    },
  })

  assert.deepEqual(compared, ['d'.repeat(40), head])
  assert.equal(decision.marketingOnly, true)
})

test('pushes classify the exact pushed range without a merge-base lookup', () => {
  let compared
  const decision = decideMarketingSiteScope({
    eventName: 'push',
    baseSha: base,
    headSha: head,
    mergeBase: () => assert.fail('push scope must use the exact before SHA'),
    changedPathsBetween: (left, right) => {
      compared = [left, right]
      return ['site/terms.html']
    },
  })

  assert.deepEqual(compared, [base, head])
  assert.equal(decision.marketingOnly, true)
})

test('manual, malformed, empty-before, and unreadable comparisons fail open to full CI', () => {
  for (const decision of [
    decideMarketingSiteScope({ eventName: 'workflow_dispatch' }),
    decideMarketingSiteScope({ eventName: 'pull_request', baseSha: '', headSha: head }),
    decideMarketingSiteScope({ eventName: 'push', baseSha: '0'.repeat(40), headSha: head }),
    decideMarketingSiteScope({
      eventName: 'pull_request',
      baseSha: base,
      headSha: head,
      mergeBase: () => {
        throw new Error('unavailable')
      },
    }),
  ]) {
    assert.equal(decision.marketingOnly, false)
  }
})
