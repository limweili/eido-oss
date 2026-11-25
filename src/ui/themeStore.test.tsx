// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThemePreference } from './theme'
import {
  COLOR_SCHEME_QUERY,
  setThemePreference,
  useAppliedTheme,
  useEffectiveTheme,
  useThemePreference,
} from './themeStore'

class MutableMediaQueryList {
  matches = false
  readonly media = COLOR_SCHEME_QUERY
  readonly onchange = null
  readonly addEventListener = vi.fn((_type: string, listener: EventListener) => {
    this.listeners.add(listener)
  })
  readonly removeEventListener = vi.fn((_type: string, listener: EventListener) => {
    this.listeners.delete(listener)
  })
  readonly addListener = vi.fn()
  readonly removeListener = vi.fn()
  readonly dispatchEvent = vi.fn(() => true)
  private readonly listeners = new Set<EventListener>()

  setMatches(matches: boolean) {
    this.matches = matches
    const event = new Event('change')
    Object.defineProperty(event, 'matches', { value: matches })
    for (const listener of this.listeners) listener(event)
  }
}

function EffectiveTheme({ preference }: { preference: ThemePreference }) {
  return <output>{useEffectiveTheme(preference)}</output>
}

function RequestedTheme() {
  return <output>{useThemePreference()}</output>
}

function AppliedTheme() {
  return <output>{useAppliedTheme()}</output>
}

describe('theme external stores', () => {
  let media: MutableMediaQueryList

  beforeEach(() => {
    localStorage.clear()
    media = new MutableMediaQueryList()
    window.matchMedia = vi.fn(() => media as unknown as MediaQueryList)
  })

  afterEach(cleanup)

  it('subscribes to Match system at runtime and cleans up when no longer requested', () => {
    const view = render(<EffectiveTheme preference="light" />)
    expect(screen.getByText('light')).toBeInTheDocument()
    expect(media.addEventListener).not.toHaveBeenCalled()

    view.rerender(<EffectiveTheme preference="system" />)
    expect(media.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))

    act(() => media.setMatches(true))
    expect(screen.getByText('dark')).toBeInTheDocument()

    view.rerender(<EffectiveTheme preference="dark" />)
    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    expect(screen.getByText('dark')).toBeInTheDocument()
  })

  it('publishes same-tab preference changes after device persistence', () => {
    render(<RequestedTheme />)
    expect(screen.getByText('light')).toBeInTheDocument()

    act(() => {
      expect(setThemePreference('system')).toBe(true)
    })

    expect(screen.getByText('system')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('eido-v3-settings') ?? '{}')).toMatchObject({
      theme: 'system',
    })
  })

  it('keeps the document theme attribute on the effective runtime theme', () => {
    localStorage.setItem('eido-v3-settings', JSON.stringify({ theme: 'system' }))
    const view = render(<AppliedTheme />)
    expect(document.documentElement.dataset.theme).toBe('light')

    act(() => media.setMatches(true))
    expect(document.documentElement.dataset.theme).toBe('dark')

    view.unmount()
    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
