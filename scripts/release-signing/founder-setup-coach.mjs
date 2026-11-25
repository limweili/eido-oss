import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { MACOS_SIGNING_SMOKE_ENVIRONMENT_CONTRACT } from './macos-smoke.mjs'
import {
  classifyWindowsSigningIdentityContract,
  WINDOWS_SIGNING_IDENTITY_FIELDS,
} from './windows-smoke.mjs'

const repository = 'limweili/eido'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const appleStages = ['not-enrolled', 'enrolled', 'credentials-ready']
const windowsStages = [
  'not-sent',
  'awaiting-responses',
  'responses-received',
  'selected-digicert',
  'selected-ssl',
]

export const macosSecretNames = Object.values(MACOS_SIGNING_SMOKE_ENVIRONMENT_CONTRACT.secrets)
export const macosVariableNames = Object.values(MACOS_SIGNING_SMOKE_ENVIRONMENT_CONTRACT.variables)

const appleCost = 'USD 99/year membership; confirm taxes, local pricing, and any other amount with Apple.'
const quoteCost = 'Written quote required. Public displays: DigiCert USD 65/month/certificate or USD 996/12 months with 1,000 signings; SSL.com USD 129/year OV plus USD 15/month/240 annual signings, while another page says USD 20/month or USD 180/year. These conflicts are not a budget or approval.'

export function deriveFounderSetupCoach(snapshot, answers = {}) {
  return {
    schemaVersion: 1,
    observedAt: snapshot.observedAt,
    posture: {
      phase: 'Phase 2 signing upgrade',
      alphaGate: false,
      statement: 'This pull-only coach gates none of the unsigned Friends Alpha (E1 through R) or earlier work. Only S3 consumes S1 and S2.',
    },
    apple: deriveApple(snapshot.apple, answers.appleStage),
    windows: deriveWindows(snapshot.windows, answers.windowsStage),
  }
}

function deriveApple(snapshot, answer) {
  const issue = issueSummary(snapshot.issue)
  const environment = environmentSummary(snapshot.environment)
  const evidence = [issue.text, environment.text, answerText('Apple', answer)]

  if (issue.unknown || environment.unknown) {
    return report('live-evidence-unavailable', 'Restore live visibility before deciding the Apple step.',
      ['Agent access to #677 and macos-signing-smoke metadata.'], appleCost,
      'Unknown; ask Apple for enrollment and identity-review timing.',
      'Agent: restore the failed live source and rerun. Do not ask the founder to repeat identity work because observation failed.', evidence)
  }
  if (issue.conflict) {
    return report('live-contract-conflict', '#677 state and acceptance checkboxes disagree.',
      ['Agent reconciliation of #677 before interpreting the environment.'], appleCost,
      'Unknown; do not restart enrollment from conflicting tracker evidence.',
      'Agent: reconcile #677 and rerun. Do not ask the founder to repeat enrollment or credentials.', evidence)
  }
  if (environment.complete && issue.complete) {
    return report('complete', 'S1 is complete.', ['None.'], appleCost,
      'Complete according to the live environment contract and #677.',
      'No founder action until S3 is intentionally started.', evidence)
  }
  if (issue.complete && !environment.complete) {
    return report('live-contract-conflict', '#677 is complete but the seven-name environment contract is not observable.',
      ['Agent reconciliation of #677 and macos-signing-smoke metadata.'], appleCost,
      'Unknown; do not restart enrollment from conflicting evidence.',
      'Agent: reconcile the live issue and environment, then rerun. Do not ask the founder to repeat enrollment or credentials.', evidence)
  }
  if (environment.complete) {
    return report('ready-for-credentialed-smoke', 'The seven names exist; #677 still needs its real-credential smoke.',
      ['Real Eido identity values matching macos-signing-smoke.md.', 'Founder ready to approve the environment-gated run.'],
      `${appleCost} No separate smoke amount is established here.`,
      'Unknown; the owning smoke supplies run evidence and this coach does not predict notarization time.',
      'Founder: approve the environment review when requested. Agent: follow macos-signing-smoke.md; do not copy its mechanics here.', evidence)
  }

  if (!answer) {
    return report('founder-answer-required', 'GitHub cannot reveal Apple account or credential state.',
      ['A current founder answer; missing environment names do not prove enrollment has not happened.'], appleCost,
      'Unknown; ask Apple for enrollment and identity-review timing.',
      'Founder: answer “not enrolled”, “enrolled but credentials not ready”, or “credentials ready”; rerun with --apple-stage not-enrolled, enrolled, or credentials-ready.', evidence)
  }
  if (answer === 'not-enrolled') {
    return report('enrollment-needed', 'Enroll in the Apple Developer Program.',
      ['Stable personal or legal-entity publisher identity.', 'Authority for Apple legal/identity checks and payment.'], appleCost,
      'Unknown; ask Apple before relying on a date.',
      'Founder: open Apple Developer Program enrollment, enroll the stable identity, accept the agreements, and pay only the amount Apple presents.', evidence)
  }
  if (answer === 'enrolled') {
    return report('credentials-needed', 'Obtain the two inputs required by the landed smoke contract.',
      ['Active membership for the stable Eido publisher identity.'],
      `${appleCost} No separate certificate or API-key price is established.`,
      'Unknown; ask Apple about certificate/API-key availability and remaining identity review.',
      'Founder: obtain a Developer ID Application certificate (not Installer) and an App Store Connect notarization API key, then authorize protected provisioning.', evidence)
  }
  return report('environment-provisioning-needed', 'Provision the missing macos-signing-smoke names.',
    ['Active membership.', 'Developer ID Application .p12/password.', 'App Store Connect .p8/key ID/issuer.', 'Exact Team ID and authority name.'],
    `${appleCost} No additional provisioning amount is established.`,
    'Unknown for Apple credential delays; GitHub setup remains agent-owned.',
    `Founder: authorize protected transfer. Agent: store these missing names without printing values: ${environment.missing.join(', ')}.`, evidence)
}

function deriveWindows(snapshot, answer) {
  const issue = issueSummary(snapshot.issue)
  const manifest = manifestSummary(snapshot.manifest)
  const evidence = [issue.text, manifest.text, answerText('Windows', answer)]

  if (issue.unknown || manifest.unknown) {
    return report('live-evidence-unavailable', 'Restore live visibility before deciding the Windows step.',
      ['Agent access to #678 and windows-manifest.json.'], quoteCost,
      'Unknown; require written provider validation and onboarding timing.',
      'Agent: restore the failed live source and rerun. Do not infer selection or add a workflow.', evidence)
  }
  if (issue.conflict) {
    return report('live-contract-conflict', '#678 state and acceptance checkboxes disagree.',
      ['Agent reconciliation of #678 before interpreting the manifest.'], quoteCost,
      'Unknown; do not restart procurement from conflicting tracker evidence.',
      'Agent: reconcile #678 and rerun. Do not ask the founder to select or purchase again.', evidence)
  }
  if (manifest.bound) {
    return report(issue.complete ? 'complete' : 'provider-bound-agent-handoff',
      issue.complete ? 'S2 is complete.' : 'Provider identity is bound; remaining proof belongs to agents under #678.',
      issue.complete ? ['None.'] : ['Selected provider remains authorized and the bound identity is exact.'],
      'Use the founder-approved written quote; public displays are not approval.',
      issue.complete ? 'Complete according to the live manifest and #678.' : 'Use the selected provider’s written terms.',
      issue.complete ? 'No founder action until S3 is intentionally started.' : 'No founder mechanics now. Agent: follow windows-signing-smoke.md; a workflow is allowed only after binding.', evidence)
  }
  if (issue.complete && !manifest.bound) {
    return report('live-contract-conflict', '#678 is complete but the manifest has no valid provider binding.',
      ['Agent reconciliation of #678 and windows-manifest.json.'], quoteCost,
      'Unknown; do not restart procurement from conflicting evidence.',
      'Agent: reconcile the live issue and manifest, then rerun. Do not ask the founder to select or purchase again.', evidence)
  }
  if (manifest.invalid) {
    return report('manifest-contract-conflict', 'The manifest is neither explicitly unselected nor completely bound.',
      ['Agent reconciliation against windows-signing-smoke.md.'], quoteCost,
      'Unknown; do not onboard from an ambiguous binding.',
      'Agent: repair or explain the manifest and rerun. Do not ask the founder to purchase again.', evidence)
  }
  if (!answer) {
    return report('founder-answer-required', 'The manifest proves no binding, not the state of private provider conversations.',
      ['A current founder answer.'], quoteCost,
      'Unknown; require written provider validation and onboarding timing.',
      'Founder: answer requests not sent, awaiting responses, responses received, DigiCert selected, or SSL.com selected; rerun with the matching --windows-stage from --help.', evidence)
  }
  if (answer === 'not-sent') {
    return report('quote-request-needed', 'Send the identical non-binding request to DigiCert and SSL.com.',
      ['Exact Australian legal entity/publisher name.', 'OV, provider HSM, unattended GitHub-hosted windows-2025 requirement.'], quoteCost,
      'Unknown; the request asks both providers to state it.',
      'Founder: send the exact “Request not sent” block from founder-setup-coach.md unchanged to both providers; do not create an account or buy yet.', evidence)
  }
  if (answer === 'awaiting-responses') {
    return report('provider-responses-pending', 'Wait for a decision-ready DigiCert answer; keep SSL.com bounded as fallback.',
      ['The identical request was sent to DigiCert and SSL.com.'], quoteCost,
      'Unknown until DigiCert gives a response date and onboarding estimate; ask SSL.com too without making it a gate.',
      'Founder: require DigiCert to answer every request item. A compliant DigiCert response can advance without waiting for SSL.com; use SSL.com only if DigiCert fails.', evidence)
  }
  if (answer === 'responses-received') {
    return report('provider-decision-needed', 'Choose one OV provider from a decision-ready written response.',
      ['DigiCert covers every request item, or DigiCert failed and SSL.com covers every request item.', 'Plausible path through the shortlist’s seven-point acceptance contract.'],
      'Compare written all-in totals and allowances; this is a founder money/identity decision.',
      'Compare the written validation and onboarding estimates; no repository default exists.',
      'Founder: choose DigiCert KeyLocker if compliant and acceptable; use SSL.com only if DigiCert fails and SSL.com confirms CodeSignTool/CSC, immutable integration, and credential rotation. Prefer OV over EV.', evidence)
  }
  const provider = answer === 'selected-digicert' ? 'DigiCert' : 'SSL.com'
  return report('provider-selected-binding-needed', `Bind the founder-authorized ${provider} identity.`,
    ['Approved written quote/publisher.', 'Issued identity with provider class, exact subject, and SHA-256 certificate fingerprint.'],
    'Use the accepted written total and overages.', 'Use the selected provider’s written issuance/onboarding estimate.',
    `Founder: authorize identity/account access. Agent: bind ${WINDOWS_SIGNING_IDENTITY_FIELDS.join(', ')}, then follow the smoke doc. No workflow before binding.`, evidence)
}

function report(status, currentStep, prerequisites, cost, leadTime, nextAction, evidence) {
  return { status, currentStep, prerequisites, cost, leadTime, nextAction, evidence }
}

function issueSummary(issue) {
  if (!issue || issue.error) return { unknown: true, complete: false, text: `Issue unavailable: ${issue?.error ?? 'unknown error'}` }
  const checks = [...issue.body.matchAll(/^\s*- \[([ xX])\] /gm)]
  const checked = checks.filter((match) => match[1].toLowerCase() === 'x').length
  const closed = issue.state === 'CLOSED'
  const allChecked = checks.length > 0 && checked === checks.length
  return {
    unknown: false,
    complete: closed && allChecked,
    conflict: checks.length === 0 || closed !== allChecked,
    text: `${issue.url ?? 'Issue'} is ${issue.state}; ${checked}/${checks.length} checkboxes are checked.`,
  }
}

function environmentSummary(environment) {
  const allNames = [...macosSecretNames, ...macosVariableNames]
  if (!environment || environment.status === 'unknown') {
    return { unknown: true, complete: false, missing: [], text: `macos-signing-smoke unavailable: ${environment?.error ?? 'unknown error'}` }
  }
  if (environment.status === 'absent') {
    return { unknown: false, complete: false, missing: allNames, text: 'The live environment list does not contain macos-signing-smoke.' }
  }
  if (environment.secretNames === null || environment.variableNames === null) {
    return { unknown: true, complete: false, missing: [], text: `macos-signing-smoke names unavailable: ${environment.error ?? 'unknown error'}` }
  }
  const secretNames = new Set(environment.secretNames)
  const variableNames = new Set(environment.variableNames)
  const missing = [
    ...macosSecretNames.filter((name) => !secretNames.has(name)),
    ...macosVariableNames.filter((name) => !variableNames.has(name)),
  ]
  return {
    unknown: false,
    complete: missing.length === 0,
    missing,
    text: `macos-signing-smoke has ${7 - missing.length}/7 required names. Values were not read; name presence does not validate them.`,
  }
}

function manifestSummary(manifest) {
  if (manifest?.error) return { unknown: true, bound: false, invalid: false, text: `Windows identity contract unavailable: ${manifest.error}` }
  const identity = manifest?.identityContract
  if (!identity) return { unknown: true, bound: false, invalid: false, text: 'Windows identity contract unavailable.' }
  const classification = classifyWindowsSigningIdentityContract(identity)
  if (classification === 'provider-unselected') return { unknown: false, bound: false, invalid: false, text: 'windows-manifest.json is provider-unselected with all three identity fields null.' }
  if (classification === 'bound') return { unknown: false, bound: true, invalid: false, text: `windows-manifest.json is bound to ${identity.providerClass}; publisher and SHA-256 identity are present.` }
  return { unknown: false, bound: false, invalid: true, text: 'windows-manifest.json contains a partial or invalid binding.' }
}

function answerText(flow, answer) {
  return answer ? `${flow} founder answer for this run only: ${answer}.` : `No ${flow} founder answer supplied; no account state was inferred.`
}

export async function inspectFounderSetup({ repositoryRoot = root, gh = runGhJson } = {}) {
  const [appleIssue, windowsIssue, environments, manifest] = await Promise.all([
    gh(['issue', 'view', '677', '--repo', repository, '--json', 'state,body,url']),
    gh(['issue', 'view', '678', '--repo', repository, '--json', 'state,body,url']),
    gh(['api', `repos/${repository}/environments?per_page=100`]),
    readManifest(path.join(repositoryRoot, 'release/signing-smoke/windows-manifest.json')),
  ])
  let environment
  if (environments.error || !Array.isArray(environments.environments)) {
    environment = { status: 'unknown', error: environments.error ?? 'GitHub returned invalid environment metadata' }
  }
  else if (!environments.environments.some(({ name }) => name === 'macos-signing-smoke')) environment = { status: 'absent' }
  else {
    const [secrets, variables] = await Promise.all([
      gh(['secret', 'list', '--repo', repository, '--env', 'macos-signing-smoke', '--json', 'name']),
      gh(['variable', 'list', '--repo', repository, '--env', 'macos-signing-smoke', '--json', 'name']),
    ])
    environment = {
      status: 'present',
      secretNames: secrets.error ? null : secrets.map(({ name }) => name),
      variableNames: variables.error ? null : variables.map(({ name }) => name),
      error: [secrets.error, variables.error].filter(Boolean).join('; ') || undefined,
    }
  }
  return {
    observedAt: new Date().toISOString(),
    apple: { issue: appleIssue, environment },
    windows: { issue: windowsIssue, manifest },
  }
}

async function readManifest(manifestPath) {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    return { error: error.message }
  }
}

function runGhJson(arguments_) {
  const result = spawnSync('gh', arguments_, { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    return { error: (result.error?.message || result.stderr || result.stdout || `gh exited ${result.status}`).trim() }
  }
  try { return JSON.parse(result.stdout) } catch (error) { return { error: `Invalid gh JSON: ${error.message}` } }
}

export function formatFounderSetupCoach(coach) {
  return `${[
    'Founder Setup Coach — Phase 2 only',
    `Observed: ${coach.observedAt}`,
    `Unsigned Alpha gate: NO. ${coach.posture.statement}`,
    '',
    ...formatFlow('Apple Developer enrollment → S1 (#677)', coach.apple),
    '',
    ...formatFlow('Windows Authenticode onboarding → S2 (#678)', coach.windows),
  ].join('\n')}\n`
}

function formatFlow(title, flow) {
  return [title, `Status: ${flow.status}`, ...flow.evidence.map((item) => `Observed: ${item}`),
    `Current step: ${flow.currentStep}`, 'Prerequisites:', ...flow.prerequisites.map((item) => `- ${item}`),
    `Cost: ${flow.cost}`, `Lead time: ${flow.leadTime}`, `Exact next action: ${flow.nextAction}`]
}

function parseArguments(arguments_) {
  const options = { json: false }
  for (let index = 0; index < arguments_.length; index += 1) {
    const [flag, inlineValue] = arguments_[index].split('=', 2)
    if (flag === '--json' || flag === '--help') { options[flag.slice(2)] = true; continue }
    if (flag !== '--apple-stage' && flag !== '--windows-stage') throw new Error(`Unknown argument: ${arguments_[index]}`)
    const value = inlineValue ?? arguments_[++index]
    const allowed = flag === '--apple-stage' ? appleStages : windowsStages
    if (!allowed.includes(value)) throw new Error(`Invalid ${flag}: ${value}`)
    options[flag === '--apple-stage' ? 'appleStage' : 'windowsStage'] = value
  }
  return options
}

function usage() {
  return `Usage: node scripts/release-signing/founder-setup-coach.mjs [options]\n\n  --apple-stage <${appleStages.join('|')}>\n  --windows-stage <${windowsStages.join('|')}>\n  --json\n  --help\n\nStages are current founder answers for this run only and are never persisted.\n`
}

async function runCli(arguments_) {
  const options = parseArguments(arguments_)
  if (options.help) { process.stdout.write(usage()); return }
  const coach = deriveFounderSetupCoach(await inspectFounderSetup(), options)
  process.stdout.write(options.json ? `${JSON.stringify(coach, null, 2)}\n` : formatFounderSetupCoach(coach))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
}
