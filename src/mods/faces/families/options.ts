import { orderFaceDefinition } from '../orderFace'
import { selectFaceDefinition } from '../selectFace'
import type { AnyModFaceDefinition } from '../types'

// #768 owns select and order without touching another face family's registry.
export const optionFaceDefinitions: readonly AnyModFaceDefinition[] = [
  selectFaceDefinition,
  orderFaceDefinition,
]
