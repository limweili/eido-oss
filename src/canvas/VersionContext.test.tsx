// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { OutputVersion, RunRecord } from '../graph/types'
import { useGraph } from '../graph/store'
import { OverlayProvider } from '../ui/overlays'
import { VersionContext } from './VersionContext'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe('Conversation Context provenance', () => {
  it('renders frozen Ask instructions with the shared Markdown projection', () => {
    const run: RunRecord = {
      id: 'run-ask',
      startedAt: '2026-07-14T00:00:00.000Z',
      askAiCardId: 'ask',
      model: 'default/model',
      usedCardIds: [],
      usedConnectionIds: [],
      modIds: [],
      appliedMods: [],
      compiledInstruction: '### Sent context\n\n- First fact\n  - Nested fact',
      producedVersionId: 'ask-version',
      status: 'done',
    }
    const version: OutputVersion = {
      id: 'ask-version',
      number: 1,
      text: '',
      createdAt: '2026-07-14T00:00:00.000Z',
      fromRunId: run.id,
    }
    useGraph.setState({ runs: [run] })

    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
    render(
      <OverlayProvider>
        <VersionContext version={version} onClose={() => undefined} />
      </OverlayProvider>,
      { container: appRoot },
    )

    expect(screen.getByRole('heading', { level: 3, name: 'Sent context' })).toBeVisible()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByText(/### Sent context/)).toBeNull()
  })

  it('attributes participant-scoped Mod lines to the participant they shaped', () => {
    const run: RunRecord = {
      id: 'run-conversation',
      startedAt: '2026-07-14T00:00:00.000Z',
      askAiCardId: 'conversation',
      model: 'default/model',
      usedCardIds: ['conversation', 'pro', 'con', 'pro-mod'],
      usedConnectionIds: [],
      modIds: [],
      appliedMods: [],
      compiledInstruction: '',
      producedVersionId: 'version',
      status: 'done',
      kind: 'conversation',
      conversation: {
        settings: { topic: 'Ship?', style: 'debate', turnsPerParticipant: 1 },
        participants: [
          {
            cardId: 'pro',
            name: 'Pro',
            model: 'default/model',
            role: '### Shipping advocate\n\n- Argue for shipping.',
            participantMods: [
              {
                cardId: 'pro-mod',
                label: 'Pro challenger',
                instructions: ['Challenge confident assumptions.'],
              },
            ],
          },
          {
            cardId: 'con',
            name: 'Con',
            model: 'default/model',
            role: 'Argue against shipping.',
            participantMods: [],
          },
        ],
        sharedContext: [{
          cardId: 'shared-note',
          label: 'Shared evidence',
          text: '### Shared evidence\n\n- One shared fact',
        }],
        topLevelMods: [{
          cardId: 'top-mod',
          label: 'Top guidance',
          instructions: ['**Keep every claim grounded.**'],
        }],
        turns: [{
          speakerName: 'Pro',
          participantCardId: 'pro',
          currentTurn: 1,
          totalTurns: 2,
          instruction: '### Turn instruction\n\n1. Make the opening case.',
        }],
      },
    }
    const version: OutputVersion = {
      id: 'version',
      number: 1,
      text: '',
      createdAt: '2026-07-14T00:00:00.000Z',
      fromRunId: run.id,
    }
    useGraph.setState({ runs: [run] })

    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
    render(
      <OverlayProvider>
        <VersionContext version={version} onClose={() => undefined} />
      </OverlayProvider>,
      { container: appRoot },
    )

    const pro = screen.getByText('Pro').closest<HTMLElement>('.e-context-row')!
    const con = screen.getByText('Con').closest<HTMLElement>('.e-context-row')!
    expect(within(pro).getByRole('heading', { level: 3, name: 'Shipping advocate' })).toBeVisible()
    expect(within(pro).getByText('Argue for shipping.').closest('li')).toBeVisible()
    expect(within(pro).queryByText(/### Shipping advocate/)).toBeNull()
    expect(within(pro).getByText('Guidance for this participant')).toBeTruthy()
    expect(within(pro).getByText('Pro challenger')).toBeTruthy()
    expect(within(pro).getByText('Challenge confident assumptions.')).toBeTruthy()
    expect(within(con).queryByText('Challenge confident assumptions.')).toBeNull()
    expect(screen.getByText('Guidance for everyone').closest('.context-surface__section')).not.toHaveTextContent(
      'Challenge confident assumptions.',
    )
    expect(screen.getByRole('heading', { level: 3, name: 'Shared evidence' })).toBeVisible()
    expect(screen.getByText('Keep every claim grounded.').tagName).toBe('STRONG')
    expect(screen.getByRole('heading', { level: 3, name: 'Turn instruction' })).toBeInTheDocument()
  })
})
