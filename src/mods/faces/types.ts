import type { Mod, ModKind } from '../model'
import type { DeepReadonly } from '../snapshot'
import type { AnimationFrameScheduler } from './pointerGesture'

export type ModFaceRenderState<K extends ModKind> = Readonly<{
  mod: DeepReadonly<Mod<K>>
  selected: boolean
  canEdit: boolean
  interactive: boolean
}>

export type ModFaceHostUpdate<K extends ModKind> = Readonly<{
  mod: Mod<K>
  selected: boolean
  canEdit: boolean
}>

export type ModFaceMountContext<K extends ModKind> = Readonly<{
  root: HTMLElement
  animationFrames: AnimationFrameScheduler
  commit: (nextMod: Mod<K>, label: string) => boolean
  beginGesture: () => () => void
}>

export type MountedModFace<K extends ModKind> = Readonly<{
  update: (state: ModFaceRenderState<K>) => void
  dispose: () => void
}>

export type ModFaceSettingsRenderState<K extends ModKind> = Readonly<{
  mod: DeepReadonly<Mod<K>>
  interactive: boolean
}>

export type ModFaceSettingsMountContext<K extends ModKind> = ModFaceSettingsRenderState<K> & Readonly<{
  root: HTMLElement
  commit: (nextMod: Mod<K>, label: string) => boolean
}>

export type MountedModFaceSettings<K extends ModKind> = Readonly<{
  update: (state: ModFaceSettingsRenderState<K>) => void
  dispose: () => void
}>

export type ModFaceDefinition<K extends ModKind> = Readonly<{
  kind: K
  mount: (context: ModFaceMountContext<K>) => MountedModFace<K>
  settings?: (context: ModFaceSettingsMountContext<K>) => MountedModFaceSettings<K>
}>

export type AnyModFaceDefinition = {
  [K in ModKind]: ModFaceDefinition<K>
}[ModKind]

export type MountedModFaceHost<K extends ModKind> = Readonly<{
  update: (state: ModFaceHostUpdate<K>) => void
  mountSettings: (root: HTMLElement) => Readonly<{ dispose: () => void }> | undefined
  dispose: () => void
}>
