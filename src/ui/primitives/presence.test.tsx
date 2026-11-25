// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useExitPresence } from './presence'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function PresenceHarness({ visible }: { visible: boolean }) {
  const presence = useExitPresence(visible)
  if (!presence.mounted) return null
  return (
    <div
      data-testid="layer"
      data-state={presence.state}
      onTransitionEnd={presence.onTransitionEnd}
    />
  )
}

describe('useExitPresence', () => {
  it('enters from a frame baseline but reverses an interrupted exit from its live state', () => {
    let enterFrame: FrameRequestCallback | null = null
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      enterFrame = callback
      return 1
    })
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const { rerender } = render(<PresenceHarness visible />)
    expect(screen.getByTestId('layer')).toHaveAttribute('data-state', 'entering')

    act(() => enterFrame?.(0))
    expect(screen.getByTestId('layer')).toHaveAttribute('data-state', 'entered')

    rerender(<PresenceHarness visible={false} />)
    expect(screen.getByTestId('layer')).toHaveAttribute('data-state', 'exiting')

    rerender(<PresenceHarness visible />)
    expect(screen.getByTestId('layer')).toHaveAttribute('data-state', 'entered')
    expect(requestFrame).toHaveBeenCalledOnce()
  })

  it('retires only when the exit opacity transition completes', () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const { rerender } = render(<PresenceHarness visible />)
    rerender(<PresenceHarness visible={false} />)

    fireEvent.animationEnd(screen.getByTestId('layer'))
    expect(screen.getByTestId('layer')).toHaveAttribute('data-state', 'exiting')

    fireEvent.transitionEnd(screen.getByTestId('layer'), {
      propertyName: 'transform',
    })
    expect(screen.getByTestId('layer')).toHaveAttribute('data-state', 'exiting')

    fireEvent.transitionEnd(screen.getByTestId('layer'), {
      propertyName: 'opacity',
    })
    expect(screen.queryByTestId('layer')).not.toBeInTheDocument()
  })
})
