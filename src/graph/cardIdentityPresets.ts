/**
 * Stable domain ids for the approved Card identity palette. The persisted
 * value remains the solid colour; adapters use these ids at human/agent
 * boundaries without importing presentation code into graph writers.
 */
export const CARD_IDENTITY_PRESETS = Object.freeze([
  Object.freeze({ id: 'coral', solid: '#f1666d' }),
  Object.freeze({ id: 'red', solid: '#c9282e' }),
  Object.freeze({ id: 'amber', solid: '#eca23b' }),
  Object.freeze({ id: 'orange', solid: '#b5540f' }),
  Object.freeze({ id: 'mint', solid: '#65b563' }),
  Object.freeze({ id: 'green', solid: '#1b7550' }),
  Object.freeze({ id: 'sky', solid: '#48a2ef' }),
  Object.freeze({ id: 'blue', solid: '#3568c6' }),
  Object.freeze({ id: 'orchid', solid: '#d66be8' }),
  Object.freeze({ id: 'purple', solid: '#9c3fba' }),
  Object.freeze({ id: 'slate', solid: '#8b939c' }),
  Object.freeze({ id: 'charcoal', solid: '#2e2b25' }),
] as const)

export type CardIdentityPresetId = (typeof CARD_IDENTITY_PRESETS)[number]['id']

const CARD_IDENTITY_SOLID_BY_ID = new Map<CardIdentityPresetId, string>(
  CARD_IDENTITY_PRESETS.map(({ id, solid }) => [id, solid]),
)

export function cardIdentityPresetSolid(id: string): string | undefined {
  return CARD_IDENTITY_SOLID_BY_ID.get(id as CardIdentityPresetId)
}
