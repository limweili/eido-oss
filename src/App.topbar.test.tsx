// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { ReactFlowProvider } from '@xyflow/react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IdeaManagerModal, TopBar } from './App'
import { useGraph } from './graph/store'
import type { StorageStatus } from './graph/save'
import { words } from './shared/words'
import { OverlayProvider } from './ui/overlays'

const IDEA = {
  id: 'topbar-idea',
  name: 'Signal garden',
  createdAt: '2026-07-17T00:00:00.000Z',
  updatedAt: '2026-07-17T00:00:00.000Z',
  lastOpenedAt: '2026-07-17T00:00:00.000Z',
}

const ARCHIVE_IDEA = {
  id: 'archive-idea',
  name: 'Archive room',
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
  lastOpenedAt: '2026-07-16T00:00:00.000Z',
}
const originalDeleteIdea = useGraph.getState().deleteIdea
const originalRenameCurrentIdea = useGraph.getState().renameCurrentIdea

function IdeaManagerHarness() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Reopen Ideas</button>
      <IdeaManagerModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function renderTopBar() {
  return render(
    <ReactFlowProvider>
      <TopBar
        playbackOpen={false}
        searchOpen={false}
        onSetSearchOpen={vi.fn()}
        onOpenPlayback={vi.fn()}
        onExitPlayback={vi.fn()}
        onCaptureViewport={vi.fn()}
      />
    </ReactFlowProvider>,
  )
}

function resetTopBar(saveState: 'saving' | 'saved' | 'failed', storageStatus: StorageStatus | null) {
  useGraph.setState({
    ideas: [IDEA],
    currentIdeaId: IDEA.id,
    saveState,
    storageStatus,
    highlights: [],
    highlightsPanelOpen: false,
    keyPromptOpen: false,
    ideaManagerOpen: false,
  })
}

describe('TopBar save-state contract', () => {
  beforeEach(() => {
    resetTopBar('saved', null)
  })

  afterEach(cleanup)

  it('places a pulse-backed Saving state immediately beside its Idea', () => {
    resetTopBar('saving', { backend: 'disk', dataFile: '/tmp/eido-topbar.json' })
    renderTopBar()

    const topbar = screen.getByRole('banner')
    const idea = within(topbar).getByRole('button', { name: /Signal garden/ })
    const state = within(topbar).getByRole('status')

    expect(idea.nextElementSibling).toBe(state)
    expect(state).toHaveTextContent(/^Saving$/)
    expect(state).not.toHaveTextContent('…')
    expect(state.querySelector('.save-state__pulse')).toHaveAttribute('aria-hidden', 'true')
    expect(state).toHaveAttribute('title', '/tmp/eido-topbar.json')
  })

  it.each([
    {
      name: 'disk',
      saveState: 'saved' as const,
      storageStatus: { backend: 'disk' as const, dataFile: '/tmp/eido-topbar.json' },
      label: words.saved,
      title: '/tmp/eido-topbar.json',
      className: '',
    },
    {
      name: 'browser',
      saveState: 'saved' as const,
      storageStatus: { backend: 'browser' as const, warning: 'Browser-only fixture warning.' },
      label: words.savedBrowser,
      title: 'Browser-only fixture warning.',
      className: 'browser',
    },
    {
      name: 'failure',
      saveState: 'failed' as const,
      storageStatus: { backend: 'browser' as const, warning: 'Browser-only fixture warning.' },
      label: words.saveFailed,
      title: 'Browser-only fixture warning.',
      className: 'failed',
    },
  ])('preserves the $name save label, tone, and storage title', ({ saveState, storageStatus, label, title, className }) => {
    resetTopBar(saveState, storageStatus)
    renderTopBar()

    const state = screen.getByRole('status')
    expect(state).toHaveTextContent(label)
    expect(state).toHaveAttribute('title', title)
    if (className) expect(state).toHaveClass(className)
  })

  it('keeps the existing right-side action cluster intact', () => {
    renderTopBar()

    const topbar = screen.getByRole('banner')
    const idea = within(topbar).getByRole('button', { name: /Signal garden/ })
    const actionCluster = within(topbar).getByRole('group', { name: words.topbarActions })
    const typographyRoles = (element: Element) =>
      [...element.classList].filter((className) => className.startsWith('t-'))
    expect(typographyRoles(idea)).toEqual(['t-ui'])
    const actionButtons = within(actionCluster).getAllByRole('button')
    expect(actionButtons.map((button) => button.textContent)).toEqual([
      words.boardSearch,
      words.highlights,
      words.playback,
      words.settings,
    ])
    expect(actionButtons.map(typographyRoles)).toEqual([
      ['t-label'],
      ['t-label'],
      ['t-label'],
      ['t-label'],
    ])
  })
})

describe('Idea manager shared modal', () => {
  afterEach(() => {
    cleanup()
    useGraph.getState().undoStagedIdeaDelete()
    useGraph.setState({
      deleteIdea: originalDeleteIdea,
      renameCurrentIdea: originalRenameCurrentIdea,
      pendingIdeaDelete: null,
    })
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('lays out the gallery: ceremonial cover, cover verbs, create form, and the shelf', () => {
    useGraph.setState({ ideas: [IDEA, ARCHIVE_IDEA], currentIdeaId: IDEA.id })
    render(
      <OverlayProvider>
        <IdeaManagerHarness />
      </OverlayProvider>,
    )

    const manager = screen.getByRole('dialog', { name: words.ideas })
    expect(manager).toHaveClass('e-modal-shell', 'idea-modal')
    expect(manager).toHaveTextContent(words.ideaLocalHint)

    // The current Idea rides the one ceremonial grain cover in the modal.
    const cover = manager.querySelector<HTMLElement>('.idea-cover')!
    expect(cover).toHaveClass('e-grain', 'e-grain--green')
    expect(within(cover).getByText(words.currentIdea)).toHaveClass('t-micro')
    expect(within(cover).getByRole('textbox', { name: words.currentIdea })).toHaveValue(IDEA.name)
    expect(cover.querySelector('.idea-cover__meta')).toHaveTextContent(/cards? · updated /)

    // Cover verbs stay off the textured surface, delete rides danger clothes.
    for (const name of [words.duplicateIdea, words.exportIdea, words.importIdea]) {
      expect(within(manager).getByRole('button', { name })).toHaveClass('e-button')
    }
    expect(within(manager).getByRole('button', { name: words.deleteIdea }))
      .toHaveClass('e-button--danger')

    // Creating is a form: field plus the view's one primary verb.
    const createField = within(manager).getByPlaceholderText(words.ideaCreatePlaceholder)
    expect(createField).toHaveClass('e-field')
    expect(createField.closest('form')).toHaveClass('idea-create')
    expect(within(manager).getByRole('button', { name: words.createIdea }))
      .toHaveClass('e-button--primary')

    // The shelf lists only the other Ideas; the whole row is the way in.
    const openArchive = within(manager).getByRole('button', {
      name: `${words.loadIdea} "${ARCHIVE_IDEA.name}"`,
    })
    expect(openArchive).toHaveClass('idea-shelf__open')
    expect(openArchive).toHaveTextContent(ARCHIVE_IDEA.name)
    expect(within(manager).queryByRole('button', { name: `${words.loadIdea} "${IDEA.name}"` }))
      .toBeNull()
  })

  it('commits an inline rename from the cover when the name field blurs', async () => {
    const renames: string[] = []
    useGraph.setState({
      ideas: [IDEA],
      currentIdeaId: IDEA.id,
      renameCurrentIdea: async (name) => {
        renames.push(name)
      },
    })
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <IdeaManagerHarness />
      </OverlayProvider>,
    )

    const manager = screen.getByRole('dialog', { name: words.ideas })
    const coverName = within(manager).getByRole('textbox', { name: words.currentIdea })
    await user.clear(coverName)
    await user.type(coverName, 'Night market plan{Enter}')
    expect(renames).toEqual(['Night market plan'])

    // Emptying the name quietly reverts instead of renaming to nothing.
    await user.clear(coverName)
    await user.tab()
    expect(renames).toEqual(['Night market plan'])
    expect(coverName).toHaveValue(IDEA.name)
  })

  it('resets transient state on close and gives a shelf delete an undo window', async () => {
    const deletedIds: string[] = []
    useGraph.setState({
      ideas: [IDEA, ARCHIVE_IDEA],
      currentIdeaId: IDEA.id,
      deleteIdea: async (ideaId) => {
        deletedIds.push(ideaId)
        useGraph.setState((state) => ({
          ideas: state.ideas.filter((idea) => idea.id !== ideaId),
        }))
      },
    })
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <IdeaManagerHarness />
      </OverlayProvider>,
    )

    let manager = screen.getByRole('dialog', { name: words.ideas })
    const newName = within(manager).getByRole('textbox', { name: words.ideaName })
    await user.type(newName, 'Unmade Idea')
    const importInput = manager.querySelector<HTMLInputElement>('input[type="file"]')!
    await user.upload(importInput, new File(['not-json'], 'broken.json', { type: 'application/json' }))
    expect(await within(manager).findByRole('alert')).toHaveTextContent(
      "Couldn't import that Board. Try another file.",
    )

    let closeButtons = within(manager).getAllByRole('button', { name: words.close })
    await user.click(closeButtons[closeButtons.length - 1]!)
    fireEvent.transitionEnd(manager.parentElement!, { propertyName: 'opacity' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: words.ideas })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Reopen Ideas' }))
    manager = await screen.findByRole('dialog', { name: words.ideas })
    expect(within(manager).getByRole('textbox', { name: words.ideaName })).toHaveValue('')
    expect(within(manager).getByRole('textbox', { name: words.currentIdea })).toHaveValue(IDEA.name)
    expect(within(manager).queryByRole('alert')).toBeNull()

    // A shelf delete asks first, then stages behind the UNDO window.
    const confirmShelfDelete = async () => {
      await user.click(within(manager).getByRole('button', {
        name: `${words.deleteIdea} "${ARCHIVE_IDEA.name}"`,
      }))
      const confirmation = await screen.findByRole('dialog', {
        name: `Delete "${ARCHIVE_IDEA.name}"?`,
      })
      expect(confirmation).toHaveTextContent(
        'Its cards and history will be removed from this computer.',
      )
      await user.click(within(confirmation).getByRole('button', { name: words.deleteIdea }))
      fireEvent.transitionEnd(confirmation.parentElement!, { propertyName: 'opacity' })
      await waitFor(() => expect(
        screen.queryByRole('dialog', { name: `Delete "${ARCHIVE_IDEA.name}"?` }),
      ).toBeNull())
    }
    await confirmShelfDelete()
    expect(deletedIds).toEqual([])
    expect(within(manager).queryByText(ARCHIVE_IDEA.name)).toBeNull()
    const undoStrip = within(manager).getByRole('status')
    expect(undoStrip).toHaveTextContent(`Deleted "${ARCHIVE_IDEA.name}".`)

    await user.click(within(undoStrip).getByRole('button', { name: words.undo }))
    expect(within(manager).getByText(ARCHIVE_IDEA.name)).toBeInTheDocument()
    expect(within(manager).queryByRole('status')).toBeNull()
    expect(deletedIds).toEqual([])

    // Closing the modal takes the undo affordance away, so the delete lands.
    await confirmShelfDelete()
    closeButtons = within(manager).getAllByRole('button', { name: words.close })
    await user.click(closeButtons[closeButtons.length - 1]!)
    fireEvent.transitionEnd(manager.parentElement!, { propertyName: 'opacity' })
    await waitFor(() => expect(deletedIds).toEqual([ARCHIVE_IDEA.id]))
    expect(useGraph.getState().pendingIdeaDelete).toBeNull()
  })

  it('still confirms before deleting the current Board from the cover', async () => {
    const deletedIds: string[] = []
    useGraph.setState({
      ideas: [IDEA, ARCHIVE_IDEA],
      currentIdeaId: IDEA.id,
      deleteIdea: async (ideaId) => {
        deletedIds.push(ideaId)
      },
    })
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <IdeaManagerHarness />
      </OverlayProvider>,
    )

    const manager = screen.getByRole('dialog', { name: words.ideas })
    const deleteCurrent = within(manager).getByRole('button', { name: words.deleteIdea })
    await user.click(deleteCurrent)
    let confirmation = await screen.findByRole('dialog', { name: `Delete "${IDEA.name}"?` })
    expect(confirmation).toHaveTextContent('Its cards and history will be removed from this computer.')

    await user.click(within(confirmation).getByRole('button', { name: words.cancel }))
    fireEvent.transitionEnd(confirmation.parentElement!, { propertyName: 'opacity' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: `Delete "${IDEA.name}"?` })).toBeNull())
    expect(deletedIds).toEqual([])

    await user.click(deleteCurrent)
    confirmation = await screen.findByRole('dialog', { name: `Delete "${IDEA.name}"?` })
    await user.click(within(confirmation).getByRole('button', { name: words.deleteIdea }))
    await waitFor(() => expect(deletedIds).toEqual([IDEA.id]))
  })

  it('commits a staged shelf delete once the undo window elapses', async () => {
    vi.useFakeTimers()
    const deletedIds: string[] = []
    useGraph.setState({
      ideas: [IDEA, ARCHIVE_IDEA],
      currentIdeaId: IDEA.id,
      pendingIdeaDelete: null,
      deleteIdea: async (ideaId) => {
        deletedIds.push(ideaId)
      },
    })

    await useGraph.getState().stageIdeaDelete(ARCHIVE_IDEA.id)
    expect(useGraph.getState().pendingIdeaDelete).toEqual({
      id: ARCHIVE_IDEA.id,
      name: ARCHIVE_IDEA.name,
    })
    expect(deletedIds).toEqual([])

    await vi.advanceTimersByTimeAsync(4_200)
    expect(deletedIds).toEqual([ARCHIVE_IDEA.id])
    expect(useGraph.getState().pendingIdeaDelete).toBeNull()
  })
})
