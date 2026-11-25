import { padFaceDefinition } from '../padFace'
import { radarFaceDefinition } from '../radarFace'
import type { AnyModFaceDefinition } from '../types'

// #769 owns pad and radar without touching another face family's registry.
export const wellFaceDefinitions: readonly AnyModFaceDefinition[] = [
  padFaceDefinition,
  radarFaceDefinition,
]
