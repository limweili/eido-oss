import { describe, expect, it } from 'vitest'
import type { ProfileInstallation } from './profileInstallation'
import {
  PROFILE_PROOF_CARD_ARGUMENT,
  PROFILE_PROOF_MOD_ARGUMENT,
  PROFILE_PROOF_PHASE_ARGUMENT,
  PROFILE_PROOF_REVISION_ARGUMENT,
  PROFILE_REVIEW_ARGUMENT,
  resolveProfileAuxiliaryLaunch,
} from './profileAuxiliaryLaunch'

const productInstallation: ProfileInstallation = Object.freeze({
  mode: 'product',
  userDataRoot: '/Library/Application Support/Eido',
  databasePath: '/Library/Application Support/Eido/profiles/default/eido-profile.sqlite',
  disposable: false,
})

const proofInstallation: ProfileInstallation = Object.freeze({
  mode: 'proof',
  userDataRoot: '/tmp/eido-profile-proof-review',
  databasePath: '/tmp/eido-profile-proof-review/profiles/default/eido-profile.sqlite',
  disposable: true,
})

describe('Profile auxiliary GUI launch', () => {
  it('keeps the ordinary installed launch unchanged', () => {
    expect(resolveProfileAuxiliaryLaunch({
      argv: ['electron'],
      installation: productInstallation,
      isPackaged: true,
    })).toEqual({ kind: 'ordinary' })
  })

  it('admits an explicit disposable review Profile only in an unpackaged build', () => {
    expect(resolveProfileAuxiliaryLaunch({
      argv: ['electron', PROFILE_REVIEW_ARGUMENT],
      installation: proofInstallation,
      isPackaged: false,
    })).toEqual({ kind: 'review' })

    expect(() => resolveProfileAuxiliaryLaunch({
      argv: ['electron', PROFILE_REVIEW_ARGUMENT],
      installation: proofInstallation,
      isPackaged: true,
    })).toThrow('Development Profile review is unavailable in packaged Eido')

    expect(() => resolveProfileAuxiliaryLaunch({
      argv: ['electron', PROFILE_REVIEW_ARGUMENT],
      installation: productInstallation,
      isPackaged: false,
    })).toThrow('Development Profile review requires a disposable explicit root')
  })

  it('rejects ambiguous review and proof intent', () => {
    expect(() => resolveProfileAuxiliaryLaunch({
      argv: ['electron', PROFILE_REVIEW_ARGUMENT, PROFILE_REVIEW_ARGUMENT],
      installation: proofInstallation,
      isPackaged: false,
    })).toThrow('Development Profile review argument was repeated')

    expect(() => resolveProfileAuxiliaryLaunch({
      argv: [
        'electron',
        PROFILE_REVIEW_ARGUMENT,
        `${PROFILE_PROOF_PHASE_ARGUMENT}stamp`,
      ],
      installation: proofInstallation,
      isPackaged: false,
    })).toThrow('Development Profile review cannot run a packaged proof phase')
  })

  it('admits a synthetic GUI proof without borrowing installed credentials', () => {
    expect(resolveProfileAuxiliaryLaunch({
      argv: ['electron', '--eido-profile-synthetic-proof'],
      installation: proofInstallation,
      isPackaged: false,
    })).toEqual({ kind: 'synthetic-proof' })
  })

  it('rejects synthetic proofs outside the unpackaged disposable boundary', () => {
    for (const input of [
      { argv: ['electron', '--eido-profile-synthetic-proof'], installation: proofInstallation, isPackaged: true },
      { argv: ['electron', '--eido-profile-synthetic-proof'], installation: productInstallation, isPackaged: false },
      { argv: ['electron', '--eido-profile-synthetic-proof', '--eido-profile-synthetic-proof'], installation: proofInstallation, isPackaged: false },
      { argv: ['electron', '--eido-profile-synthetic-proof', PROFILE_REVIEW_ARGUMENT], installation: proofInstallation, isPackaged: false },
      { argv: ['electron', '--eido-profile-synthetic-proof', `${PROFILE_PROOF_PHASE_ARGUMENT}stamp`], installation: proofInstallation, isPackaged: false },
    ]) {
      expect(() => resolveProfileAuxiliaryLaunch(input)).toThrow()
    }
  })

  it('retains exact packaged proof planning', () => {
    expect(resolveProfileAuxiliaryLaunch({
      argv: ['electron', `${PROFILE_PROOF_PHASE_ARGUMENT}stamp`],
      installation: proofInstallation,
      isPackaged: true,
    })).toEqual({ kind: 'proof', request: { phase: 'stamp' } })

    expect(resolveProfileAuxiliaryLaunch({
      argv: [
        'electron',
        `${PROFILE_PROOF_PHASE_ARGUMENT}verify`,
        `${PROFILE_PROOF_CARD_ARGUMENT}card-1`,
        `${PROFILE_PROOF_MOD_ARGUMENT}mod-1`,
        `${PROFILE_PROOF_REVISION_ARGUMENT}7`,
      ],
      installation: proofInstallation,
      isPackaged: true,
    })).toEqual({
      kind: 'proof',
      request: {
        phase: 'verify',
        cardId: 'card-1',
        modId: 'mod-1',
        revision: 7,
      },
    })
  })

  it('still refuses a proof root without an explicit purpose', () => {
    expect(() => resolveProfileAuxiliaryLaunch({
      argv: ['electron'],
      installation: proofInstallation,
      isPackaged: false,
    })).toThrow('Disposable Profile launch requires a proof phase, synthetic proof, or development review')
  })
})
