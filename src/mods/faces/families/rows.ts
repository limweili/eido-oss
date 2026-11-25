import { countFaceDefinition } from '../countFace'
import { dialFaceDefinition } from '../dialFace'
import { sliderFaceDefinition } from '../sliderFace'
import { switchFaceDefinition } from '../switchFace'
import type { AnyModFaceDefinition } from '../types'

// #763 owns the slider tracer; #767 extends only this row-family seam.
export const rowFaceDefinitions: readonly AnyModFaceDefinition[] = [
  sliderFaceDefinition,
  dialFaceDefinition,
  countFaceDefinition,
  switchFaceDefinition,
]
