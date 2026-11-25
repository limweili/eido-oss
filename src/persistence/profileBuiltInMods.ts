import {
  MOD_KIND_ORDER,
  createSeedMod,
  type Mod,
  type ModKind,
} from '../mods'

export type ProfileBuiltInModTemplate = Readonly<{
  templateId: `builtin-mod-${ModKind}`
  mod: Mod
}>

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

export const PROFILE_BUILT_IN_MOD_TEMPLATES: readonly ProfileBuiltInModTemplate[] = Object.freeze(
  MOD_KIND_ORDER.map((kind): ProfileBuiltInModTemplate => {
    const templateId = `builtin-mod-${kind}` as const
    return deepFreeze({
      templateId,
      mod: createSeedMod(kind, {
        createId: (role, ordinal) => `${templateId}-${role}-${ordinal}`,
      }),
    })
  }),
)

export function isProfileBuiltInModTemplateId(
  templateId: string,
): templateId is ProfileBuiltInModTemplate['templateId'] {
  return PROFILE_BUILT_IN_MOD_TEMPLATES.some((template) => template.templateId === templateId)
}

export type AvailableProfileModTemplate = Readonly<{
  templateId: string
  mod: Mod
  builtIn: boolean
}>

export function availableProfileModTemplates(
  userTemplates: readonly Readonly<{ templateId: string; mod: Mod }>[] = [],
): readonly AvailableProfileModTemplate[] {
  return [
    ...PROFILE_BUILT_IN_MOD_TEMPLATES.map((template) => ({ ...template, builtIn: true })),
    ...userTemplates.map((template) => ({ ...template, builtIn: false })),
  ]
}
