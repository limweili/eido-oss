import type { Mod, ModKind, ModStateByKind } from './model'

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T

export type ModValuesSnapshot<K extends ModKind = ModKind> = {
  [P in K]: DeepReadonly<{
    schema: 'mod-v2'
    kind: P
    state: ModStateByKind[P]
  }>
}[K]

export type ModPromptSource<K extends ModKind = ModKind> = {
  [P in K]: DeepReadonly<{
    kind: P
    title: string
    state: ModStateByKind[P]
    treatOverride: string | null
  }>
}[K]

export function cloneDetached<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneDetached) as T
  if (typeof value !== 'object' || value === null) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneDetached(child)]),
  ) as T
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value as DeepReadonly<T>
  }
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value) as DeepReadonly<T>
}

export function snapshotModValues<K extends ModKind>(mod: Mod<K>): ModValuesSnapshot<K> {
  return deepFreeze(cloneDetached({
    schema: 'mod-v2' as const,
    kind: mod.kind,
    state: mod.state,
  })) as ModValuesSnapshot<K>
}

export function snapshotModPromptSource<K extends ModKind>(mod: Mod<K>): ModPromptSource<K> {
  return deepFreeze(cloneDetached({
    kind: mod.kind,
    title: mod.title,
    state: mod.state,
    treatOverride: mod.treatOverride,
  })) as ModPromptSource<K>
}
