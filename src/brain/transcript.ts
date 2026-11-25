// The transcript model (a deep module). A Conversation Result is, underneath, an
// ordered list of messages: AI participant turns and user Interjections, plus an
// in-progress streaming message while a turn is being written. These are pure
// functions over a TranscriptMessage[] so the same behaviour can be tested without
// rendering the canvas, and the UI never becomes the source of truth (Concept 5).

import { newId } from '../shared/ids'
import type { TranscriptMessage } from '../graph/types'

// Start a new AI participant message (initially empty and streaming).
export function startParticipantMessage(args: {
  participantCardId: string
  speakerName: string
  turnNumber: number
}): TranscriptMessage {
  return {
    id: newId('msg'),
    speakerKind: 'participant',
    speakerName: args.speakerName,
    participantCardId: args.participantCardId,
    text: '',
    turnNumber: args.turnNumber,
    streaming: true,
  }
}

// A user Interjection — outside the scheduled turn order, never streaming.
export function userMessage(text: string, speakerName = 'You'): TranscriptMessage {
  return {
    id: newId('msg'),
    speakerKind: 'user',
    speakerName,
    text: text.trim(),
    streaming: false,
  }
}

// The public transcript every participant sees before its turn — only completed
// participant turns and user Interjections, never another participant's backstage
// context. An in-progress streaming message is excluded (it isn't said yet).
export function publicMessages(transcript: TranscriptMessage[]): TranscriptMessage[] {
  return transcript.filter((m) => !m.streaming)
}

// How many turns a given participant has already taken (completed or in progress).
export function participantTurnCount(
  transcript: TranscriptMessage[],
  participantCardId: string,
): number {
  return transcript.filter(
    (m) => m.speakerKind === 'participant' && m.participantCardId === participantCardId,
  ).length
}

// Render the transcript as plain chat text — used for copy and for feeding a
// Conversation Result into another card as Shared Context.
export function flattenTranscript(transcript: TranscriptMessage[]): string {
  return transcript
    .filter((m) => m.text.trim())
    .map((m) => `${m.speakerName}: ${m.text.trim()}`)
    .join('\n\n')
}

// Render the public transcript for inclusion in a turn prompt.
export function transcriptForPrompt(transcript: TranscriptMessage[]): string {
  return flattenTranscript(publicMessages(transcript))
}
