import { resolveCardIdentity } from '../../ui/cardIdentity'
import type { Mod, ModKind } from '../model'
import { cloneDetached, type DeepReadonly } from '../snapshot'
import { browserAnimationFrames, type AnimationFrameScheduler } from './pointerGesture'
import type {
  ModFaceDefinition,
  ModFaceHostUpdate,
  ModFaceMountContext,
  ModFaceSettingsRenderState,
  MountedModFaceHost,
  MountedModFaceSettings,
} from './types'

export type MountModFaceHostOptions<K extends ModKind> = ModFaceHostUpdate<K> & Readonly<{
  root: HTMLElement
  definition: ModFaceDefinition<K>
  animationFrames?: AnimationFrameScheduler
  commit: (nextMod: Mod<K>, label: string) => boolean | void
  onGestureChange?: (active: boolean) => void
}>

type ActiveModFaceSettings<K extends ModKind> = Readonly<{
  mounted: MountedModFaceSettings<K>
  dispose: () => void
}>

export function mountModFaceHost<K extends ModKind>(
  options: MountModFaceHostOptions<K>,
): MountedModFaceHost<K> {
  if (options.definition.kind !== options.mod.kind) {
    throw new Error(`Cannot mount ${options.definition.kind} face for ${options.mod.kind} Mod`)
  }

  const { root } = options
  const gestureTokens = new Set<symbol>()
  let disposed = false
  let settingsState: ModFaceSettingsRenderState<K> | undefined
  let activeSettings: ActiveModFaceSettings<K> | undefined

  root.classList.add('mod-face-host')
  root.dataset.modFaceKind = options.definition.kind

  const beginGesture = () => {
    if (disposed) throw new Error('Cannot begin a gesture on a disposed Mod face host')
    const token = Symbol('mod-face-gesture')
    const wasIdle = gestureTokens.size === 0
    gestureTokens.add(token)
    if (wasIdle) options.onGestureChange?.(true)
    let released = false
    return () => {
      if (released) return
      released = true
      if (disposed) return
      gestureTokens.delete(token)
      if (gestureTokens.size === 0) options.onGestureChange?.(false)
    }
  }

  const commit = (nextMod: Mod<K>, label: string) => {
    if (disposed || nextMod.kind !== options.definition.kind) return false
    return options.commit(cloneDetached(nextMod), label) !== false
  }

  const context: ModFaceMountContext<K> = {
    root,
    animationFrames: options.animationFrames ?? browserAnimationFrames,
    beginGesture,
    commit,
  }
  const mounted = options.definition.mount(context)

  const update = (state: ModFaceHostUpdate<K>) => {
    if (disposed) throw new Error('Cannot update a disposed Mod face host')
    if (state.mod.kind !== options.definition.kind) {
      throw new Error(`Cannot update ${options.definition.kind} face with ${state.mod.kind} Mod`)
    }
    const interactive = state.selected && state.canEdit
    root.classList.toggle('nodrag', state.selected)
    root.toggleAttribute('inert', !interactive)
    root.setAttribute('aria-disabled', String(!interactive))
    root.style.setProperty('--e-mod-face-accent', state.mod.accent)
    root.style.setProperty('--e-mod-face-on-accent', resolveCardIdentity(state.mod.accent).onSolid)
    settingsState = {
      mod: cloneDetached(state.mod) as DeepReadonly<Mod<K>>,
      interactive,
    }
    mounted.update({
      mod: cloneDetached(state.mod) as DeepReadonly<Mod<K>>,
      selected: state.selected,
      canEdit: state.canEdit,
      interactive,
    })
    if (activeSettings) {
      activeSettings.mounted.update({
        mod: cloneDetached(state.mod) as DeepReadonly<Mod<K>>,
        interactive,
      })
    }
  }

  update(options)

  return {
    update,
    mountSettings(settingsRoot) {
      if (disposed) throw new Error('Cannot mount settings on a disposed Mod face host')
      if (activeSettings) throw new Error('Mod face settings are already mounted')
      const mountSettings = options.definition.settings
      if (!mountSettings || !settingsState) return undefined

      let settingsDisposed = false
      const mountedSettings = mountSettings({
        root: settingsRoot,
        mod: cloneDetached(settingsState.mod) as DeepReadonly<Mod<K>>,
        interactive: settingsState.interactive,
        commit(nextMod, label) {
          if (settingsDisposed) return false
          return commit(nextMod, label)
        },
      })
      const settingsHost: ActiveModFaceSettings<K> = {
        mounted: mountedSettings,
        dispose() {
          if (settingsDisposed) return
          settingsDisposed = true
          if (activeSettings === settingsHost) activeSettings = undefined
          try {
            mountedSettings.dispose()
          } finally {
            settingsRoot.replaceChildren()
          }
        },
      }
      activeSettings = settingsHost
      return settingsHost
    },
    dispose() {
      if (disposed) return
      disposed = true
      try {
        activeSettings?.dispose()
      } finally {
        try {
          mounted.dispose()
        } finally {
          if (gestureTokens.size > 0) {
            gestureTokens.clear()
            options.onGestureChange?.(false)
          }
          root.replaceChildren()
          root.classList.remove('mod-face-host', 'nodrag')
          root.removeAttribute('inert')
          root.removeAttribute('aria-disabled')
          root.style.removeProperty('--e-mod-face-accent')
          delete root.dataset.modFaceKind
        }
      }
    },
  }
}
