import { describe, expect, it } from 'vitest'
import { filterFaceDefinition } from '../filterFace'
import { matrixFaceDefinition } from '../matrixFace'
import { mixerFaceDefinition } from '../mixerFace'
import { complexFaceDefinitions } from './complex'

describe('the complex Mod face family', () => {
  it('exposes only mixer, filter, and matrix to the host registry', () => {
    expect(complexFaceDefinitions).toEqual([
      mixerFaceDefinition,
      filterFaceDefinition,
      matrixFaceDefinition,
    ])
  })
})
