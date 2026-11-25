import type { CSSProperties } from 'react'
import { dragBlockingClass } from '../cardInteraction'
import type { OutputVersion } from '../../graph/types'
import { Tooltip } from '../../ui/primitives'
import { provisionalReasonLabel } from './cardChrome'

// Shared version-switcher chip row consumed by ResultCard, ConversationResultCard,
// and GroupCard. Renders nothing when there is only one (or zero) versions —
// there is nowhere to switch to.
export function VersionSwitcher({
  versions,
  chosenId,
  selected,
  onChoose,
  style,
}: {
  versions: OutputVersion[]
  chosenId: string | undefined
  selected: boolean
  onChoose: (versionId: string) => void
  style?: CSSProperties
}) {
  if (versions.length <= 1) return null
  return (
    <div className="version-switcher" style={style}>
      {versions.map((version) => {
        const versionLabel = `Version ${version.number}`
        const provisionalLabel = version.provisional
          ? provisionalReasonLabel(version.provisionalReason)
          : undefined
        const fillState = version.provisional ? 'provisional' : version.accepted ? 'kept' : ''
        return (
          <Tooltip key={version.id} content={provisionalLabel ?? versionLabel}>
            <button
              type="button"
              className={`ver-chip t-value ${dragBlockingClass(selected)} ${version.id === chosenId ? 'active' : ''} ${fillState}`}
              aria-label={provisionalLabel ? `${versionLabel} — ${provisionalLabel}` : versionLabel}
              onClick={() => onChoose(version.id)}
            >
              v{version.number}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}
