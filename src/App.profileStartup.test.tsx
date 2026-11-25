// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IdeaManagerModal, ProfileStartupSurface } from './App'
import { useGraph } from './graph/store'
import { PROFILE_CONTRACT_VERSIONS } from './persistence/profileServiceContract'
import { words } from './shared/words'
import { OverlayProvider } from './ui/overlays'

afterEach(cleanup)

describe('installed Profile startup surfaces', () => {
  it('shows an explicit loading surface instead of a blank canvas', () => {
    render(<ProfileStartupSurface state="loading" />)

    expect(screen.getByRole('status')).toHaveTextContent(words.profileLoadingTitle)
    expect(screen.getByRole('heading', { level: 2, name: words.profileLoadingTitle })).toBeInTheDocument()
    expect(screen.getByText(words.profileLoadingHint)).toBeInTheDocument()
  })

  it('shows a fail-closed startup surface', () => {
    render(<ProfileStartupSurface state="failed" />)

    expect(screen.getByRole('alert')).toHaveTextContent(words.profileUnavailableTitle)
    expect(screen.getByText(words.profileUnavailableHint)).toBeInTheDocument()
  })

  it('offers only verified recovery candidates and invokes the constrained restore action', async () => {
    const restoreProfileRecovery = vi.fn(async () => {})
    useGraph.setState({
      profileStartupError: null,
      profileStartupErrorKind: null,
      restoringRecoveryCandidateId: null,
      startingFreshProfile: false,
      restoreProfileRecovery,
      recoveryCandidates: [
        {
          id: 'verified-candidate',
          recordVersion: PROFILE_CONTRACT_VERSIONS.record,
          revision: 8,
          verified: true,
          createdAt: '2026-07-19T02:30:00.000Z',
        },
        {
          id: 'unverified-candidate',
          recordVersion: PROFILE_CONTRACT_VERSIONS.record,
          revision: 7,
          verified: false,
          createdAt: '2026-07-18T02:30:00.000Z',
        },
      ],
    })
    const user = userEvent.setup()

    render(<ProfileStartupSurface state="recovery-required" />)

    expect(screen.getByRole('heading', { level: 2, name: words.profileRecoveryTitle })).toBeInTheDocument()
    const restore = screen.getByRole('button', { name: new RegExp(`^${words.restoreProfile}`) })
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(restore).toHaveTextContent(/^Restore$/)
    expect(document.querySelector('.idea-row-date')).toHaveClass('t-value')
    await user.click(restore)
    expect(restoreProfileRecovery).toHaveBeenCalledWith('verified-candidate')
  })

  it('always offers start fresh, with and without verified candidates', async () => {
    const startFreshProfile = vi.fn(async () => {})
    useGraph.setState({
      profileStartupError: null,
      profileStartupErrorKind: null,
      restoringRecoveryCandidateId: null,
      startingFreshProfile: false,
      startFreshProfile,
      recoveryCandidates: [],
    })
    const user = userEvent.setup()

    const surface = render(<ProfileStartupSurface state="recovery-required" />)

    expect(screen.getByText(words.profileRecoveryEmpty)).toBeInTheDocument()
    expect(screen.getByText(words.startFreshProfileHint)).toBeInTheDocument()
    const startFresh = screen.getByRole('button', { name: words.startFreshProfile })
    expect(screen.getAllByRole('button')).toHaveLength(1)
    await user.click(startFresh)
    expect(startFreshProfile).toHaveBeenCalledTimes(1)

    surface.unmount()
    useGraph.setState({
      recoveryCandidates: [{
        id: 'verified-candidate',
        recordVersion: PROFILE_CONTRACT_VERSIONS.record,
        revision: 8,
        verified: true,
        createdAt: '2026-07-19T02:30:00.000Z',
      }],
    })
    render(<ProfileStartupSurface state="recovery-required" />)
    expect(screen.getByRole('button', { name: words.startFreshProfile })).toBeEnabled()
    expect(screen.getByRole('button', { name: new RegExp(`^${words.restoreProfile}`) })).toBeEnabled()
  })

  it('renders recovery admission as the shared running state word', () => {
    useGraph.setState({
      profileStartupError: null,
      profileStartupErrorKind: null,
      restoringRecoveryCandidateId: 'verified-candidate',
      startingFreshProfile: false,
      recoveryCandidates: [{
        id: 'verified-candidate',
        recordVersion: PROFILE_CONTRACT_VERSIONS.record,
        revision: 8,
        verified: true,
        createdAt: '2026-07-19T02:30:00.000Z',
      }],
    })

    render(<ProfileStartupSurface state="recovery-required" />)

    const restoring = screen.getByText(words.restoringProfile)
    expect(restoring).toHaveClass('e-state-word--running')
    expect(restoring).toHaveTextContent(/^Restoring$/)
    expect(restoring.querySelector('.e-state-word__pulse')).toBeInTheDocument()
    // The restore action collapses to its running word while start fresh
    // stays visible but disabled until the restore settles.
    expect(screen.queryByRole('button', { name: new RegExp(`^${words.restoreProfile}`) })).toBeNull()
    expect(screen.getByRole('button', { name: words.startFreshProfile })).toBeDisabled()
  })

  it('renders start-fresh admission as the shared running state word', () => {
    useGraph.setState({
      profileStartupError: null,
      profileStartupErrorKind: null,
      restoringRecoveryCandidateId: null,
      startingFreshProfile: true,
      recoveryCandidates: [],
    })

    render(<ProfileStartupSurface state="recovery-required" />)

    const starting = screen.getByText(words.startingFreshProfile)
    expect(starting).toHaveClass('e-state-word--running')
    expect(starting.querySelector('.e-state-word__pulse')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: words.startFreshProfile })).toBeNull()
  })

  it('keeps recovery failures local to the recovery-only surface', () => {
    useGraph.setState({
      recoveryCandidates: [],
      restoringRecoveryCandidateId: null,
      startingFreshProfile: false,
      profileStartupError: 'synthetic recovery failure',
      profileStartupErrorKind: 'restore',
    })

    render(<ProfileStartupSurface state="recovery-required" />)

    expect(screen.getByRole('alert')).toHaveTextContent(words.profileRecoveryFailed)
    expect(screen.queryByText('synthetic recovery failure')).toBeNull()
  })

  it('shows calm start-fresh copy when starting fresh fails', () => {
    useGraph.setState({
      recoveryCandidates: [],
      restoringRecoveryCandidateId: null,
      startingFreshProfile: false,
      profileStartupError: 'synthetic start-fresh failure',
      profileStartupErrorKind: 'start-fresh',
    })

    render(<ProfileStartupSurface state="recovery-required" />)

    expect(screen.getByRole('alert')).toHaveTextContent(words.profileStartFreshFailed)
    expect(screen.queryByText('synthetic start-fresh failure')).toBeNull()
    expect(screen.getByRole('button', { name: words.startFreshProfile })).toBeEnabled()
  })
})

describe('installed Profile Idea actions', () => {
  it('routes export and import to native lifecycle pickers without mounting a browser file input', async () => {
    const exportCurrentIdeaToNative = vi.fn(async () => true)
    const importIdeaFromNative = vi.fn(async () => true)
    useGraph.setState({
      persistenceKind: 'packaged-profile',
      ideas: [{
        id: 'idea-native',
        name: 'Native Idea',
        createdAt: '2026-07-20T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z',
        lastOpenedAt: '2026-07-20T00:00:00.000Z',
      }],
      currentIdeaId: 'idea-native',
      exportCurrentIdeaToNative,
      importIdeaFromNative,
    })
    const user = userEvent.setup()

    render(
      <OverlayProvider>
        <IdeaManagerModal open onClose={vi.fn()} />
      </OverlayProvider>,
    )

    expect(document.querySelector('input[type="file"]')).toBeNull()
    await user.click(screen.getByRole('button', { name: words.exportIdea }))
    await user.click(screen.getByRole('button', { name: words.importIdea }))
    expect(exportCurrentIdeaToNative).toHaveBeenCalledTimes(1)
    expect(importIdeaFromNative).toHaveBeenCalledTimes(1)
  })
})
