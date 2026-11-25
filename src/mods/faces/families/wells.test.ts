import { describe, expect, it } from 'vitest'
import { padFaceDefinition } from '../padFace'
import { radarFaceDefinition } from '../radarFace'
import { wellFaceDefinitions } from './wells'

describe('the well face lane aggregation seam', () => {
  it('exports only the Pad and Radar definitions for later host wiring', () => {
    expect(wellFaceDefinitions).toEqual([padFaceDefinition, radarFaceDefinition])
  })
})
