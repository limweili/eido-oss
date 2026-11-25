import type { ModKind, ModPartRole, ModStateByKind } from './model'
import { cloneDetached, type DeepReadonly } from './snapshot'

export type ModIdentityBearing<K extends ModKind = ModKind> = {
  [P in K]: { kind: P; state: DeepReadonly<ModStateByKind[P]> }
}[K]

export type ModPartIdentity = {
  role: ModPartRole
  path: readonly (string | number)[]
  sourceId: string
  ordinal: number
}

export type ModPartIdentityMapping = ModPartIdentity & { instanceId: string }
export type ModPartIdentityAllocator = (identity: ModPartIdentity) => string

function identitiesFor(
  role: ModPartRole,
  path: readonly (string | number)[],
  parts: readonly { id: string }[],
  startOrdinal: number,
): ModPartIdentity[] {
  return parts.map((part, index) => ({
    role,
    path: [...path, index, 'id'],
    sourceId: part.id,
    ordinal: startOrdinal + index,
  }))
}

export function listModPartIdentities(value: ModIdentityBearing): ModPartIdentity[] {
  switch (value.kind) {
    case 'mixer':
    case 'slider':
    case 'dial':
    case 'count':
    case 'switch':
    case 'order':
      return identitiesFor('item', ['state', 'items'], value.state.items, 0)
    case 'filter':
      return identitiesFor('lane', ['state', 'lanes'], value.state.lanes, 0)
    case 'pad':
      return [
        { role: 'axis', path: ['state', 'axes', 'x', 'id'], sourceId: value.state.axes.x.id, ordinal: 0 },
        { role: 'axis', path: ['state', 'axes', 'y', 'id'], sourceId: value.state.axes.y.id, ordinal: 1 },
      ]
    case 'select':
      return identitiesFor('option', ['state', 'options'], value.state.options, 0)
    case 'radar':
      return identitiesFor('axis', ['state', 'axes'], value.state.axes, 0)
    case 'matrix': {
      const rows = identitiesFor('row', ['state', 'rows'], value.state.rows, 0)
      return [
        ...rows,
        ...identitiesFor('column', ['state', 'cols'], value.state.cols, rows.length),
      ]
    }
  }
}

function assignPath(root: object, path: readonly (string | number)[], value: string): void {
  let target: unknown = root
  for (const key of path.slice(0, -1)) {
    if (typeof target !== 'object' || target === null) {
      throw new Error(`Invalid Mod identity path: ${path.join('.')}`)
    }
    target = (target as Record<string | number, unknown>)[key]
  }
  if (typeof target !== 'object' || target === null) {
    throw new Error(`Invalid Mod identity path: ${path.join('.')}`)
  }
  const finalKey = path[path.length - 1]
  if (finalKey === undefined) throw new Error('A Mod identity path cannot be empty')
  ;(target as Record<string | number, unknown>)[finalKey] = value
}

export function remapModPartIdentities<T extends ModIdentityBearing>(
  value: T,
  allocate: ModPartIdentityAllocator,
): { value: T; mappings: ModPartIdentityMapping[] } {
  const identities = listModPartIdentities(value)
  const sourceIds = new Set<string>()
  for (const identity of identities) {
    if (!identity.sourceId.trim()) throw new Error('A source Mod part id must be non-blank')
    if (sourceIds.has(identity.sourceId)) throw new Error('Source Mod part ids must be unique')
    sourceIds.add(identity.sourceId)
  }

  const instanceIds = new Set<string>()
  const mappings = identities.map((identity): ModPartIdentityMapping => {
    const instanceId = allocate(identity)
    if (!instanceId.trim()) throw new Error('A remapped Mod part id must be non-blank')
    if (sourceIds.has(instanceId) || instanceIds.has(instanceId)) {
      throw new Error('A remapped Mod part id must be fresh and globally unique')
    }
    instanceIds.add(instanceId)
    return { ...identity, instanceId }
  })

  const remapped = cloneDetached(value)
  for (const mapping of mappings) assignPath(remapped, mapping.path, mapping.instanceId)
  return { value: remapped, mappings }
}
