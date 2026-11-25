// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraph } from '../graph/store'
import type { RendererCounterSnapshot } from '../performance/rendererCounterRuntime'
import { words } from '../shared/words'
import { OverlayProvider } from '../ui/overlays'
import {
  loadRendererCountersPreference,
  RENDERER_COUNTERS_SETTINGS_FIELD,
  useRendererCountersEnabled,
} from '../ui/rendererCountersPreference'
import { DEVICE_SETTINGS_STORAGE_KEY } from '../ui/theme'
import {
  RENDERER_COUNTER_POLL_INTERVAL_MS,
  RendererCountersOverlay,
} from './RendererCountersOverlay'
import { SettingsModal } from './SettingsModal'

const SNAPSHOT: RendererCounterSnapshot = {
  residentRichCards: 12,
  passiveCards: 10,
  oversizePassiveCards: 1,
  oversizePassiveCardLimit: 10,
  passiveCardLimit: 540,
  liveCards: 2,
  boardDetailTextWeight: 420,
  admittedDetailTextWeight: 280,
  oversizePassiveTextWeight: 609_000,
  detailTextWeightBudget: 300,
  weightDemotedCardCount: 4,
  sceneDerivations: 31,
  metricDerivations: 7,
  metricVisits: 84,
  metricFullRebuilds: 3,
  renditionEntries: 8,
  renditionDecodedBytes: 2_048,
  renditionDecodedByteBudget: 4_096,
  renditionBytes: 1_024,
  renditionByteBudget: 8_192,
}

function RendererCountersJourney({
  readSnapshot,
}: {
  readSnapshot: () => RendererCounterSnapshot
}) {
  const enabled = useRendererCountersEnabled()
  return (
    <>
      <SettingsModal
        onClose={() => undefined}
      />
      {enabled && <RendererCountersOverlay readSnapshot={readSnapshot} />}
    </>
  )
}

describe('renderer counters opt-in journey', () => {
  beforeEach(() => {
    localStorage.clear()
    useGraph.setState({
      hydrated: false,
      currentIdeaId: null,
      settings: {
        apiKey: 'local-key',
        model: 'openai/gpt-4o-mini',
        models: ['openai/gpt-4o-mini'],
        reasoningEffort: 'medium',
        systemPrompt: 'Existing Idea context',
      },
    })
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('polls only while the keyboard-enabled device preference shows a readable, focus-neutral overlay', async () => {
    localStorage.setItem(DEVICE_SETTINGS_STORAGE_KEY, JSON.stringify({ theme: 'dark' }))
    const readSnapshot = vi.fn(() => SNAPSHOT)
    const intervalId = 755 as unknown as ReturnType<typeof window.setInterval>
    let scheduledPoll: (() => void) | null = null
    const nativeSetInterval = window.setInterval.bind(window)
    const nativeClearInterval = window.clearInterval.bind(window)
    const setInterval = vi.spyOn(window, 'setInterval').mockImplementation((handler, timeout, ...args) => {
      if (timeout !== RENDERER_COUNTER_POLL_INTERVAL_MS) {
        return nativeSetInterval(handler, timeout, ...args) as unknown as ReturnType<
          typeof window.setInterval
        >
      }
      if (typeof handler !== 'function') throw new Error('Expected a renderer-counter poll callback')
      scheduledPoll = handler
      return intervalId
    })
    const clearInterval = vi.spyOn(window, 'clearInterval').mockImplementation((id) => {
      if (id === intervalId) {
        scheduledPoll = null
        return
      }
      nativeClearInterval(id)
    })
    const user = userEvent.setup()

    expect(loadRendererCountersPreference()).toBe(false)
    render(
      <OverlayProvider>
        <RendererCountersJourney readSnapshot={readSnapshot} />
      </OverlayProvider>,
    )

    expect(screen.queryByRole('region', { name: words.rendererCountersTitle })).toBeNull()
    expect(readSnapshot).not.toHaveBeenCalled()
    expect(
      setInterval.mock.calls.filter(([, timeout]) => timeout === RENDERER_COUNTER_POLL_INTERVAL_MS),
    ).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: words.settingsPrivacyNav }))
    const toggle = screen.getByRole('switch', { name: words.settingsRendererCountersLabel })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    toggle.focus()
    await user.keyboard(' ')

    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(document.activeElement).toBe(toggle)
    expect(JSON.parse(localStorage.getItem(DEVICE_SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({
      theme: 'dark',
      [RENDERER_COUNTERS_SETTINGS_FIELD]: true,
    })

    const overlay = screen.getByRole('region', { name: words.rendererCountersTitle })
    expect(within(overlay).getByRole('region', { name: words.rendererCountersCards }))
      .toHaveTextContent(
        'Total Rich Cards12Live Cards (limit-exempt)2Passive Cards10 of 540Oversized visible1 of 10',
      )
    expect(within(overlay).getByRole('region', { name: words.rendererCountersTextWeight }))
      .toHaveTextContent(
        'Board total420Passive text weight280 of 300Oversized weight609,000Demoted Cards4Budget stateOver budget',
      )
    expect(within(overlay).getByText(words.rendererCountersWeightOverBudget).closest('dd'))
      .toHaveClass('t-ui')
    expect(within(overlay).getByRole('region', { name: words.rendererCountersScene }))
      .toHaveTextContent('Scene derivations31')
    expect(within(overlay).getByRole('region', { name: words.rendererCountersMetrics }))
      .toHaveTextContent('Metric derivations7Cards visited84Full rebuilds3')
    expect(within(overlay).getByRole('region', { name: words.rendererCountersRenditions }))
      .toHaveTextContent('Entries8Decoded bytes2 KiB of 4 KiBDerived bytes1 KiB of 8 KiB')
    expect(readSnapshot).toHaveBeenCalledOnce()
    expect(setInterval).toHaveBeenCalledWith(
      expect.any(Function),
      RENDERER_COUNTER_POLL_INTERVAL_MS,
    )

    act(() => {
      if (!scheduledPoll) throw new Error('Renderer-counter poll was not scheduled')
      scheduledPoll()
    })
    expect(readSnapshot).toHaveBeenCalledTimes(2)
    expect(document.activeElement).toBe(toggle)

    await user.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('region', { name: words.rendererCountersTitle })).toBeNull()
    expect(JSON.parse(localStorage.getItem(DEVICE_SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({
      theme: 'dark',
      [RENDERER_COUNTERS_SETTINGS_FIELD]: false,
    })

    expect(clearInterval).toHaveBeenCalledWith(intervalId)
    expect(scheduledPoll).toBeNull()
    act(() => scheduledPoll?.())
    expect(readSnapshot).toHaveBeenCalledTimes(2)
  })
})
