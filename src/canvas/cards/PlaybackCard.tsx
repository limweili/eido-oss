import { Position, type NodeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'
import type { PlaybackCardNodeData } from '../cardInteraction'
import { cardKindLabels } from '../../shared/words'
import { resolveCardIdentity } from '../../ui/cardIdentity'
import {
  cardBodyForegroundVariables,
  type NeutralCardBodyForegroundVariables,
} from './cardIdentityStyle'
import { CardConnector } from './CardConnector'

type CardStyle = CSSProperties & Partial<NeutralCardBodyForegroundVariables> & {
  '--card-header-color'?: string
  '--card-header-soft'?: string
  '--card-header-body'?: string
  '--card-header-ink'?: string
  '--card-header-pattern-head'?: string
  '--card-header-pattern'?: string
}

export function PlaybackCard({ data }: NodeProps) {
  const { card, ghost } = data as unknown as PlaybackCardNodeData
  const title = card.title?.trim() || cardKindLabels[card.kind]
  const text = card.blocks.map((block) => block.text).join('\n').trim()
  const headerFill = card.headerColor ? card.headerFill ?? 'half' : undefined
  const identity = card.headerColor ? resolveCardIdentity(card.headerColor) : undefined
  const cardStyle: CardStyle = card.headerColor
    ? {
        height: card.size?.height ? '100%' : undefined,
        '--card-header-color': identity!.solid,
        '--card-header-soft': identity!.soft,
        '--card-header-body': identity!.body,
        '--card-header-ink': identity!.onSolid,
        ...cardBodyForegroundVariables(identity!, 'neutral'),
        '--card-header-pattern-head': identity!.patternHead,
        '--card-header-pattern': identity!.pattern,
      }
    : { height: card.size?.height ? '100%' : undefined }

  return (
    <div
      className={`card playback-card ${card.kind} ${headerFill ? `fill-${headerFill}` : ''} ${
        ghost ? 'timeline-ghost-card' : ''
      }`}
      style={cardStyle}
    >
      <CardConnector type="target" position={Position.Left} isConnectable={false} />
      <div className="card-head">
        <span className={`playback-kind-dot ${card.headerColor ? 'has-color' : ''}`} />
        <div className="card-title-display t-title has-title">
          <span>{title}</span>
        </div>
      </div>
      {card.kind !== 'group' && (
        <div className="card-body playback-card-body">
          {text ? (
            <div className="playback-card-text">{text}</div>
          ) : (
            <span className="result-empty">No text yet.</span>
          )}
          {card.assets?.length ? (
            <span className="playback-asset-count">
              {card.assets.length} {card.assets.length === 1 ? 'asset' : 'assets'}
            </span>
          ) : null}
        </div>
      )}
      {card.kind === 'group' && <div className="card-body group-frame-space" />}
      <CardConnector type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}
