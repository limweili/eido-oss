import { listModPartIdentities, type Mod } from '../mods'
import type { GuiNewModOrigin } from '../persistence/profileGuiProjection'

export type ProfileModOriginCompanion = Readonly<{
  mod: Mod
  origin: GuiNewModOrigin
}>

type StampedGuiNewModOrigin = Extract<GuiNewModOrigin, Readonly<{ kind: 'stamped' }>>

export type ProfileModTemplateRevision = Readonly<Pick<
  StampedGuiNewModOrigin,
  'sourceTemplateId' | 'sourceTemplateVersion'
>>

export function captureDirectProfileModOrigin(
  mod: Mod,
  instanceId: string,
): ProfileModOriginCompanion {
  const partIds = listModPartIdentities(mod).map((part) => part.sourceId)
  if (!nonEmptyString(instanceId)
    || partIds.includes(instanceId)) {
    throw new Error('Direct Mod origin requires a distinct instance-record identity')
  }
  return deepFreeze({
    mod: cloneMod(mod),
    origin: { kind: 'direct', instanceId },
  } satisfies ProfileModOriginCompanion)
}

export function captureStampedProfileModOrigin(
  sourceMod: Mod,
  stampedMod: Mod,
  source: ProfileModTemplateRevision,
  instanceId: string,
): ProfileModOriginCompanion {
  if (!nonEmptyString(source.sourceTemplateId)
    || !Number.isSafeInteger(source.sourceTemplateVersion)
    || source.sourceTemplateVersion <= 0
    || !nonEmptyString(instanceId)) {
    throw new Error('Stamped Mod origin requires a valid Profile template revision and instance identity')
  }
  const sourceParts = listModPartIdentities(sourceMod)
  const instanceParts = listModPartIdentities(stampedMod)
  if (sourceParts.length !== instanceParts.length) {
    throw new Error('Stamped Mod origin requires one instance member for every source member')
  }
  const sourceIds = [source.sourceTemplateId, ...sourceParts.map((part) => part.sourceId)]
  const instanceIds = [instanceId, ...instanceParts.map((part) => part.sourceId)]
  if (sourceIds.some((id) => !nonEmptyString(id))
    || instanceIds.some((id) => !nonEmptyString(id))
    || new Set(sourceIds).size !== sourceIds.length
    || new Set(instanceIds).size !== instanceIds.length
    || instanceIds.some((id) => sourceIds.includes(id))) {
    throw new Error('Stamped Mod origin requires fresh, unique source and instance identities')
  }
  return deepFreeze({
    mod: cloneMod(stampedMod),
    origin: {
      kind: 'stamped',
      instanceId,
      sourceTemplateId: source.sourceTemplateId,
      sourceTemplateVersion: source.sourceTemplateVersion,
      sourceToInstanceIdMap: {
        mod: { sourceId: source.sourceTemplateId, instanceId },
        controls: sourceParts.map((part, index) => ({
          sourceId: part.sourceId,
          instanceId: instanceParts[index]!.sourceId,
        })),
      },
    },
  } satisfies ProfileModOriginCompanion)
}

function cloneMod(mod: Mod): Mod {
  return JSON.parse(JSON.stringify(mod)) as Mod
}

function nonEmptyString(value: string): boolean {
  return value.trim().length > 0
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}
