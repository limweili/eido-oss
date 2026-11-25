import { useState } from 'react'
import { modelLabel } from '../brain/models'
import { useGraph } from '../graph/store'
import type { ConversationProvenance, OutputVersion } from '../graph/types'
import { words } from '../shared/words'
import { Badge, Button, ContextRow } from '../ui/primitives'
import { ModalShell } from '../ui/overlays'
import { wheelGate } from './cardInteraction'
import { MarkdownPreview } from './MarkdownPreview'

// Frozen provenance for one output version. It reads the recorded run rather
// than recomputing live context, so board edits never rewrite history.
export function VersionContext({
  version,
  onClose,
}: {
  version: OutputVersion
  onClose: () => void
}) {
  const [open, setOpen] = useState(true)
  const run = useGraph((state) => state.runs.find((candidate) => candidate.id === version.fromRunId))
  const madeAt = (() => {
    try {
      return new Date(version.createdAt).toLocaleString()
    } catch {
      return version.createdAt
    }
  })()
  const conversation = run?.kind === 'conversation' ? run.conversation : undefined
  const title = conversation
    ? `${words.ctxConversationTitle} — v${version.number}`
    : `${words.versionContextTitle} — v${version.number}`
  const rowCount = conversation ? conversationRowCount(conversation) : run ? 3 : 0

  return (
    <ModalShell
      open={open}
      title={title}
      titleMeta={<Badge>{rowCount}</Badge>}
      className="context-surface version-context-surface"
      dismissOnBackdrop
      onDismiss={() => setOpen(false)}
      onExitComplete={onClose}
      footer={<Button onClick={() => setOpen(false)}>{words.close}</Button>}
    >
      {conversation ? (
        <ConversationContext conversation={conversation} madeAt={madeAt} />
      ) : run ? (
        <div className="context-surface__rows">
          <ContextRow defaultExpanded title={words.versionModel} snippet={modelLabel(run.model)} />
          <ContextRow defaultExpanded title={words.versionMadeAt} snippet={madeAt} />
          <ContextRow
            defaultExpanded
            title={words.versionContextSent}
            snippet={
              <MarkdownPreview
                className="version-context-surface__text"
                text={run.compiledInstruction}
                emptyText={words.peekNoText}
                contentRef={wheelGate()}
              />
            }
          />
        </div>
      ) : (
        <p className="result-empty">{words.versionContextMissing}</p>
      )}
    </ModalShell>
  )
}

const STYLE_LABEL: Record<string, string> = {
  debate: words.conversationStyleDebate,
  critique: words.conversationStyleCritique,
  interview: words.conversationStyleInterview,
  collaborate: words.conversationStyleCollaborate,
}

function conversationRowCount(conversation: ConversationProvenance): number {
  return 1
    + conversation.participants.length
    + conversation.sharedContext.length
    + conversation.topLevelMods.length
    + conversation.turns.length
}

function ConversationContext({
  conversation,
  madeAt,
}: {
  conversation: ConversationProvenance
  madeAt: string
}) {
  const { settings, participants, sharedContext, topLevelMods, turns } = conversation

  return (
    <div className="context-surface__sections conversation-context-surface">
      <section className="context-surface__section" aria-label={words.ctxSettings}>
        <h3 className="context-surface__section-title t-micro">{words.ctxSettings}</h3>
        <ContextRow
          defaultExpanded
          title={settings.topic || '—'}
          meta={`${words.ctxStyle.toUpperCase()} · ${STYLE_LABEL[settings.style] ?? settings.style}`}
          snippet={
            <div className="conversation-context-surface__facts">
              <div>{words.ctxTopic}: {settings.topic || '—'}</div>
              <div>{words.ctxStyle}: {STYLE_LABEL[settings.style] ?? settings.style}</div>
              <div>{words.ctxTurns}: {settings.turnsPerParticipant}</div>
              <div>{words.versionMadeAt}: {madeAt}</div>
            </div>
          }
        />
      </section>

      <section className="context-surface__section" aria-label={words.ctxParticipants}>
        <h3 className="context-surface__section-title t-micro">{words.ctxParticipants}</h3>
        <div className="context-surface__rows">
          {participants.map((participant) => (
            <ContextRow
              key={participant.cardId}
              defaultExpanded
              title={participant.name}
              status={<span className="t-value">{modelLabel(participant.model)}</span>}
              snippet={
                <div className="conversation-context-surface__facts">
                  {participant.role && (
                    <MarkdownPreview
                      className="conversation-context-surface__markdown"
                      text={participant.role}
                      emptyText={words.peekNoText}
                    />
                  )}
                  {!!participant.participantMods?.length && (
                    <div className="conversation-context-surface__guidance">
                      <strong className="t-micro">{words.ctxParticipantMods}</strong>
                      {participant.participantMods.map((mod) => (
                        <div key={mod.cardId}>
                          <strong>{mod.label}</strong>
                          <MarkdownPreview
                            className="conversation-context-surface__markdown"
                            text={mod.instructions.join('\n\n')}
                            emptyText={words.peekNoText}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              }
            />
          ))}
        </div>
      </section>

      <section className="context-surface__section" aria-label={words.ctxSharedContext}>
        <h3 className="context-surface__section-title t-micro">{words.ctxSharedContext}</h3>
        {sharedContext.length === 0 ? (
          <div className="result-empty">{words.ctxNoSharedContext}</div>
        ) : (
          <div className="context-surface__rows">
            {sharedContext.map((context) => (
              <ContextRow
                key={context.cardId}
                defaultExpanded
                title={context.label || context.text.split('\n')[0] || words.ctxSharedContext}
                snippet={
                  <MarkdownPreview
                    className="conversation-context-surface__markdown"
                    text={context.text}
                    emptyText={words.peekNoText}
                  />
                }
              />
            ))}
          </div>
        )}
      </section>

      <section className="context-surface__section" aria-label={words.ctxTopLevelMods}>
        <h3 className="context-surface__section-title t-micro">{words.ctxTopLevelMods}</h3>
        {topLevelMods.length === 0 ? (
          <div className="result-empty">{words.ctxNoMods}</div>
        ) : (
          <div className="context-surface__rows">
            {topLevelMods.map((mod) => (
              <ContextRow
                key={mod.cardId}
                defaultExpanded
                title={mod.label}
                snippet={
                  <MarkdownPreview
                    className="conversation-context-surface__markdown"
                    text={mod.instructions.join('\n\n')}
                    emptyText={words.peekNoText}
                  />
                }
              />
            ))}
          </div>
        )}
      </section>

      {turns.length > 0 && (
        <section className="context-surface__section" aria-label={words.ctxPerTurn}>
          <h3 className="context-surface__section-title t-micro">{words.ctxPerTurn}</h3>
          <div className="context-surface__rows">
            {turns.map((turn, index) => (
              <ContextRow
                key={`${turn.speakerName}-${turn.currentTurn}-${index}`}
                title={`${turn.speakerName} — turn ${turn.currentTurn}/${turn.totalTurns}`}
                snippet={
                  <MarkdownPreview
                    className="version-context-surface__text"
                    text={turn.instruction}
                    emptyText={words.peekNoText}
                    contentRef={wheelGate()}
                  />
                }
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
