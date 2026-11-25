// How a follow-up thread reads as text — one source of truth shared by the
// follow-up runner's prompt, downstream compiles, and group digests (PRD #236).
// Pure functions over FollowUpMessage[], the same shape transcript.ts gives
// Conversation Results, so behaviour is testable without the canvas.

import type { FollowUpMessage } from '../graph/types'

// The heading downstream readers see above a result's follow-up thread.
export const FOLLOW_UP_DISCUSSION_LABEL = 'Follow-up discussion on this result:'

// Only settled messages leave the card: blank messages carry nothing, failed
// replies never became content, and a streaming reply is still being written —
// half-written text must not pollute later runs (issue #248). Both downstream
// consumers — compiled context (via flattenFollowUpThread) and the
// source-change fingerprint (sourceContext.ts) — share this filter so they can
// never drift apart; that identity is what keeps the staleness badge honest.
export function settledFollowUpMessages(messages: FollowUpMessage[]): FollowUpMessage[] {
  return messages.filter(
    (message) =>
      message.text.trim() && message.status !== 'failed' && message.status !== 'streaming',
  )
}

// A reply stuck at 'streaming' after its stream died — a page reload
// mid-stream is the usual cause — has no controller left to finish it. Left
// alone it spins forever on the card and never reaches downstream context or
// the source-change fingerprint (both filter through settledFollowUpMessages).
// Settling it to 'stopped' means what a manual stop means: keep the partial
// text, mark it ended early, let it flow downstream again. Callers must only
// pass threads that are leaving the live stream behind: boards read from
// storage (the board-load path) and the snapshot a duplicate is created from
// (issue #267) — never the live board itself, where a stream genuinely still
// running must keep its streaming status.
export function settleInterruptedFollowUps(messages: FollowUpMessage[]): FollowUpMessage[] {
  if (!messages.some((message) => message.status === 'streaming')) return messages
  return messages.map((message) =>
    message.status === 'streaming' ? { ...message, status: 'stopped' } : message,
  )
}

// Render a thread as readable turns. Only settled messages appear (see
// settledFollowUpMessages). A stopped reply is visible on the card, so it
// stays — marked as ended early.
export function flattenFollowUpThread(messages: FollowUpMessage[]): string {
  return settledFollowUpMessages(messages)
    .map((message) => {
      const speaker = message.role === 'user' ? 'User' : 'Assistant'
      const marker = message.status === 'stopped' ? ' (stopped early)' : ''
      return `${speaker}${marker}: ${message.text.trim()}`
    })
    .join('\n\n')
}

// The labelled section a result contributes downstream when its chosen version
// has a thread with real content; empty string when there is nothing to say.
export function followUpDiscussionSection(messages: FollowUpMessage[]): string {
  const flattened = flattenFollowUpThread(messages)
  return flattened ? `${FOLLOW_UP_DISCUSSION_LABEL}\n${flattened}` : ''
}
