import type { AnyModFaceDefinition } from '../types'
import { filterFaceDefinition } from '../filterFace'
import { matrixFaceDefinition } from '../matrixFace'
import { mixerFaceDefinition } from '../mixerFace'

// #770 owns mixer, filter, and matrix without touching another face family's registry.
export const complexFaceDefinitions: readonly AnyModFaceDefinition[] = [
  mixerFaceDefinition,
  filterFaceDefinition,
  matrixFaceDefinition,
]
