// Selects the lightweight marketing-site lane only when every changed path is
// inside site/. Required workflows still start and report their stable check
// names; they simply avoid app installation, builds, and interaction tests.

import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FULL_SHA = /^[0-9a-f]{40}$/
const EMPTY_SHA = /^0{40}$/
export const MARKETING_SITE_PREFIX = 'site/'

function git(arguments_, cwd) {
  const result = spawnSync('git', arguments_, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) {
    throw new Error(`Marketing scope could not run git ${arguments_.join(' ')}: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

export function classifyMarketingSiteChanges(paths) {
  const changedPaths = [...new Set(paths.map((path) => path.trim()).filter(Boolean))]
  if (changedPaths.length === 0) {
    return {
      marketingOnly: false,
      reason: 'no changed paths were found',
      changedPathCount: 0,
    }
  }

  const outsideCount = changedPaths.filter((path) => !path.startsWith(MARKETING_SITE_PREFIX)).length
  if (outsideCount > 0) {
    return {
      marketingOnly: false,
      reason: `${outsideCount} of ${changedPaths.length} changed paths are outside site/`,
      changedPathCount: changedPaths.length,
    }
  }

  return {
    marketingOnly: true,
    reason: `all ${changedPaths.length} changed paths are inside site/`,
    changedPathCount: changedPaths.length,
  }
}

export function decideMarketingSiteScope({
  eventName,
  baseSha,
  headSha,
  cwd,
  mergeBase = (base, head) => git(['merge-base', base, head], cwd),
  changedPathsBetween = (base, head) => git(
    ['diff', '--name-only', '--no-renames', '--diff-filter=ACDMRTUXB', base, head],
    cwd,
  ).split('\n'),
} = {}) {
  if (eventName === 'workflow_dispatch') {
    return {
      marketingOnly: false,
      reason: 'manual dispatch always runs full app CI',
      changedPathCount: 0,
    }
  }
  if (!['pull_request', 'push'].includes(eventName)) {
    return {
      marketingOnly: false,
      reason: 'an unknown event always runs full app CI',
      changedPathCount: 0,
    }
  }
  if (
    !FULL_SHA.test(baseSha ?? '')
    || !FULL_SHA.test(headSha ?? '')
    || EMPTY_SHA.test(baseSha)
  ) {
    return {
      marketingOnly: false,
      reason: 'the compared revisions are not both usable full SHAs',
      changedPathCount: 0,
    }
  }

  try {
    const comparisonBase = eventName === 'pull_request' ? mergeBase(baseSha, headSha) : baseSha
    if (!FULL_SHA.test(comparisonBase ?? '') || EMPTY_SHA.test(comparisonBase)) {
      return {
        marketingOnly: false,
        reason: 'no usable comparison base could be read',
        changedPathCount: 0,
      }
    }
    return classifyMarketingSiteChanges(changedPathsBetween(comparisonBase, headSha))
  } catch {
    return {
      marketingOnly: false,
      reason: 'the changed paths could not be read, so full app CI is required',
      changedPathCount: 0,
    }
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isCli) {
  const decision = decideMarketingSiteScope({
    eventName: process.env.EIDO_CHANGE_SCOPE_EVENT_NAME,
    baseSha: process.env.EIDO_CHANGE_SCOPE_BASE_SHA,
    headSha: process.env.EIDO_CHANGE_SCOPE_HEAD_SHA,
  })
  process.stderr.write(
    `${decision.marketingOnly ? 'Marketing-only CI' : 'Full app CI'}: ${decision.reason}\n`,
  )
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, [
      `marketing_only=${decision.marketingOnly}`,
      `reason=${decision.reason}`,
      `changed_path_count=${decision.changedPathCount}`,
      '',
    ].join('\n'))
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n### CI scope\n\n${decision.marketingOnly ? 'Marketing-site checks only' : 'Full app checks'}: ${decision.reason}.\n`,
    )
  }
}
