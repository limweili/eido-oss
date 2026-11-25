import type { ModKind } from '../model'
import { complexFaceDefinitions } from './families/complex'
import { optionFaceDefinitions } from './families/options'
import { rowFaceDefinitions } from './families/rows'
import { wellFaceDefinitions } from './families/wells'
import { mountModSettings } from './settings'
import type { AnyModFaceDefinition, ModFaceDefinition } from './types'

const familyDefinitions: readonly AnyModFaceDefinition[] = [
  ...rowFaceDefinitions,
  ...optionFaceDefinitions,
  ...wellFaceDefinitions,
  ...complexFaceDefinitions,
]

const productionDefinitions = familyDefinitions.map((definition) => ({
  ...definition,
  settings: definition.settings ?? mountModSettings,
})) as readonly AnyModFaceDefinition[]

export type ModFaceRegistry = Readonly<{
  definitionFor: <K extends ModKind>(kind: K) => ModFaceDefinition<K> | undefined
}>

export function createModFaceRegistry(
  definitions: readonly AnyModFaceDefinition[],
): ModFaceRegistry {
  const definitionsByKind = new Map<ModKind, AnyModFaceDefinition>()
  for (const definition of definitions) {
    if (definitionsByKind.has(definition.kind)) {
      throw new Error(`Duplicate Mod face definition for ${definition.kind}`)
    }
    definitionsByKind.set(definition.kind, definition)
  }

  return {
    definitionFor<K extends ModKind>(kind: K) {
      return definitionsByKind.get(kind) as ModFaceDefinition<K> | undefined
    },
  }
}

const modFaceRegistry = createModFaceRegistry(productionDefinitions)

export function modFaceDefinitionFor<K extends ModKind>(kind: K): ModFaceDefinition<K> | undefined {
  return modFaceRegistry.definitionFor(kind)
}
