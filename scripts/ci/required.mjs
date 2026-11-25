import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Run the app gates in dependency order and report skipped steps after a failure.
export const REQUIRED_STEPS = Object.freeze([
  { name: 'Install locked dependencies', args: ['ci', '--no-audit', '--no-fund'], foundation: true },
  // A persistent advisory is still a failure because three identical failures
  // in a row are not a transient outage; the retry exists only because the
  // advisories endpoint returns 5xx or hangs under load.
  {
    name: 'Audit production dependencies',
    args: ['audit', '--omit=dev', '--audit-level=high', '--fetch-timeout=60000', '--fetch-retries=3'],
    attempts: 3,
  },
  { name: 'Verify CI tooling', args: ['run', 'test:ci-tools'] },
  { name: 'Enforce design-system authority', args: ['run', 'ci:design-system'] },
  { name: 'Enforce workflow policy', args: ['run', 'ci:workflow-policy'] },
  // `build` compiles the renderer. This separate pass covers
  // the Electron and tooling projects that the one-build renderer proof does
  // not reach; otherwise a main-process-only contract change can surface only
  // minutes deep in packaging, behind a native gate that may skip itself.
  { name: 'Type-check the projects build does not', args: ['run', 'typecheck:outside-build'] },
  { name: 'Type-check and build', args: ['run', 'build'] },
  { name: 'Enforce bundle budget', args: ['run', 'check:bundle'] },
  { name: 'Run fast behavior suite', args: ['test'] },

])

export function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`
}

export function runRequiredCi({
  steps = REQUIRED_STEPS,
  env = process.env,
  execPath = process.execPath,
  spawn = spawnSync,
  report = console.log,
  reportError = console.error,
} = {}) {
  const npmCli = env.npm_execpath
  if (typeof npmCli !== 'string' || npmCli.trim() === '') {
    reportError('Required CI must run inside the pinned npm lifecycle; npm_execpath is missing.')
    return false
  }

  const results = []
  let blocked = false
  let abandoned = false

  for (const step of steps) {
    if (abandoned || (blocked && step.independent !== true)) {
      // Recorded rather than dropped. A step nobody ran has not passed, and a
      // summary that leaves it out invites the reader to assume it did.
      results.push({ ...step, duration: 0, passed: false, ran: false })
      report(`NOT RUN ${step.name}`)
      continue
    }

    report(`\n::group::${step.name}`)
    // A step can demand its own environment on top of whatever invoked the
    // gate. `requireEnv` always wins over an existing value: a developer's own
    // export must not quietly loosen what a required step is required to prove.
    const stepEnv = step.requireEnv ? { ...env, ...step.requireEnv } : env
    const maxAttempts = typeof step.attempts === 'number' && step.attempts > 1 ? step.attempts : 1
    let result
    let duration = 0
    let passed = false

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        report(`RETRY ${step.name} (attempt ${attempt} of ${maxAttempts})`)
      }
      const startedAt = performance.now()
      result = spawn(execPath, [npmCli, ...step.args], { env: stepEnv, stdio: 'inherit' })
      duration += performance.now() - startedAt
      passed = !result.error && result.status === 0
      if (passed) {
        break
      }
    }

    if (result.error) {
      reportError(`Unable to start npm for ${step.name}: ${result.error.message}`)
    }
    results.push({ ...step, duration, passed, ran: true })
    report('::endgroup::')
    report(`${passed ? 'PASS' : 'FAIL'} ${step.name} (${formatDuration(duration)})`)

    if (!passed) {
      blocked = true
      if (step.foundation === true) abandoned = true
    }
  }

  if (env.GITHUB_STEP_SUMMARY) {
    const rows = results.map((result) => {
      const verdict = result.ran === false ? 'NOT RUN' : (result.passed ? 'PASS' : 'FAIL')
      const duration = result.ran === false ? '-' : formatDuration(result.duration)
      return `| ${verdict} | ${result.name} | ${duration} |`
    })
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `\n### Required CI timings\n\n| Result | Gate | Duration |\n| --- | --- | ---: |\n${rows.join('\n')}\n`,
    )
  }

  return results.every((result) => result.passed) && results.length === steps.length
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = runRequiredCi() ? 0 : 1
}
