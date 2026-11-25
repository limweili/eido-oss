import { describe, expect, it } from 'vitest'
import {
  flattenTranscript,
  participantTurnCount,
  publicMessages,
  startParticipantMessage,
  transcriptForPrompt,
  userMessage,
} from './transcript'

describe('transcript model', () => {
  it('creates a user Interjection as a non-streaming user message', () => {
    const transcript = [userMessage('  please be concrete  ')]
    expect(transcript[0]).toMatchObject({ speakerKind: 'user', text: 'please be concrete', streaming: false })
  })

  it('excludes in-progress streaming messages from the public transcript', () => {
    const proMsg = startParticipantMessage({ participantCardId: 'pro', speakerName: 'Pro', turnNumber: 1 })
    const live = startParticipantMessage({ participantCardId: 'con', speakerName: 'Con', turnNumber: 1 })
    const transcript = [{ ...proMsg, streaming: false }, live]
    expect(publicMessages(transcript)).toHaveLength(1)
    expect(publicMessages(transcript)[0].speakerName).toBe('Pro')
  })

  it('counts a participant turns and flattens to chat text', () => {
    const transcript = [
      { ...startParticipantMessage({ participantCardId: 'pro', speakerName: 'Pro', turnNumber: 1 }), text: 'A', streaming: false },
      userMessage('go on'),
      { ...startParticipantMessage({ participantCardId: 'pro', speakerName: 'Pro', turnNumber: 2 }), text: 'B', streaming: false },
    ]

    expect(participantTurnCount(transcript, 'pro')).toBe(2)
    expect(flattenTranscript(transcript)).toBe('Pro: A\n\nYou: go on\n\nPro: B')
    expect(transcriptForPrompt(transcript)).toContain('You: go on')
  })
})
