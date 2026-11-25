import type { ProfileInstallation } from './profileInstallation'

export const PROFILE_REVIEW_ARGUMENT = '--eido-profile-review'
export const PROFILE_SYNTHETIC_PROOF_ARGUMENT = '--eido-profile-synthetic-proof'
export const PROFILE_PROOF_PHASE_ARGUMENT = '--eido-profile-proof-phase='
export const PROFILE_PROOF_CARD_ARGUMENT = '--eido-profile-proof-card-id='
export const PROFILE_PROOF_MOD_ARGUMENT = '--eido-profile-proof-mod-id='
export const PROFILE_PROOF_REVISION_ARGUMENT = '--eido-profile-proof-revision='

export type ProfileProofRequest =
  | Readonly<{ phase: 'stamp' }>
  | Readonly<{
      phase: 'verify'
      cardId: string
      modId: string
      revision: number
    }>

export type ProfileAuxiliaryLaunch =
  | Readonly<{ kind: 'ordinary' }>
  | Readonly<{ kind: 'review' }>
  | Readonly<{ kind: 'synthetic-proof' }>
  | Readonly<{ kind: 'proof'; request: ProfileProofRequest }>

export function resolveProfileAuxiliaryLaunch({
  argv,
  installation,
  isPackaged,
}: Readonly<{
  argv: readonly string[]
  installation: ProfileInstallation
  isPackaged: boolean
}>): ProfileAuxiliaryLaunch {
  const reviewArguments = argv.filter((argument) => argument === PROFILE_REVIEW_ARGUMENT)
  if (reviewArguments.length > 1) {
    throw new Error('Development Profile review argument was repeated')
  }
  const reviewRequested = reviewArguments.length === 1
  const phase = readProofArgument(argv, PROFILE_PROOF_PHASE_ARGUMENT)
  const cardId = readProofArgument(argv, PROFILE_PROOF_CARD_ARGUMENT)
  const modId = readProofArgument(argv, PROFILE_PROOF_MOD_ARGUMENT)
  const revisionText = readProofArgument(argv, PROFILE_PROOF_REVISION_ARGUMENT)

  const syntheticProofArguments = argv.filter(
    (argument) => argument === PROFILE_SYNTHETIC_PROOF_ARGUMENT,
  )
  if (syntheticProofArguments.length > 1) {
    throw new Error('Synthetic Profile proof argument was repeated')
  }
  if (syntheticProofArguments.length === 1) {
    if (reviewRequested || phase !== undefined || cardId !== undefined
      || modId !== undefined || revisionText !== undefined) {
      throw new Error('Synthetic Profile proof cannot combine launch purposes')
    }
    if (isPackaged) {
      throw new Error('Synthetic Profile proof is unavailable in packaged Eido')
    }
    if (installation.mode !== 'proof' || installation.disposable !== true) {
      throw new Error('Synthetic Profile proof requires a disposable explicit root')
    }
    return Object.freeze({ kind: 'synthetic-proof' })
  }

  if (reviewRequested) {
    if (phase !== undefined || cardId !== undefined || modId !== undefined || revisionText !== undefined) {
      throw new Error('Development Profile review cannot run a packaged proof phase')
    }
    if (isPackaged) {
      throw new Error('Development Profile review is unavailable in packaged Eido')
    }
    if (installation.mode !== 'proof' || installation.disposable !== true) {
      throw new Error('Development Profile review requires a disposable explicit root')
    }
    return Object.freeze({ kind: 'review' })
  }

  if (phase === undefined) {
    if (cardId !== undefined || modId !== undefined || revisionText !== undefined) {
      throw new Error('Packaged Profile proof expectations require a phase')
    }
    if (installation.mode === 'proof') {
      throw new Error('Disposable Profile launch requires a proof phase, synthetic proof, or development review')
    }
    return Object.freeze({ kind: 'ordinary' })
  }

  if (installation.mode !== 'proof' || installation.disposable !== true) {
    throw new Error('Packaged Profile proof requires a disposable explicit root')
  }
  if (phase === 'stamp') {
    if (cardId !== undefined || modId !== undefined || revisionText !== undefined) {
      throw new Error('Packaged Profile stamp proof cannot accept reopen expectations')
    }
    return Object.freeze({ kind: 'proof', request: Object.freeze({ phase }) })
  }
  if (phase !== 'verify') throw new Error('Packaged Profile proof phase is invalid')
  const revision = Number(revisionText)
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new Error('Packaged Profile proof revision is invalid')
  }
  return Object.freeze({
    kind: 'proof',
    request: Object.freeze({
      phase,
      cardId: requireProfileProofId(cardId, 'card'),
      modId: requireProfileProofId(modId, 'Mod'),
      revision,
    }),
  })
}

function readProofArgument(argv: readonly string[], prefix: string): string | undefined {
  const matches = argv.filter((argument) => argument.startsWith(prefix))
  if (matches.length > 1) throw new Error('Packaged Profile proof argument was repeated')
  const value = matches[0]?.slice(prefix.length)
  if (value === '') throw new Error('Packaged Profile proof argument was empty')
  return value
}

export function requireProfileProofId(
  value: string | null | undefined,
  label: 'card' | 'Mod',
): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > 256
    || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Packaged Profile proof ${label} identity is invalid`)
  }
  return value
}
