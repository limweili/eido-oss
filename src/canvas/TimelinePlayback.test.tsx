// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TimelineProjection, TimelineRange } from '../graph/timeline'
import { playbackEventCountLabel, words } from '../shared/words'
import { TimelinePlayback } from './TimelinePlayback'

const START_AT = '2026-07-18T00:00:00.000Z'
const MIDDLE_AT = '2026-07-18T00:00:01.000Z'
const END_AT = '2026-07-18T00:00:10.000Z'

const RANGE: TimelineRange = {
  startAt: START_AT,
  endAt: END_AT,
  startMs: Date.parse(START_AT),
  endMs: Date.parse(END_AT),
}

const PROJECTION: TimelineProjection = {
  cards: [],
  connections: [],
  ghostCardIds: new Set(),
  ghostConnectionIds: new Set(),
  eventIndex: 5,
  eventCount: 14,
  at: MIDDLE_AT,
}

afterEach(cleanup)

describe('TimelinePlayback transport', () => {
  it('renders only the four transport instruments and preserves play and numeric speed callbacks', async () => {
    const onPlayingChange = vi.fn()
    const onSpeedChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <TimelinePlayback
        range={RANGE}
        projection={PROJECTION}
        progress={0.5}
        playing={false}
        speed={2}
        onProgressChange={vi.fn()}
        onPlayingChange={onPlayingChange}
        onSpeedChange={onSpeedChange}
      />,
    )

    expect(screen.getByRole('button', { name: words.playbackPlay })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: words.playback })).toHaveClass('e-borderless-focus')
    const count = screen.getByRole('progressbar', {
      name: playbackEventCountLabel(PROJECTION.eventIndex, PROJECTION.eventCount),
    })
    expect(count).toHaveClass('t-value')
    expect(count).toHaveTextContent('5/14')
    expect(count).toHaveAttribute('aria-valuenow', '5')
    expect(count).toHaveAttribute('aria-valuemax', '14')
    expect(screen.getByRole('combobox', { name: words.playbackSpeed })).toHaveTextContent('2×')
    expect(screen.queryByRole('button', { name: /exit playback/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: words.playbackPlay }))
    expect(onPlayingChange).toHaveBeenCalledWith(true)

    rerender(
      <TimelinePlayback
        range={RANGE}
        projection={PROJECTION}
        progress={0.5}
        playing
        speed={2}
        onProgressChange={vi.fn()}
        onPlayingChange={onPlayingChange}
        onSpeedChange={onSpeedChange}
      />,
    )
    expect(screen.getByRole('button', { name: words.playbackPause })).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: words.playbackSpeed }))
    expect(screen.getByRole('option', { name: '2×' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '5×' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '10×' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '1×' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: '10×' }))
    expect(onSpeedChange).toHaveBeenCalledWith(10)
  })

  it('keeps native range changes and clamped pointer scrubbing on the rendered track', () => {
    const onProgressChange = vi.fn()
    render(
      <TimelinePlayback
        range={RANGE}
        projection={PROJECTION}
        progress={0.5}
        playing={false}
        speed={1}
        onProgressChange={onProgressChange}
        onPlayingChange={vi.fn()}
        onSpeedChange={vi.fn()}
      />,
    )

    const slider = screen.getByRole('slider', { name: words.playback })
    fireEvent.change(slider, { target: { value: '250' } })
    expect(onProgressChange).toHaveBeenLastCalledWith(0.25)

    const track = slider.closest<HTMLElement>('.timeline-scrub')!
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 0,
      left: 100,
      top: 0,
      right: 300,
      bottom: 22,
      width: 200,
      height: 22,
      toJSON: () => ({}),
    })
    track.setPointerCapture = vi.fn()
    track.hasPointerCapture = vi.fn(() => true)
    track.releasePointerCapture = vi.fn()

    fireEvent.pointerDown(track, { clientX: 50, pointerId: 7 })
    expect(onProgressChange).toHaveBeenLastCalledWith(0)
    expect(track.setPointerCapture).toHaveBeenCalledWith(7)

    fireEvent.pointerMove(track, { clientX: 350, pointerId: 7 })
    expect(onProgressChange).toHaveBeenLastCalledWith(1)

    fireEvent.pointerUp(track, { pointerId: 7 })
    expect(track.releasePointerCapture).toHaveBeenCalledWith(7)
  })
})
