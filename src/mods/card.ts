import type { Card } from '../graph/types'
import type { Mod } from './model'

export type V2ModCard = Card & {
  kind: 'mod'
  modV2: Mod
}

export function isV2ModCard(card: Card): card is V2ModCard {
  return card.kind === 'mod' && card.modV2 !== undefined
}
