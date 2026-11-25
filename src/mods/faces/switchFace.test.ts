// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mod } from '../model'
import { createSeedMod } from '../seeds'
import { mountModFaceHost } from './host'
import { switchFaceDefinition } from './switchFace'

function mountSwitch() {
  const root = document.createElement('div')
  document.body.append(root)
  const commits: Array<{ mod: Mod<'switch'>; label: string }> = []
  const mod = createSeedMod('switch', { createId: (_, ordinal) => `switch-${ordinal}` })
  const host = mountModFaceHost({
    root,
    definition: switchFaceDefinition,
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

describe('the switch face', () => {
  it('announces its state and commits one toggle through the switch control', () => {
    const mounted = mountSwitch()
    const control = mounted.root.querySelector<HTMLButtonElement>('[role="switch"]')!

    expect(control).toHaveAttribute('aria-label', 'CITE SOURCES')
    expect(control).toHaveAttribute('aria-checked', 'true')
    expect(control).toHaveClass('is-on')

    control.click()

    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0]).toMatchObject({ label: 'Toggle switch' })
    expect(mounted.commits[0].mod.state.items[0].on).toBe(false)
    expect(control).toHaveAttribute('aria-checked', 'false')
    expect(control).not.toHaveClass('is-on')
  })

  it('keeps native switch keys inside the selected Mod face', () => {
    const mounted = mountSwitch()
    const control = mounted.root.querySelector<HTMLButtonElement>('[role="switch"]')!
    const boardKey = vi.fn()
    mounted.root.parentElement!.addEventListener('keydown', boardKey)

    control.dispatchEvent(new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    }))

    expect(boardKey).not.toHaveBeenCalled()
  })

  it('renames and removes switches with one discrete commit per action', () => {
    const mounted = mountSwitch()
    const label = mounted.root.querySelector<HTMLElement>('.mod-sub')!
    label.focus()
    label.textContent = 'REFERENCES'
    label.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))

    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0]).toMatchObject({ label: 'Rename switch' })
    expect(mounted.commits[0].mod.state.items[0].label).toBe('REFERENCES')

    // Growth moved to the card head's + key (ModCard); the face owns rename
    // and removal only.
    expect(mounted.root.querySelector('.mod-add')).toBeNull()

    mounted.root.querySelector<HTMLButtonElement>('.row-x')!.click()
    expect(mounted.commits).toHaveLength(2)
    expect(mounted.commits[1]).toMatchObject({ label: 'Remove switch' })
    expect(mounted.root.querySelectorAll('[role="switch"]')).toHaveLength(2)
  })
})
