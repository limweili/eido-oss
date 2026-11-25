import { Copy, FilePlus2 } from 'lucide-react'
import { memo } from 'react'
import type { FollowUpMessage } from '../../graph/types'
import { followCardTextLink } from '../cardLinks'
import { words } from '../../shared/words'
import { IconButton } from '../../ui/primitives'
import { RunToolTrail } from './RunToolTrail'

export type RenderedFollowUpMessage = {
  message: FollowUpMessage
  html: string
}

export const FollowUpBubble = memo(function FollowUpBubble({
  message,
  html,
  copied,
  onCopy,
  onTurnIntoNote,
}: RenderedFollowUpMessage & {
  copied: boolean
  onCopy: (message: FollowUpMessage) => Promise<void>
  onTurnIntoNote: (message: FollowUpMessage) => void
}) {
  return (
    <div
      className={`followup-bubble ${message.role}`}
      role="group"
      aria-label={message.role === 'user' ? words.you : words.followUpAssistant}
    >
      {/* The enclosing result root already owns `nodrag` while selected;
          nested trails need no selection prop of their own. */}
      {message.role === 'assistant' && message.toolSteps?.length ? (
        <RunToolTrail
          steps={message.toolSteps}
          running={message.status === 'streaming'}
          selected={false}
        />
      ) : null}
      {html ? (
        <div
          className="bubble-text markdown e-prose t-prose-s"
          onClick={followCardTextLink}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : message.status === 'streaming' ? null : (
        <div className="bubble-text result-empty t-prose-s">{words.transcriptStreaming}</div>
      )}
      {/* The dot alone, waiting or writing. The Card's foot already says
          the word, so the bubble carries only the motion. */}
      {message.status === 'streaming' && (
        <span
          className="streaming-dot"
          role="status"
          aria-label={words.transcriptStreaming}
        />
      )}
      {message.status === 'stopped' && (
        <div className="followup-status">{words.followUpStopped}</div>
      )}
      {message.status === 'failed' && (
        <div className="followup-status warn">{words.followUpFailed}</div>
      )}
      {message.role === 'assistant'
        && message.status !== 'streaming'
        && message.text.trim() && (
        <div className="followup-bubble-actions">
          <IconButton
            label={copied ? words.copied : words.copy}
            tooltipOpen={copied}
            icon={<Copy aria-hidden="true" />}
            size="compact"
            className="followup-copy"
            onClick={() => void onCopy(message)}
          />
          <IconButton
            label={words.turnIntoNote}
            icon={<FilePlus2 aria-hidden="true" />}
            size="compact"
            className="followup-note"
            onClick={() => onTurnIntoNote(message)}
          />
        </div>
      )}
    </div>
  )
})
