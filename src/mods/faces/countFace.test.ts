// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mod } from '../model'
import { createSeedMod } from '../seeds'
import { countFaceDefinition } from './countFace'
import { mountModFaceHost } from './host'

function mountCount() {
  const root = document.createElement('div')
  document.body.append(root)
  const commits: Array<{ mod: Mod<'count'>; label: string }> = []
  const mod = createSeedMod('count', { createId: (_, ordinal) => `count-${ordinal}` })
  const host = mountModFaceHost({
    root,
    definition: countFaceDefinition,
    mod,
    selected: true,
    canEdit: true,
    commit: (next, label) => {
      commits.push({ mod: next, label })
      return true
    },
  })
  return { root, commits, host }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('the count face', () => {
  it('shows a bare number and commits one exact step through the accessible instrument', () => {
    const mounted = mountCount()
    const value = mounted.root.querySelector<HTMLElement>('.i-count .n')!
    const increase = mounted.root.querySelector<HTMLButtonElement>('[aria-label="Increase WORKED EXAMPLES"]')!

    expect(value).toHaveTextContent('2')
    expect(value.textContent).not.toContain('/')
    expect(value).toHaveAttribute('aria-live', 'polite')

    increase.click()

    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0]).toMatchObject({ label: 'Increase count' })
    expect(mounted.commits[0].mod.state.items[0].n).toBe(3)
    expect(value).toHaveTextContent('3')
  })

  it('keeps stepper keys inside the selected Mod face', () => {
    const mounted = mountCount()
    const boardKey = vi.fn()
    mounted.root.parentElement!.addEventListener('keydown', boardKey)
    const increase = mounted.root.querySelector<HTMLButtonElement>('[aria-label="Increase WORKED EXAMPLES"]')!
    const key = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })

    increase.dispatchEvent(key)

    expect(boardKey).not.toHaveBeenCalled()
  })

  it('rescales counts while cycling NUMBER, PERCENT, and RATIO modes', () => {
    const mounted = mountCount()
    const mode = mounted.root.querySelector<HTMLButtonElement>('.count-mode')!
    const value = mounted.root.querySelector<HTMLElement>('.i-count .n')!

    expect(mode).toHaveTextContent('NUMBER')
    mode.click()

    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0]).toMatchObject({ label: 'Change count mode' })
    expect(mounted.commits[0].mod.state).toMatchObject({ mode: 'percent' })
    expect(mounted.commits[0].mod.state.items[0].n).toBe(1)
    expect(value).toHaveTextContent('25%')

    mode.click()
    expect(mounted.commits).toHaveLength(2)
    expect(mounted.commits[1].mod.state).toMatchObject({ mode: 'ratio' })
    expect(value).toHaveTextContent('1 / 4')
  })

  it('renames and removes counters with one discrete commit per action', () => {
    const mounted = mountCount()
    const label = mounted.root.querySelector<HTMLElement>('.mod-sub')!
    label.focus()
    label.textContent = 'EXAMPLES'
    label.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))

    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0]).toMatchObject({ label: 'Rename count' })
    expect(mounted.commits[0].mod.state.items[0].label).toBe('EXAMPLES')

    // Growth moved to the card head's + key (ModCard); the face owns rename
    // and removal only.
    expect(mounted.root.querySelector('.mod-add')).toBeNull()

    mounted.root.querySelector<HTMLButtonElement>('.row-x')!.click()
    expect(mounted.commits).toHaveLength(2)
    expect(mounted.commits[1]).toMatchObject({ label: 'Remove count' })
    expect(mounted.root.querySelectorAll('.i-countrow')).toHaveLength(1)
  })
})
