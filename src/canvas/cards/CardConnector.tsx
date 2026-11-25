import { Handle, useStore, type HandleProps } from '@xyflow/react'
import type { CSSProperties } from 'react'
import { CONNECTOR_NODE_METRICS } from '../../ui/tokens'
import { connectorHitScaleForZoom, handleScaleForZoom } from '../zoomChrome'

type CardConnectorStyle = CSSProperties & {
  '--e-connector-flow-size': string
  '--e-connector-flow-stroke': string
  '--e-connector-flow-focus-ring': string
  '--e-connector-hit-inner-scale': string
}

const selectZoom = (state: { transform: [number, number, number] }) => state.transform[2]

function connectorStyle(zoom: number): CardConnectorStyle {
  const handleScale = handleScaleForZoom(zoom)
  return {
    '--e-connector-flow-size': `${CONNECTOR_NODE_METRICS.diameter * handleScale}px`,
    '--e-connector-flow-stroke': `${CONNECTOR_NODE_METRICS.stroke * handleScale}px`,
    '--e-connector-flow-focus-ring': `${CONNECTOR_NODE_METRICS.focusRing * handleScale}px`,
    '--e-connector-hit-inner-scale': connectorHitScaleForZoom(zoom).toFixed(3),
  }
}

/**
 * The zoom-pure visual shell around React Flow's Handle. Only this tiny child
 * subscribes to camera scale; the four connector variables never inherit
 * through the Card's semantic body.
 */
export function CardConnector({ className, style, ...props }: HandleProps) {
  const zoom = useStore(selectZoom)
  return (
    <Handle
      {...props}
      className={className ? `card-connector ${className}` : 'card-connector'}
      style={{ ...style, ...connectorStyle(zoom) }}
    />
  )
}
