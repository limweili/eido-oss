import { describe, expect, it } from 'vitest'
import {
  cameraViewportTransform,
  centeredViewportForCameraTarget,
} from './cameraViewport'

describe('immediate camera viewport', () => {
  it('derives the exact React Flow viewport and transform for a centered target', () => {
    const viewport = centeredViewportForCameraTarget(
      { x: 9130, y: 4090, zoom: 0.325 },
      { width: 1280, height: 751 },
    )

    expect(viewport).toEqual({ x: -2327.25, y: -953.75, zoom: 0.325 })
    expect(cameraViewportTransform(viewport)).toBe(
      'translate(-2327.25px,-953.75px) scale(0.325)',
    )
  })
})
