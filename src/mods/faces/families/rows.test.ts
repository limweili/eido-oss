import { describe, expect, it } from 'vitest'
import { countFaceDefinition } from '../countFace'
import { dialFaceDefinition } from '../dialFace'
import { sliderFaceDefinition } from '../sliderFace'
import { switchFaceDefinition } from '../switchFace'
import { rowFaceDefinitions } from './rows'

describe('the row Mod face family', () => {
  it('exposes the slider, dial, count, and switch definitions', () => {
    expect(rowFaceDefinitions).toEqual([
      sliderFaceDefinition,
      dialFaceDefinition,
      countFaceDefinition,
      switchFaceDefinition,
    ])
  })
})
