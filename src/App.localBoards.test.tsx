// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { StrictMode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { useGraph } from './graph/store'
import { words } from './shared/words'
import { OverlayProvider } from './ui/overlays'

vi.mock('./canvas/Board', () => ({ Board: () => <div data-testid="board" /> }))
vi.mock('./canvas/BottomDock', () => ({ BottomDock: () => null }))
vi.mock('./canvas/HighlightsPanel', () => ({ HighlightsPanel: () => null }))
vi.mock('./canvas/UndoControls', () => ({ UndoControls: () => null }))
vi.mock('./canvas/UpdateNotice', () => ({ UpdateNotice: () => null }))

const GUARD = 'Local Boards must open and take edits without network access or AI credentials.'

const startupFaults: unknown[] = []
const onWindowError = (event: ErrorEvent) => {
  startupFaults.push(event.error ?? event.message)
}
const onWindowRejection = (event: PromiseRejectionEvent) => {
  startupFaults.push(event.reason)
}

describe('Free local Boards', () => {
  beforeEach(() => {
    startupFaults.length = 0
    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onWindowRejection)
    useGraph.setState({
      hydrated: true,
      profileStartupState: 'ready',
      hydrate: vi.fn(async () => undefined),
      keyPromptOpen: false,
      ideaManagerOpen: false,
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      settings: {
        apiKey: '',
        model: 'openai/gpt-4o-mini',
        models: ['openai/gpt-4o-mini'],
        reasoningEffort: 'medium',
        systemPrompt: '',
      },
    })
  })

  afterEach(() => {
    cleanup()
    document.body.replaceChildren()
    window.removeEventListener('error', onWindowError)
    window.removeEventListener('unhandledrejection', onWindowRejection)
  })

  it('opens and edits a Board without AI credentials', async () => {
    const user = userEvent.setup()
    renderApp()

    await proveBoardOpensAndEdits(user)
    expect(startupFaults, GUARD).toEqual([])
  })

})

function renderApp() {
  return render(
    <StrictMode>
      <OverlayProvider>
        <App />
      </OverlayProvider>
    </StrictMode>,
  )
}

/** A real edit through the real empty-state surface: add the first note. */
async function proveBoardOpensAndEdits(user: ReturnType<typeof userEvent.setup>) {
  expect(
    screen.getByRole('region', { name: words.emptyTitle }),
    GUARD,
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: words.addNote }))
  expect(useGraph.getState().cards, GUARD).toHaveLength(1)
  await waitFor(() => {
    expect(screen.queryByRole('region', { name: words.emptyTitle }), GUARD).toBeNull()
  })
  expect(screen.getByTestId('board'), GUARD).toBeInTheDocument()
}
