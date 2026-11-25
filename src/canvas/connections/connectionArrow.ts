import { CONNECTION_ARROW_METRICS, CONNECTOR_NODE_METRICS } from '../../ui/tokens'

export type ConnectionArrowDirection = 'left' | 'right' | 'top' | 'bottom'

export function connectionArrowGeometry(scale = 1) {
  const length = (CONNECTOR_NODE_METRICS.diameter / 2 + CONNECTION_ARROW_METRICS.tipExtension) * scale
  const halfHeight = (length * CONNECTION_ARROW_METRICS.heightRatio) / 2
  return { length, halfHeight }
}

// The tip is the local origin. The body extends back along negative X, so
// translating this polygon to the target connector makes contact exact rather
// than relying on browser-specific SVG marker reference-box arithmetic.
export function connectionArrowPoints(scale = 1): string {
  const { length, halfHeight } = connectionArrowGeometry(scale)
  return `0,0 ${-length},${-halfHeight} ${-length},${halfHeight}`
}

export function connectionArrowRotation(direction: ConnectionArrowDirection): number {
  if (direction === 'right') return 180
  if (direction === 'top') return 90
  if (direction === 'bottom') return -90
  return 0
}
