import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AUTOMATIC_TRIGGERS = new Set(['push', 'pull_request', 'schedule', 'workflow_run'])
const EXPERIMENTAL_NAME = /\b(candidate evidence|baseline evidence|experimental evidence|performance (?:evidence|experiment))\b/i

function unquote(value) {
  return value.trim().replace(/^(['"])(.*)\1$/, '$2')
}

export function workflowName(source) {
  const match = source.match(/^name:\s*(.+?)\s*$/m)
  return match ? unquote(match[1]) : ''
}

export function workflowTriggers(source) {
  const lines = source.split(/\r?\n/)
  const onIndex = lines.findIndex((line) => /^on:\s*/.test(line))
  if (onIndex === -1) return []

  const inline = lines[onIndex].replace(/^on:\s*/, '').trim()
  if (inline) {
    if (inline.startsWith('[') && inline.endsWith(']')) {
      return inline.slice(1, -1).split(',').map((value) => unquote(value)).filter(Boolean)
    }
    return [unquote(inline)]
  }

  const triggers = []
  for (const line of lines.slice(onIndex + 1)) {
    if (/^\S/.test(line) && !/^\s*#/.test(line)) break
    const match = line.match(/^\s{2}([A-Za-z0-9_-]+)\s*:/)
    if (match) triggers.push(match[1])
  }
  return triggers
}

export function workflowJobs(source) {
  const lines = source.split(/\r?\n/)
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line))
  if (jobsIndex === -1) return []

  const jobs = []
  let current
  for (const line of lines.slice(jobsIndex + 1)) {
    if (/^\S/.test(line) && !/^\s*#/.test(line)) break
    const job = line.match(/^\s{2}([A-Za-z0-9_-]+)\s*:\s*$/)
    if (job) {
      current = { id: job[1], name: '' }
      jobs.push(current)
      continue
    }
    const name = line.match(/^\s{4}name:\s*(.+?)\s*$/)
    if (current && name) current.name = unquote(name[1])
  }
  return jobs
}

export function inspectWorkflow(source, path = 'workflow.yml') {
  const name = workflowName(source)
  const markedExperimental = /^#\s*ci-class:\s*experimental\s*$/m.test(source)
  if (!markedExperimental && !EXPERIMENTAL_NAME.test(name)) return []

  const triggers = workflowTriggers(source)
  const issues = []
  if (!markedExperimental) {
    issues.push(`${path}: experimental workflows must start with "# ci-class: experimental"`)
  }
  if (!triggers.includes('workflow_dispatch')) {
    issues.push(`${path}: experimental workflows must provide workflow_dispatch`)
  }

  const automatic = triggers.filter((trigger) => AUTOMATIC_TRIGGERS.has(trigger))
  if (automatic.length > 0) {
    issues.push(`${path}: experimental workflows cannot auto-run via ${automatic.join(', ')}`)
  }

  const jobs = workflowJobs(source)
  if (jobs.length === 0 || jobs.some((job) => !job.name.endsWith(' (experimental)'))) {
    issues.push(`${path}: every experimental job name must end with " (experimental)"`)
  }

  return issues
}

/**
 * The text of one job, so a check about that job cannot be satisfied elsewhere.
 *
 * Returns undefined when no job in the file carries the given `name:`. Matching
 * on the display name rather than the key is deliberate: the display name is
 * what branch protection requires, so it is the thing that must keep being true.
 */
export function jobSourceByName(source, jobName) {
  const lines = source.split(/\r?\n/)
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line))
  if (jobsIndex === -1) return undefined

  let current = null
  const blocks = []
  for (const line of lines.slice(jobsIndex + 1)) {
    if (/^\S/.test(line) && !/^\s*#/.test(line)) break
    if (/^\s{2}[A-Za-z0-9_-]+\s*:\s*$/.test(line)) {
      current = { lines: [line] }
      blocks.push(current)
      continue
    }
    if (current) current.lines.push(line)
  }

  const match = blocks.find((block) => block.lines.some((line) => {
    const name = line.match(/^\s{4}name:\s*(.+?)\s*$/)
    return name !== null && unquote(name[1]) === jobName
  }))
  return match === undefined ? undefined : match.lines.join('\n')
}

/** Keep one branch-protected verdict for whichever app lane was selected. */
export function inspectRequiredGate(source, path = '.github/workflows/ci.yml') {
  const issues = []
  const required = jobSourceByName(source, 'Required gate')
  if (required === undefined) {
    return [`${path}: no job is named "Required gate"; branch protection requires that aggregate name.`]
  }
  if (!/^\s{4}if:\s*\$\{\{\s*always\(\)\s*\}\}\s*$/m.test(required)) {
    issues.push(`${path}: the Required gate aggregate must use "if: \${{ always() }}".`)
  }
  if (!/^\s{4}needs:\s*\[scope, site, full\]\s*$/m.test(required)
      || !/^\s*- name: Enforce selected required lane$/m.test(required)) {
    issues.push(`${path}: the Required gate must aggregate scope, site, and full through the selected-lane enforcement step.`)
  }
  const full = jobSourceByName(source, 'Full app required lane')
  if (full === undefined) {
    issues.push(`${path}: no job is named "Full app required lane".`)
  } else if (/^\s*continue-on-error:\s*true\s*$/m.test(full)) {
    issues.push(`${path}: the full-app required lane cannot mark a step continue-on-error.`)
  }
  return issues
}

// A mapping value written as a plain (unquoted) scalar cannot contain ": ",
// because YAML reads that as a nested mapping. GitHub does not report this as
// a normal failure: the whole file fails to parse, the run is named after the
// file path instead of the workflow, no job is created, and every check that
// workflow owns silently never reports. A required check that never reports
// leaves a pull request pending forever, so this is caught here instead.
const BLOCK_SCALAR = /^(\s*)(?:- )?[A-Za-z0-9_.$-]+:[ \t]*[|>][-+0-9]*\s*$/
const MAPPING_LINE = /^(\s*)(?:- )?([A-Za-z0-9_.$-]+):[ \t]+(\S.*)$/
const SAFE_VALUE_START = /^['"|>[{&*!]/

export function inspectWorkflowSyntax(source, path = 'workflow.yml') {
  const issues = []
  let blockIndent
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (blockIndent !== undefined) {
      // Block scalar content is text, not YAML, until the indentation drops.
      if (line.trim() === '' || line.search(/\S/) > blockIndent) continue
      blockIndent = undefined
    }
    if (/^\s*#/.test(line) || line.trim() === '') continue
    const block = line.match(BLOCK_SCALAR)
    if (block) {
      blockIndent = block[1].length
      continue
    }
    const mapping = line.match(MAPPING_LINE)
    if (!mapping) continue
    const value = mapping[3].trimEnd()
    if (SAFE_VALUE_START.test(value)) continue
    if (!/: /.test(value) && !/:$/.test(value)) continue
    issues.push(
      `${path}:${index + 1}: plain scalar value contains ": ", which makes the file unparseable. `
        + 'Quote it or use a block scalar.',
    )
  }
  return issues
}

export async function validateWorkflowDirectory(directory = '.github/workflows') {
  const entries = await readdir(directory, { withFileTypes: true })
  const issues = []
  for (const entry of entries) {
    if (!entry.isFile() || !['.yml', '.yaml'].includes(extname(entry.name))) continue
    const path = join(directory, entry.name)
    const source = await readFile(path, 'utf8')
    const shown = relative(process.cwd(), path)
    issues.push(...inspectWorkflowSyntax(source, shown), ...inspectWorkflow(source, shown))
    if (entry.name === 'ci.yml') {
      issues.push(...inspectRequiredGate(source, shown))
    }
  }
  return issues
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isCli) {
  const issues = await validateWorkflowDirectory()
  if (issues.length > 0) {
    console.error('Workflow policy failed:')
    for (const issue of issues) console.error(`- ${issue}`)
    process.exitCode = 1
  } else {
    console.log('Workflow policy passed.')
  }
}
