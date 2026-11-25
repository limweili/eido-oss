// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { createSeedMod } from '../seeds'
import { mountModFaceHost } from './host'
import type {
  ModFaceDefinition,
  ModFaceMountContext,
  ModFaceRenderState,
  ModFaceSettingsMountContext,
  ModFaceSettingsRenderState,
} from './types'

describe('the imperative Mod face host', () => {
  it('gates the face with selection plus canEdit and keeps unselected content draggable', () => {
    const root = document.createElement('div')
    const updates: ModFaceRenderState<'slider'>[] = []
    const definition: ModFaceDefinition<'slider'> = {
      kind: 'slider',
      mount: () => ({
        update: (state) => updates.push(state),
        dispose: vi.fn(),
      }),
    }
    const mod = createSeedMod('slider', { createId: (_, ordinal) => `part-${ordinal}` })
    const host = mountModFaceHost({
      root,
      definition,
      mod,
      selected: false,
      canEdit: true,
      commit: vi.fn(),
    })

    expect(updates[updates.length - 1]?.interactive).toBe(false)
    expect(root.classList.contains('nodrag')).toBe(false)
    expect(root.hasAttribute('inert')).toBe(true)
    expect(root).toHaveAttribute('aria-disabled', 'true')

    host.update({ mod, selected: true, canEdit: false })
    expect(updates[updates.length - 1]?.interactive).toBe(false)
    expect(root.classList.contains('nodrag')).toBe(true)

    host.update({ mod, selected: true, canEdit: true })
    expect(updates[updates.length - 1]?.interactive).toBe(true)
    expect(root.hasAttribute('inert')).toBe(false)
    expect(root).toHaveAttribute('aria-disabled', 'false')
  })

  it('detaches commits and reference-counts simultaneous gesture owners', () => {
    const root = document.createElement('div')
    const gestureStates: boolean[] = []
    const commits: ReturnType<typeof createSeedMod<'slider'>>[] = []
    let context: ModFaceMountContext<'slider'> | undefined
    const definition: ModFaceDefinition<'slider'> = {
      kind: 'slider',
      mount: (nextContext) => {
        context = nextContext
        return { update: vi.fn(), dispose: vi.fn() }
      },
    }
    const mod = createSeedMod('slider', { createId: (_, ordinal) => `part-${ordinal}` })
    mountModFaceHost({
      root,
      definition,
      mod,
      selected: true,
      canEdit: true,
      onGestureChange: (active) => gestureStates.push(active),
      commit: (next) => {
        commits.push(next)
        return true
      },
    })

    const releaseFirst = context!.beginGesture()
    const releaseSecond = context!.beginGesture()
    expect(gestureStates).toEqual([true])
    releaseFirst()
    expect(gestureStates).toEqual([true])
    releaseSecond()
    releaseSecond()
    expect(gestureStates).toEqual([true, false])

    const next = structuredClone(mod)
    next.state.items[0].v = 88
    expect(context!.commit(next, 'Adjust slider')).toBe(true)
    expect(commits).toHaveLength(1)
    expect(commits[0]).not.toBe(next)
    next.state.items[0].v = 1
    expect(commits[0].state.items[0].v).toBe(88)
  })

  it('forces outstanding gesture ownership and face DOM to retire on disposal', () => {
    const root = document.createElement('div')
    const faceNode = document.createElement('span')
    const gestureStates: boolean[] = []
    let context: ModFaceMountContext<'slider'> | undefined
    const dispose = vi.fn()
    const definition: ModFaceDefinition<'slider'> = {
      kind: 'slider',
      mount: (nextContext) => {
        context = nextContext
        root.append(faceNode)
        return { update: vi.fn(), dispose }
      },
    }
    const mod = createSeedMod('slider', { createId: (_, ordinal) => `part-${ordinal}` })
    const host = mountModFaceHost({
      root,
      definition,
      mod,
      selected: true,
      canEdit: true,
      onGestureChange: (active) => gestureStates.push(active),
      commit: vi.fn(),
    })

    context!.beginGesture()
    host.dispose()

    expect(dispose).toHaveBeenCalledOnce()
    expect(gestureStates).toEqual([true, false])
    expect(root.childElementCount).toBe(0)
    expect(root.classList.contains('mod-face-host')).toBe(false)
    expect(root.classList.contains('nodrag')).toBe(false)
    expect(() => host.update({ mod, selected: true, canEdit: true })).toThrow(/disposed/i)
  })

  it('mounts kind-owned settings with detached state and the host commit boundary', () => {
    const root = document.createElement('div')
    const settingsRoot = document.createElement('div')
    const settingsUpdates: ModFaceSettingsRenderState<'slider'>[] = []
    const commits: Array<{ mod: ReturnType<typeof createSeedMod<'slider'>>; label: string }> = []
    const settingsDispose = vi.fn()
    let settingsContext: ModFaceSettingsMountContext<'slider'> | undefined
    const definition: ModFaceDefinition<'slider'> = {
      kind: 'slider',
      mount: () => ({ update: vi.fn(), dispose: vi.fn() }),
      settings: (context) => {
        settingsContext = context
        context.root.append(document.createElement('label'))
        return {
          update: (state) => settingsUpdates.push(state),
          dispose: settingsDispose,
        }
      },
    }
    const mod = createSeedMod('slider', { createId: (_, ordinal) => `part-${ordinal}` })
    const originalValue = mod.state.items[0].v
    const host = mountModFaceHost({
      root,
      definition,
      mod,
      selected: true,
      canEdit: true,
      commit: (nextMod, label) => {
        commits.push({ mod: nextMod, label })
        return true
      },
    })

    const mountedSettings = host.mountSettings(settingsRoot)
    expect(mountedSettings).toBeDefined()
    expect(settingsContext!.mod).not.toBe(mod)
    expect(settingsContext!.mod.state.items[0].v).toBe(originalValue)
    expect(settingsContext!.interactive).toBe(true)
    mod.state.items[0].v = originalValue + 1
    expect(settingsContext!.mod.state.items[0].v).toBe(originalValue)

    const updatedMod = createSeedMod('slider', { createId: (_, ordinal) => `next-${ordinal}` })
    updatedMod.state.items[0].v = 82
    host.update({ mod: updatedMod, selected: false, canEdit: true })
    expect(settingsUpdates).toHaveLength(1)
    expect(settingsUpdates[0].mod).not.toBe(updatedMod)
    expect(settingsUpdates[0].mod.state.items[0].v).toBe(82)
    expect(settingsUpdates[0].interactive).toBe(false)

    const committedMod = structuredClone(updatedMod)
    committedMod.state.items[0].v = 63
    expect(settingsContext!.commit(committedMod, 'Edit option prompt')).toBe(true)
    expect(commits).toHaveLength(1)
    expect(commits[0]).toEqual({ mod: committedMod, label: 'Edit option prompt' })
    expect(commits[0].mod).not.toBe(committedMod)
    committedMod.state.items[0].v = 2
    expect(commits[0].mod.state.items[0].v).toBe(63)

    mountedSettings!.dispose()
    expect(settingsDispose).toHaveBeenCalledOnce()
    expect(settingsRoot.childElementCount).toBe(0)
    expect(settingsContext!.commit(updatedMod, 'Stale settings commit')).toBe(false)
    expect(commits).toHaveLength(1)
  })

  it('retires an open settings mount with the face host', () => {
    const root = document.createElement('div')
    const settingsRoot = document.createElement('div')
    const settingsDispose = vi.fn()
    const definition: ModFaceDefinition<'slider'> = {
      kind: 'slider',
      mount: () => ({ update: vi.fn(), dispose: vi.fn() }),
      settings: (context) => {
        context.root.append(document.createElement('input'))
        return { update: vi.fn(), dispose: settingsDispose }
      },
    }
    const mod = createSeedMod('slider', { createId: (_, ordinal) => `part-${ordinal}` })
    const host = mountModFaceHost({
      root,
      definition,
      mod,
      selected: true,
      canEdit: true,
      commit: vi.fn(),
    })

    host.mountSettings(settingsRoot)
    host.dispose()

    expect(settingsDispose).toHaveBeenCalledOnce()
    expect(settingsRoot.childElementCount).toBe(0)
  })
})
